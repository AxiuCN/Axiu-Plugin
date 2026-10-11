import fetch from 'node-fetch'
import MysApi from './mys/mysApi.js'

/** 辅助请求超时（与星铁侧 `mysSrApi.REQUEST_TIMEOUT_MS` 同口径）：指纹/设备注册接口卡住时不拖住整轮过码 */
const REQUEST_TIMEOUT_MS = 10 * 1000

export default class getDeviceFp {
  /**
   * 指纹缓存键用的 ltuid
   *
   * 调用方传进来的 `ck` 既可能是 cookie 串、也可能是对象：原实现直接读 `ck.ltuid`，
   * 字符串形态下恒为 undefined ⇒ 所有账号共用 `genshin:device_fp:undefined:fp`（第四轮 #12），
   * 由 genshin 插件按真实 ltuid 写入的 `:bind` / `:id` 也读不到。
   */
  static _resolveLtuid (ck, uid) {
    let ltuid = ''
    if (typeof ck === 'string') {
      // cookie 串以 `;` 分隔，也兼容 `&` 分隔的 stoken 串
      const matched = String(ck).match(/(?:^|[;&]\s*)(?:ltuid|account_id|stuid)=([^;&\s]+)/i)
      ltuid = matched ? matched[1].trim() : ''
    } else {
      ltuid = ck?.ltuid || ck?.account_id || ck?.stuid || ''
    }
    if (!ltuid) {
      logger.warn(`[Axiu-Plugin][设备指纹] cookie 里没有 ltuid，指纹缓存键退化为 uid=${uid}`)
      ltuid = uid
    }
    return String(ltuid)
  }

  static async Fp (uid, ck, game) {
    const ltuid = this._resolveLtuid(ck, uid)
    let mysapi = new MysApi(uid, ck, game)
    let deviceFp = await redis.get(`genshin:device_fp:${ltuid}:fp`)
    let data = {}
    if (!deviceFp) {
      let bindInfo = await redis.get(`genshin:device_fp:${ltuid}:bind`)
      if (bindInfo) {
        data = {
          deviceFp
        }
        try {
          bindInfo = JSON.parse(bindInfo)
          data = {
            productName: bindInfo?.deviceProduct,
            deviceType: bindInfo?.deviceName,
            modelName: bindInfo?.deviceModel,
            oaid: bindInfo?.oaid,
            osVersion: bindInfo?.androidVersion,
            deviceInfo: bindInfo?.deviceFingerprint,
            board: bindInfo?.deviceBoard
          }
        } catch (error) {
          bindInfo = null
        }
      }
      const sdk = mysapi.getUrl('getFp', data)
      let fpRes
      try {
        // 与普通请求同口径的超时；响应体读取也在 try 内，体阶段超时同样按「没拿到指纹」处理
        const res = await fetch(sdk.url, {
          headers: sdk.headers,
          method: 'POST',
          body: sdk.body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        })
        fpRes = await res.json()
      } catch (error) {
        // 原实现这里连 try 都没有，异常会一路抛进过码链路、冲断整轮过码
        return { deviceFp: null }
      }
      deviceFp = fpRes?.data?.device_fp
      if (!deviceFp) {
        return { deviceFp: null }
      }
      await redis.set(`genshin:device_fp:${ltuid}:fp`, deviceFp, {
        EX: 86400 * 7
      })
      if (!/^(1[0-9]|[6-9])[0-9]{8}/i.test(uid)) {
        data['deviceFp'] = deviceFp
        const deviceLogin = mysapi.getUrl('deviceLogin', data)
        const saveDevice = mysapi.getUrl('saveDevice', data)
        if (!!deviceLogin && !!saveDevice) {
          try {
            const login = await fetch(deviceLogin.url, {
              headers: deviceLogin.headers,
              method: 'POST',
              body: deviceLogin.body,
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            })
            const save = await fetch(saveDevice.url, {
              headers: saveDevice.headers,
              method: 'POST',
              body: saveDevice.body,
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            })
            await Promise.all([login.json(), save.json()])
          } catch (error) {
            logger.error(`[米游社][设备登录]${error.message}`)
          }
        }
      }
    }

    return { deviceFp }
  }
}
