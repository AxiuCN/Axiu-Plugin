/** HSR API 客户端 — 继承 genshin MysApi
 *  移植自 StarRail-plugin runtime/MysSRApi.js
 *  覆盖 getServer / getUrl / getData / getHeaders / checkCode 适配星铁
 */

import md5 from 'md5'
import fetch from 'node-fetch'
import MysApi from '../../../genshin/model/mys/mysApi.js'
import SRApiTool from './srApiTool.js'
import { generateSeed } from './srApiTool.js'

export default class MysSrApi extends MysApi {
  constructor (uid, cookie, option = {}) {
    super(uid, cookie, { game: 'sr', ...option })
    this.uid = uid
    this.server = this.getServer()
    this.apiTool = new SRApiTool(uid, this.server)

    // 从 cookie 提取 device_id 或生成新的
    if (typeof this.cookie === 'string' && this.cookie.includes('device_id=')) {
      this._device = this.cookie.match(/device_id=([^;]*)/)?.[1] || crypto.randomUUID()
    } else {
      this._device = crypto.randomUUID()
    }
  }

  getServer () {
    const _uid = String(this.uid)
    switch (_uid.slice(0, -8)) {
      case '5': return 'prod_qd_cn'
      case '6': return 'prod_official_usa'
      case '7': return 'prod_official_euro'
      case '8':
      case '18': return 'prod_official_asia'
      case '9': return 'prod_official_cht'
    }
    return 'prod_gf_cn'
  }

  getUrl (type, data = {}) {
    const urlMap = this.apiTool.getUrlMap(data)
    if (!urlMap[type]) return false

    let { url, query = '', body = '', noDs = false, dsSalt = '' } = urlMap[type]

    if (query) url += `?${query}`
    if (body) body = JSON.stringify(body)

    let headers = this.getHeaders(query, body)

    // 设备指纹
    if (data.deviceFp) {
      headers['x-rpc-device_fp'] = data.deviceFp
      this._device_fp = { data: { device_fp: data.deviceFp } }
    }

    // 设备 ID
    if (data.deviceId) headers['x-rpc-device_id'] = data.deviceId

    // 设备绑定信息
    if (data?.deviceInfo && data?.modelName && data?.osVersion) {
      const osVersion = data.osVersion
      const modelName = data.modelName
      const deviceBrand = data.deviceInfo?.split('/')[0]
      const deviceDisplay = data.deviceInfo?.split('/')[3]
      try {
        headers['x-rpc-device_name'] = `${deviceBrand} ${modelName}`
        headers['x-rpc-device_model'] = modelName
        headers['x-rpc-csm_source'] = 'myself'
        headers['User-Agent'] = `Mozilla/5.0 (Linux; Android ${osVersion}; ${modelName} Build/${deviceDisplay}; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/111.0.5563.116 Mobile Safari/537.36 miHoYoBBS/2.73.1`
      } catch { /* 设备信息解析失败，使用默认 */ }
    } else {
      try {
        headers['x-rpc-device_name'] = 'Sony XQ-BC52'
        headers['x-rpc-device_model'] = 'XQ-BC52'
        headers['x-rpc-csm_source'] = 'myself'
      } catch { /* ignore */ }
    }

    // deviceLogin / saveDevice 特殊 headers
    if (type === 'deviceLogin' || type === 'saveDevice') {
      try {
        headers['x-rpc-sys_version'] = '12'
        headers['x-rpc-client_type'] = '2'
        headers['x-rpc-channel'] = 'miyousheluodi'
        headers['x-rpc-csm_source'] = 'home'
        headers.Host = 'bbs-api.miyoushe.com'
        headers['User-Agent'] = 'okhttp/4.9.3'
        headers.Referer = 'https://app.mihoyo.com/'
        headers.DS = this.getDS2()
      } catch { /* ignore */ }
    }

    if (!data.deviceId) {
      headers['x-rpc-device_id'] = this._device
    }

    switch (dsSalt) {
      case 'web': {
        headers.DS = this.getDS2()
        break
      }
      default:
    }

    // srPayAuthKey 额外 headers
    if (type === 'srPayAuthKey') {
      const extra = {
        'x-rpc-app_version': '2.73.1',
        'User-Agent': 'okhttp/4.9.3',
        'x-rpc-client_type': '2',
        Referer: 'https://act.mihoyo.com/',
        Origin: 'https://act.mihoyo.com',
        'x-rpc-sys_version': '12',
        'x-rpc-channel': 'miyousheluodi',
        'x-rpc-device_id': this._device,
        'x-rpc-device_name': 'XQ-BC52',
        'x-rpc-device_model': 'Sony XQ-BC52',
        Host: 'api-takumi.mihoyo.com'
      }
      headers = Object.assign(headers, extra)
    } else {
      headers.DS = this.getDs(query, body)
    }

    if (noDs) {
      delete headers.DS
      if (this._device) {
        body = JSON.parse(body)
        body.device_id = this._device
        body = JSON.stringify(body)
      }
    }

    return { url, headers, body }
  }

