import common from '../../../lib/common/common.js'
import getDeviceFp from './getDeviceFp.js'
import MysApi from './mys/mysApi.js'
import fetch from 'node-fetch'
import gsCfg from './gsCfg.js'

export default class LoveMys {
  async getvali (e, mysApi, type, data = {}) {
    let res
    try {
      res = await mysApi.getData(type, data)
      if (res?.retcode == 0 || (type == 'detail' && res?.retcode == -1002)) return res

      res = await this.geetest(e, mysApi, res?.retcode)
      if (!res?.data?.challenge) {
        return { data: null, message: '验证码失败', retcode: res?.retcode }
      }

      if (data?.headers) {
        data.headers = {
          ...data.headers,
          'x-rpc-challenge': res?.data?.challenge,
        }
      } else {
        if (!data) data = {}
        data.headers = {
          'x-rpc-challenge': res?.data?.challenge,
        }
      }
      res = await mysApi.getData(type, data)

      if (!(res?.retcode === 0 || (type == 'detail' && res?.retcode === -1002))) {
        return { data: null, message: '验证码失败', retcode: res?.retcode }
      }
    } catch (error) {
      logger.error(error)
      return { data: null, message: '出错了', retcode: res?.retcode }
    }
    return res
  }

  async geetest (e, data, retcode = 1034) {
    let res
    let { uid, cookie, game } = data
    if (e?.game) game = e?.game
    let vali = new MysApi(uid, cookie, game, data.option || {}, data._device || '')

    try {
      let challenge_game = game === 'zzz' ? '8' : game === 'sr' ? '6' : '2'
      let { deviceFp } = await getDeviceFp.Fp(uid, cookie, game)
      let headers = { 'x-rpc-device_fp': deviceFp, 'x-rpc-challenge_game': challenge_game }
      let app_key = game === 'zzz' ? 'game_record_zzz' : game === 'sr' ? 'hkrpg_game_record' : ''

      res = await vali.getData(retcode === 10035 ? 'createGeetest' : 'createVerification', { headers, app_key })
      if (!res || res?.retcode !== 0) {
        return { data: null, message: '未知错误，可能为cookie失效', retcode: 10103 }
      }

      let type = gsCfg.api.type
      let GtestType = gsCfg.api.GtestType
      // 挑战数据（createVerification/createGeetest 成功结果）：全程保留，手动降级兜底用
      let challengeData = res
      // 求解结果：独立变量接收，失败时不覆盖挑战数据（避免 res 变 false 后 gt/challenge 丢失）
      let solveRes
      let retry = 0
      if (type == 0) {
        if ([2, 1].includes(GtestType)) {
          for (let tnAttempt = 0; tnAttempt < 3; tnAttempt++) {
            if (tnAttempt > 0) {
              logger.mark(`[loveMys] test_nine 过码失败，第 ${tnAttempt + 1}/3 次尝试`)
              // 重新创建挑战（旧挑战可能已过期）
              const newChallenge = await vali.getData(retcode === 10035 ? 'createGeetest' : 'createVerification', { headers, app_key })
              if (!newChallenge || newChallenge?.retcode !== 0) break
              res = newChallenge
              challengeData = newChallenge
            }
            solveRes = await vali.getData('test_nine', res?.data)
            if (solveRes?.data?.validate) {
              res = {
                data: {
                  challenge: res?.data?.challenge,
                  validate: solveRes?.data?.validate
                }
              }
              // 验证求解结果
              res = await vali.getData(retcode === 10035 ? 'verifyGeetest' : 'verifyVerification', {
                ...res.data,
                headers,
                app_key
              })
              if (res?.data?.challenge) return res
            }
          }
        }
      } else if (type == 1) {
        if ([2, 1].includes(GtestType)) solveRes = await vali.getData('recognize', res?.data)
        if (solveRes?.resultid) {
          let results = solveRes
          await common.sleep(5000)
          solveRes = await vali.getData('results', results)
          while ((solveRes?.status == 2) && retry < 10) {
            await common.sleep(5000)
            solveRes = await vali.getData('results', results)
            retry++
          }
        }
      } else if (type == 2) {
        if ([2, 1].includes(GtestType)) solveRes = await vali.getData('in', res?.data)
        if (solveRes?.request) {
          let request = solveRes
          await common.sleep(5000)
          solveRes = await vali.getData('res', request)
          while ((solveRes?.request == 'CAPCHA_NOT_READY') && retry < 10) {
            await common.sleep(5000)
            solveRes = await vali.getData('res', request)
            retry++
          }
        }
      }
      // 统一处理：求解成功 → 回传验证；失败 → 手动降级
      const solvedData = solveRes?.data?.validate
        ? solveRes.data
        : (solveRes?.request?.geetest_validate ? solveRes.request : null)
      if (solvedData) {
        res = await vali.getData(retcode === 10035 ? 'verifyGeetest' : 'verifyVerification', {
          ...solvedData,
          headers,
          app_key
        })
      } else {
        if ([2, 0].includes(GtestType)) {
          if (GtestType === 2) {
            // 重试创建挑战（旧挑战可能已过期）；失败保留原挑战数据
            const newChallenge = await vali.getData(retcode === 10035 ? 'createGeetest' : 'createVerification', { headers, app_key })
            if (newChallenge?.data?.gt && newChallenge?.data?.challenge) {
              res = newChallenge
              challengeData = newChallenge
            }
          }
          // 手动打码入参兜底：res 当前挑战数据优先，缺失时用 challengeData（保证链接总能发出）
          const manualData = res?.data?.gt && res?.data?.challenge ? res.data : challengeData?.data
          res = await this.Manual_geetest(e, manualData)
          if (res?.data?.validate || res?.data?.geetest_validate) {
            res = await vali.getData(retcode === 10035 ? 'verifyGeetest' : 'verifyVerification', {
              ...res.data,
              headers,
              app_key
            })
          } else {
            return { data: null, message: '验证码失败', retcode: retcode }
          }
        } else {
          return { data: null, message: '验证码失败', retcode: retcode }
        }
      }

      if (res?.data?.challenge) return res
    } catch (error) {
      logger.error(error)
    }
    return { data: null, message: '验证码失败', retcode: retcode }
  }

