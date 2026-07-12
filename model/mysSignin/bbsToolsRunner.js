/** MihoyoBBSTools Python 子进程封装
 *  - 创建临时 captcha IPC 目录
 *  - spawn mysSignin_runner.py
 *  - 返回签到结果
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'
import { SIGNIN_LOG_PREFIX } from '../../components/constants.js'
import { getSigninConfig } from './bbsToolsConfig.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.join(__dirname, '..', '..')

/** MihoyoBBSTools 模块根目录 */
const BBS_TOOLS_MODULE_DIR = path.join(
  pluginRoot, 'tool', 'MihoyoBBSTools', 'MihoyoBBSTools'
)

/** Python 桥接脚本路径 */
const RUNNER_SCRIPT = path.join(pluginRoot, 'tool', 'mysSignin_runner.py')

/**
 * 执行单个用户配置文件的签到
 * @param {object} options
 * @param {string} options.configPath - {qq}_n.yaml 路径
 * @param {string} options.userId - QQ 号 (用于日志)
 * @param {number} options.profileN - 序号 n
 * @param {object} options.captchaBridge - captchaBridge 实例 ({ start, stop })
 * @returns {Promise<{ok: boolean, statusCode: number, message: string, error?: string}>}
 */
function runSingleSignin (options) {
  const { configPath, userId, profileN, captchaBridge } = options
  const signinCfg = getSigninConfig()

  return new Promise((resolve) => {
    // 创建临时 captcha 目录
    const captchaDir = path.join(
      pluginRoot, 'data', 'tmp', 'mysSignin', `${userId}_${profileN}_${Date.now()}`
    )
    fs.mkdirSync(captchaDir, { recursive: true })

    // 结果文件
    const resultFile = path.join(captchaDir, 'result.json')

    // 启动过码监控
    if (captchaBridge) {
      captchaBridge.start(captchaDir)
    }

    const args = [
      RUNNER_SCRIPT,
      '--config', configPath,
      '--module-dir', BBS_TOOLS_MODULE_DIR,
      '--captcha-dir', captchaDir,
      '--captcha-timeout', String(signinCfg.captchaTimeout),
      '--result-file', resultFile
    ]

    logger?.info(`${SIGNIN_LOG_PREFIX} 启动签到: QQ=${userId} n=${profileN}`)

    const proc = spawn(signinCfg.pythonCommand, args, {
      cwd: BBS_TOOLS_MODULE_DIR,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      const text = data.toString()
      stdout += text
      // MihoyoBBSTools 使用 print 输出进度，透传到日志
      if (text.trim()) {
        logger?.info(`${SIGNIN_LOG_PREFIX} [py] ${text.trim()}`)
      }
    })

    proc.stderr.on('data', (data) => {
      const text = data.toString()
      stderr += text
      if (text.trim()) {
        logger?.warn(`${SIGNIN_LOG_PREFIX} [py:err] ${text.trim()}`)
      }
    })

    const timeoutMs = 600000 // 10 分钟
    const timer = setTimeout(() => {
      logger?.error(`${SIGNIN_LOG_PREFIX} 签到超时: QQ=${userId} n=${profileN}`)
      proc.kill('SIGTERM')
      cleanup()
      resolve({ ok: false, statusCode: -1, message: '签到超时（10分钟）' })
    }, timeoutMs)

    proc.on('close', (code) => {
      clearTimeout(timer)
      cleanup()

      // 读取 result.json
      try {
        if (fs.existsSync(resultFile)) {
          const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'))
          logger?.info(
            `${SIGNIN_LOG_PREFIX} 签到完成: QQ=${userId} n=${profileN} ok=${result.ok} code=${result.statusCode}`
          )
          resolve(result)
        } else {
          logger?.error(
            `${SIGNIN_LOG_PREFIX} 签到异常: QQ=${userId} n=${profileN} exit=${code} 无结果文件`
          )
          resolve({
            ok: false,
            statusCode: code || -1,
            message: stderr.slice(-500) || stdout.slice(-500) || '未知错误（无输出）'
          })
        }
      } catch (err) {
        logger?.error(`${SIGNIN_LOG_PREFIX} 解析结果失败: ${err.message}`)
        resolve({ ok: false, statusCode: -1, message: `结果解析失败: ${err.message}` })
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      cleanup()
      logger?.error(`${SIGNIN_LOG_PREFIX} 启动Python失败: ${err.message}`)
      resolve({
        ok: false,
        statusCode: -1,
        message: `Python 启动失败: ${err.message}\n请检查 signin.pythonCommand 配置（当前: ${signinCfg.pythonCommand}）`
      })
    })

    function cleanup () {
      if (captchaBridge) captchaBridge.stop()
      // 清理临时目录
      try {
        fs.rmSync(captchaDir, { recursive: true, force: true })
      } catch {}
    }
  })
}

export {
  BBS_TOOLS_MODULE_DIR,
  RUNNER_SCRIPT,
  runSingleSignin
}