  async getData (type, data = {}, cached = false) {
    const ck = this.cookie
    const ltuid = ck.match(/ltuid=(\d+)/)?.[1]

    if (ltuid) {
      // 尝试获取绑定设备信息
      let bindInfo = await redis.get(`ZZZ:DEVICE_FP:${ltuid}:BIND`)
      if (bindInfo) {
        try {
          bindInfo = JSON.parse(bindInfo)
          data = {
            ...data,
            productName: bindInfo?.deviceProduct,
            deviceType: bindInfo?.deviceName,
            modelName: bindInfo?.deviceModel,
            oaid: bindInfo?.oaid,
            osVersion: bindInfo?.androidVersion,
            deviceInfo: bindInfo?.deviceFingerprint,
            board: bindInfo?.deviceBoard
          }
        } catch { bindInfo = null }
      }

      // 获取设备指纹
      const { deviceFp } = await this._getDeviceFp(ltuid, data)
      if (deviceFp) data.deviceFp = deviceFp

      // 获取设备 ID
      const device_id = await redis.get(`ZZZ:DEVICE_FP:${ltuid}:ID`)
      if (device_id) data.deviceId = device_id
    }

    // 懒加载设备指纹缓存
    if (!this._device_fp && !data?.Getfp && !data?.headers?.['x-rpc-device_fp']) {
      this._device_fp = await this.getData('getFp', { ...data, Getfp: true })
    }
    if (type === 'getFp' && !data?.Getfp) return this._device_fp

    const { url, headers, body } = this.getUrl(type, data)
    if (!url) return false

    const cacheKey = this.cacheKey(type, data)
    const cache = await redis.get(cacheKey)
    if (cache) return JSON.parse(cache)

    headers.Cookie = ck

    if (data.headers) {
      Object.assign(headers, data.headers)
    }

    if (type !== 'getFp' && !headers['x-rpc-device_fp'] && this._device_fp?.data?.device_fp) {
      headers['x-rpc-device_fp'] = this._device_fp.data.device_fp
    }

    const param = {
      headers,
      agent: await this.getAgent(),
      timeout: 10000
    }
    if (body) {
      param.method = 'post'
      param.body = body
    } else {
      param.method = 'get'
    }

    let response = {}
    const start = Date.now()
    try {
      response = await fetch(url, param)
    } catch (error) {
      logger.error(`[Axiu-Plugin][MysSrApi] fetch error: ${error.toString()}`)
      return false
    }

    if (!response.ok) {
      logger.error(`[Axiu-Plugin][MysSrApi][${type}][${this.uid}] ${response.status} ${response.statusText}`)
      return false
    }

    if (this.option.log) {
      logger.mark(`[米游社SR接口][${type}][${this.uid}] ${Date.now() - start}ms`)
    }

    const res = await response.json()
    if (!res) {
      logger.mark('[MysSrApi] 接口无返回')
      return false
    }

    res.api = type

    if (cached) this.cache(res, cacheKey)

    return res
  }

  /** 获取设备指纹（带 Redis 缓存，7 天） */
  async _getDeviceFp (ltuid, data) {
    let deviceFp = await redis.get(`ZZZ:DEVICE_FP:${ltuid}:FP`)
    if (deviceFp) return { deviceFp }

    const sdk = this.getUrl('getFp', data)
    if (!sdk) return { deviceFp: null }

    let res
    try {
      res = await fetch(sdk.url, { headers: sdk.headers, method: 'POST', body: sdk.body })
    } catch {
      // fetch 失败时使用兜底值
      deviceFp = /^(18|[6-9])[0-9]{8}/i.test(this.uid) ? '38d805c20d53d' : '38d7f4c72b736'
      return { deviceFp }
    }

    const fpRes = await res.json()
    logger.debug(`[Axiu-Plugin][MysSrApi] 设备指纹: ${JSON.stringify(fpRes)}`)
    deviceFp = fpRes?.data?.device_fp
    if (!deviceFp) return { deviceFp: null }

    await redis.set(`ZZZ:DEVICE_FP:${ltuid}:FP`, deviceFp, { EX: 86400 * 7 })

    // 国服需要 deviceLogin + saveDevice
    if (!/^(18|[6-9])[0-9]{8}/i.test(this.uid)) {
      data.deviceFp = deviceFp
      const deviceLogin = this.getUrl('deviceLogin', data)
      const saveDevice = this.getUrl('saveDevice', data)
      if (deviceLogin && saveDevice) {
        try {
          await Promise.all([
            fetch(deviceLogin.url, { headers: deviceLogin.headers, method: 'POST', body: deviceLogin.body }),
            fetch(saveDevice.url, { headers: saveDevice.headers, method: 'POST', body: saveDevice.body })
          ])
        } catch { /* 设备登录非关键 */ }
      }
    }

    return { deviceFp }
  }

