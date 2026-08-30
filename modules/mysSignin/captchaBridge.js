/** 过码文件 IPC 桥接
 *
 *  Python tool/MihoyoBBSTools/mysSignin_runner.py 将 captcha 模块替换为文件 IPC：
 *    写入 {captchaDir}/{requestId}.request.json → 轮询 .response.json
 *
 *  本模块负责：
 *    轮询 .request.json → 复用 loveMys Geetest 求解链路 → 写入 .response.json
 *
 *  支持三种平台（由 gsCfg.api.type 决定）：
 *    type 0: test_nine 本地 AI
 *    type 1: ttocr.com
 *    type 2: 2captcha.com
 */

import fs from 'node:fs'
import path from 'node:path'
import fetch from 'node-fetch'
import gsCfg from '../../model/gsCfg.js'
import { SIGNIN_LOG_PREFIX } from '../../components/constants.js'

/** 轮询间隔 (ms) */
const POLL_INTERVAL = 500

/** 可中断 sleep（stop 时立即返回） */
const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) return resolve()
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => {
    clearTimeout(t)
    resolve()
  }, { once: true })
})

/**
 * 过码桥接器
 *
 * 用法:
 *   const bridge = new CaptchaBridge()
 *   bridge.start(captchaDir)    // 开始监控
 *   // ... Python 子进程运行 ...
 *   bridge.stop()               // 停止监控
 */
export class CaptchaBridge {
  constructor () {
    this._captchaDir = null
    this._timer = null
    this._running = false
    this._processed = new Set() // 已处理的 request id
    this._abort = null // AbortController：stop 时中断进行中的 fetch/轮询
  }

  /** 开始监控指定目录 */
  start (captchaDir) {
    if (this._running) this.stop()
    this._captchaDir = captchaDir
    this._running = true
    this._processed.clear()
    this._abort = new AbortController()
    this._poll()
  }

  /** 停止监控 */
  stop () {
    this._running = false
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
    // 中断进行中的 fetch 与轮询 sleep（_solveCaptcha 各 fetch 已传 signal）
    this._abort?.abort()
    this._abort = null
    this._captchaDir = null
  }

  /** 轮询循环 */
  async _poll () {
    if (!this._running || !this._captchaDir) return

    try {
      if (!fs.existsSync(this._captchaDir)) {
        this._timer = setTimeout(() => this._poll(), POLL_INTERVAL)
        return
      }

      const files = fs.readdirSync(this._captchaDir)
      for (const file of files) {
        if (!file.endsWith('.request.json')) continue
        if (this._processed.has(file)) continue

        this._processed.add(file)
        const requestPath = path.join(this._captchaDir, file)
        const responseFile = file.replace('.request.json', '.response.json')
        const responsePath = path.join(this._captchaDir, responseFile)

        try {
          const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'))
          const result = await this._solveCaptcha(request)
          fs.writeFileSync(responsePath, JSON.stringify(result), 'utf8')

          logger?.info(
            `${SIGNIN_LOG_PREFIX} [过码] ${request.id} kind=${request.kind} ok=${result.ok}`
          )
        } catch (err) {
          logger?.error(`${SIGNIN_LOG_PREFIX} [过码] 处理失败: ${err.message}`)
          // 写入失败响应，防止 Python 侧永久阻塞
          fs.writeFileSync(responsePath, JSON.stringify({
            ok: false, challenge: '', validate: ''
          }), 'utf8')
        }
      }
    } catch (err) {
      logger?.error(`${SIGNIN_LOG_PREFIX} [过码] 轮询异常: ${err.message}`)
    }

    if (this._running) {
      this._timer = setTimeout(() => this._poll(), POLL_INTERVAL)
    }
  }

  /**
   * 求解验证码
   * @param {{id: string, kind: string, gt: string, challenge: string}} request
   * @returns {Promise<{ok: boolean, challenge: string, validate: string}>}
   */
  async _solveCaptcha (request) {
    const { gt, challenge } = request
    if (!gt || !challenge) {
      return { ok: false, challenge: '', validate: '' }
    }

    const apiCfg = gsCfg.api || {}
    const type = apiCfg.type

    try {
      if (type === 0) {
        return await this._solveViaTestNine(gt, challenge, apiCfg)
      } else if (type === 1) {
        return await this._solveViaTtocr(gt, challenge, apiCfg)
      } else if (type === 2) {
        return await this._solveVia2captcha(gt, challenge, apiCfg)
      } else {
        logger?.warn(`${SIGNIN_LOG_PREFIX} [过码] 未知平台类型: ${type}`)
        return { ok: false, challenge: '', validate: '' }
      }
    } catch (err) {
      logger?.error(`${SIGNIN_LOG_PREFIX} [过码] 求解异常: ${err.message}`)
      return { ok: false, challenge: '', validate: '' }
    }
  }

