import fetch from 'node-fetch'
import MysApi from './mys/mysApi.js'
import { maskSecrets, maskUrl } from '../components/maskSecrets.js'

export default class getDeviceFp {
  static async Fp(uid, ck, game) {
    let ltuid = ck.ltuid
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
      const res = await fetch(sdk.url, {
        headers: sdk.headers,
        method: 'POST',
        body: sdk.body
      })
      const fpRes = await res.json()
      // 脱敏后再写日志（fpRes 可能含设备 id/指纹等敏感字段）
      logger.debug(`[米游社][设备指纹]${JSON.stringify(maskSecrets(fpRes))}`)
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
          logger.debug(`[米游社][设备登录]保存设备信息`)
          try {
            // 脱敏 URL 与响应后再写日志（deviceLogin 的 headers 含 Cookie，result 含设备凭据）
            logger.debug(`[米游社][设备登录]${maskUrl(deviceLogin.url)}`)
            const login = await fetch(deviceLogin.url, {
              headers: deviceLogin.headers,
              method: 'POST',
              body: deviceLogin.body
            })
            const save = await fetch(saveDevice.url, {
              headers: saveDevice.headers,
              method: 'POST',
              body: saveDevice.body
            })
            const result = await Promise.all([login.json(), save.json()])
            logger.debug(`[米游社][设备登录]${JSON.stringify(maskSecrets(result))}`)
          } catch (error) {
            logger.error(`[米游社][设备登录]${error.message}`)
          }
        }
      }
    }

    return { deviceFp }
  }
}