  getHeaders (query = '', body = '') {
    const cn = {
      app_version: '2.73.1',
      User_Agent: 'Mozilla/5.0 (Linux; Android 13; XQ-BC52 Build/61.2.A.0.472A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/111.0.5563.116 Mobile Safari/537.36 miHoYoBBS/2.73.1',
      client_type: '5',
      Origin: 'https://webstatic.mihoyo.com',
      X_Requested_With: 'com.mihoyo.hyperion',
      Referer: 'https://webstatic.mihoyo.com/'
    }
    const os = {
      app_version: '2.57.1',
      User_Agent: 'Mozilla/5.0 (Linux; Android 13; XQ-BC52 Build/61.2.A.0.472A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/111.0.5563.116 Mobile Safari/537.36 miHoYoBBSOversea/2.57.1',
      client_type: '2',
      Origin: 'https://act.hoyolab.com',
      X_Requested_With: 'com.mihoyo.hoyolab',
      Referer: 'https://act.hoyolab.com/'
    }

    const client = /official/.test(this.server) ? os : cn

    return {
      'x-rpc-app_version': client.app_version,
      'x-rpc-client_type': client.client_type,
      'User-Agent': client.User_Agent,
      Referer: client.Referer,
      DS: this.getDs(query, body)
    }
  }

  getDs (q = '', b = '') {
    const n = /official/.test(this.server)
      ? 'okr4obncj8bw5a65hbnn5oo6ixjc3l9w'
      : 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs'
    const t = Math.round(Date.now() / 1000)
    const r = Math.floor(Math.random() * 900000 + 100000)
    return `${t},${r},${md5(`salt=${n}&t=${t}&r=${r}&b=${b}&q=${q}`)}`
  }

  getDS2 () {
    const t = Math.round(Date.now() / 1000)
    const r = randomString(6)
    return `${t},${r},${md5(`salt=WGtruoQrwczmsjLOPXzJLnaAYycsLavx&t=${t}&r=${r}`)}`
  }

  /**
   * 校验状态码 + 过码委托
   * @param {object} e - 消息 event
   * @param {object} res - API 响应
   * @param {string} type - API 类型
   * @param {object} data - 请求参数
   */
  async checkCode (e, res, type, data = {}) {
    if (!res || !e) {
      this.e?.reply?.('米游社接口请求失败，暂时无法查询')
      return false
    }
    this.e = e
    this.e.isSr = true
    res.retcode = Number(res.retcode)

    switch (res.retcode) {
      case 0:
        break
      case 10102:
        if (res.message === 'Data is not public for the user') {
          this.e.reply(`\nUID:${this.uid}，米游社数据未公开`)
        } else {
          this.e.reply(`UID:${this.uid}，请先去米游社绑定角色`)
        }
        break
      case 10041:
      case 5003:
        this.e.reply(`UID:${this.uid}，米游社账号异常，暂时无法查询`)
        break
      case 10035:
      case 1034: {
        const handler = this.e.runtime?.handler || {}
        if (handler.has('mys.req.err')) {
          logger.mark(`[Axiu-Plugin][MysSrApi][UID:${this.uid}][qq:${e.user_id}] 遇到验证码，调用过码 handler`)
          res = await handler.call('mys.req.err', this.e, { mysApi: this, type, res, data, mysInfo: this }) || res
        }
        if (!res || res?.retcode === 1034 || res?.retcode === 10035) {
          logger.mark(`[Axiu-Plugin][MysSrApi][UID:${this.uid}] 过码未成功`)
          this.e.reply('米游社查询遇到验证码，请稍后再试')
        }
        break
      }
      default:
        if (/(登录|login)/i.test(res.message)) {
          logger.mark(`[Axiu-Plugin][MysSrApi][UID:${this.uid}] ck失效`)
          this.e.reply(`UID:${this.uid}，米游社cookie已失效`)
        } else {
          this.e.reply(`米游社接口报错，暂时无法查询：${res.message || 'error'}`)
        }
        break
    }

    if (res.retcode !== 0) {
      logger.mark(`[Axiu-Plugin][MysSrApi] 接口报错 — ${JSON.stringify(res)}，UID：${this.uid}`)
    }
    return res
  }
}

/** 生成随机字符串 */
export function randomString (length = 6) {
  let s = ''
  for (let i = 0; i < length; i++) {
    s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]
  }
  return s
}