  /** test_nine 本地 AI */
  async _solveViaTestNine (gt, challenge, apiCfg) {
    const url = `${apiCfg.api}?gt=${encodeURIComponent(gt)}&challenge=${encodeURIComponent(challenge)}`
    logger?.info(`${SIGNIN_LOG_PREFIX} [过码] test_nine 请求: ${url}`)
    const res = await fetch(url, { timeout: 30000, signal: this._abort?.signal })
    const data = await res.json()
    if (data?.data?.validate) {
      return { ok: true, challenge, validate: data.data.validate }
    }
    logger?.warn(`${SIGNIN_LOG_PREFIX} [过码] test_nine 返回无validate: ${JSON.stringify(data)}`)
    return { ok: false, challenge: '', validate: '' }
  }

  /** ttocr.com */
  async _solveViaTtocr (gt, challenge, apiCfg) {
    const config = `${apiCfg.key}&${apiCfg.query}&gt=${gt}&challenge=${challenge}`
    const recognizeRes = await fetch(apiCfg.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: config,
      timeout: 30000,
      signal: this._abort?.signal
    })
    const recognizeData = await recognizeRes.json()
    if (!recognizeData?.resultid) {
      logger?.warn(`${SIGNIN_LOG_PREFIX} [过码] ttocr recognize 无 resultid: ${JSON.stringify(recognizeData)}`)
      return { ok: false, challenge: '', validate: '' }
    }

    // 轮询结果（最多 10 次，每次 5s）
    for (let i = 0; i < 10; i++) {
      await sleep(5000, this._abort?.signal)
      if (this._abort?.signal?.aborted) break
      const resultUrl = `${apiCfg.resapi}?${apiCfg.key}&resultid=${recognizeData.resultid}`
      const resultRes = await fetch(resultUrl, { timeout: 10000, signal: this._abort?.signal })
      const resultData = await resultRes.json()
      if (resultData?.status === 1) {
        // status 1 = 成功
        return { ok: true, challenge, validate: resultData?.data?.validate || '' }
      }
      // status 2 = 处理中，继续等待
    }
    logger?.warn(`${SIGNIN_LOG_PREFIX} [过码] ttocr 轮询超时`)
    return { ok: false, challenge: '', validate: '' }
  }

  /** 2captcha.com */
  async _solveVia2captcha (gt, challenge, apiCfg) {
    const inUrl = `${apiCfg.api}?${apiCfg.key}&${apiCfg.query}&gt=${gt}&challenge=${challenge}`
    const inRes = await fetch(inUrl, { timeout: 30000, signal: this._abort?.signal })
    const inData = await inRes.json()
    if (!inData?.request) {
      logger?.warn(`${SIGNIN_LOG_PREFIX} [过码] 2captcha in 无 request: ${JSON.stringify(inData)}`)
      return { ok: false, challenge: '', validate: '' }
    }

    // 轮询结果（最多 10 次，每次 5s）
    for (let i = 0; i < 10; i++) {
      await sleep(5000, this._abort?.signal)
      if (this._abort?.signal?.aborted) break
      const resUrl = `${apiCfg.resapi}?${apiCfg.key}&${apiCfg.resquery}&id=${inData.request}`
      const resRes = await fetch(resUrl, { timeout: 10000, signal: this._abort?.signal })
      const resData = await resRes.json()
      if (resData?.request === 'CAPCHA_NOT_READY') continue
      if (resData?.request?.geetest_validate) {
        return {
          ok: true,
          challenge: resData.request.geetest_challenge || challenge,
          validate: resData.request.geetest_validate
        }
      }
      // 如果状态不是 NOT_READY 也没有 validate，可能失败了
      if (resData?.status === 0 && !resData?.request) break
    }
    logger?.warn(`${SIGNIN_LOG_PREFIX} [过码] 2captcha 轮询超时`)
    return { ok: false, challenge: '', validate: '' }
  }
}

export default CaptchaBridge