  /**
   * @param {{gt, challenge}} data
   */
  async Manual_geetest (e, data) {
    if (!data.gt || !data.challenge || !e?.reply) return false
    let apiCfg = gsCfg.api
    if (!apiCfg.verifyAddr || (!apiCfg.startApi && !(apiCfg.Port || apiCfg.Address))) {
      return { data: null, message: '未正确填写配置文件[api.yaml]', retcode: null }
    }

    let res
    try {
      res = await fetch(`${apiCfg.verifyAddr}`, {
        method: 'post',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
        // 公网手动打码服务可能无响应：超时即放弃，避免无限挂起卡死
        signal: AbortSignal.timeout(10000)
      })
    } catch (err) {
      logger.error(`[loveMys][GT-Manual] verifyAddr 请求失败: ${err.message}`)
      await e.reply('手动打码服务不可用（verifyAddr 请求失败），无法处理验证码')
      return { data: null, message: '手动打码服务不可用（verifyAddr 请求超时/失败）', retcode: null }
    }
    if (!res.ok) {
      logger.error(`[loveMys][GT-Manual] ${res.status} ${res.statusText}`)
      await e.reply(`手动打码服务异常（HTTP ${res.status}）`)
      return false
    }
    try {
      res = await res.json()
    } catch (err) {
      logger.error(`[loveMys][GT-Manual] 响应解析失败: ${err.message}`)
      await e.reply('手动打码服务响应异常，无法处理验证码')
      return false
    }
    if (!res.data) {
      await e.reply('手动打码服务返回异常，无法处理验证码')
      return false
    }

    await e.reply(`请点击验证链接地址或复制到浏览器打开完成验证\n${res.data.link}`, true)

    for (let i = 0; i < 80; i++) {
      let validate
      try {
        validate = await (await fetch(res.data.result, {
          // 结果轮询同样加超时：公网服务无响应时及时退出而非永久轮询
          signal: AbortSignal.timeout(10000)
        })).json()
      } catch (err) {
        logger.error(`[loveMys][GT-Manual] result 轮询失败: ${err.message}`)
        await e.reply('手动打码验证超时，请重新发送命令重试')
        return false
      }
      if (validate?.data) return validate

      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    await e.reply('手动打码验证超时（长时间未完成），请重新发送命令重试')
    return false
  }
}
