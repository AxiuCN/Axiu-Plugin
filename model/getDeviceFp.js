import MysApi from './mys/mysApi.js'
import { fetchDeviceFp } from './mys/deviceFp.js'

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

  /**
   * 从 genshin 插件按真实 ltuid 写入的 `:bind` 派生 getFp 请求参数
   *
   * 只在指纹缓存未命中时调用（与合并前的读取时机一致）：命中缓存时这份数据用不到，
   * 提前读等于凭空多一次 Redis 请求。
   * @param {string} ltuid 米游社账号 ID
   * @returns {Promise<object>} getFp 请求参数
   */
  static async _bindData (ltuid) {
    let data = {}
    const bindInfo = await redis.get(`genshin:device_fp:${ltuid}:bind`)
    if (bindInfo) {
      // 走到这里说明指纹未命中，原实现在此处的 deviceFp 恒为 redis.get 未命中的 null
      data = { deviceFp: null }
      try {
        const bind = JSON.parse(bindInfo)
        data = {
          productName: bind?.deviceProduct,
          deviceType: bind?.deviceName,
          modelName: bind?.deviceModel,
          oaid: bind?.oaid,
          osVersion: bind?.androidVersion,
          deviceInfo: bind?.deviceFingerprint,
          board: bind?.deviceBoard
        }
      } catch {
        // bind 内容不是 JSON：沿用 `{ deviceFp: null }` 的旧口径
      }
    }
    return data
  }

  /**
   * 取设备指纹（Redis 缓存 7 天，缓存键与 genshin 插件共享）
   * @param {string} uid 游戏 UID
   * @param {string|object} ck 米游社 cookie（串或对象）
   * @param {string|object} game 游戏标识
   * @returns {Promise<{deviceFp: string|null}>} 拿不到指纹时 deviceFp 为 null
   */
  static async Fp (uid, ck, game) {
    const ltuid = this._resolveLtuid(ck, uid)
    const mysapi = new MysApi(uid, ck, game)
    return fetchDeviceFp({
      uid,
      ltuid,
      // 传函数：bind 派生推迟到共享实现确认缓存未命中之后
      data: () => this._bindData(ltuid),
      keyPrefix: 'genshin:device_fp',
      keySuffix: 'fp',
      // 过码链路拿不到指纹就按「没指纹」继续，不做硬编码兜底
      fallback: null,
      needRegister: (id) => !/^(1[0-9]|[6-9])[0-9]{8}/i.test(id),
      getUrl: (type, data) => mysapi.getUrl(type, data),
      // 本链路历史上串行注册并读响应体，失败记 error 日志
      registerMode: 'serial',
      onRegisterError: (error) => logger.error(`[米游社][设备登录]${error.message}`)
    })
  }
}
