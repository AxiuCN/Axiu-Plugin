/** QR 登录编排 — 从 xiaoyao-cvs-plugin model/mhyTopUpLogin.js 精简移植
 *  仅保留：qrCodeLogin、GetQrCode、pickToken
 *  删除：密码登录、充值、订单
 */

import QrUser from './qrUser.js'
import { sleepAsync, randomString } from './mys/passportUtils.js'

export default class QrLogin {
  constructor (e) {
    this.e = e
    this.sendMsgUser = '免责声明:您将通过扫码完成获取米游社sk以及ck。\n请使用米游社扫描二维码登录。'
    // 本次扫码的 device，建码 → 轮询 全程复用，写入请求头 x-rpc-device_id（对齐新版 xiaoyao）
    this.device = randomString(16, true)
  }

  async init () {
    this.user = new QrUser(this.e)
  }

  /** 创建 QR 登录请求，返回 {url, ticket} */
  async qrCodeLogin () {
    // 防重复触发（5分钟）
    const redisKey = `Axiu-Plugin:qrLogin:${this.e.user_id}`
    const redisData = await redis.get(redisKey)
    if (redisData) {
      this.e.reply([segment.at(this.e.user_id), '前置二维码未扫描，请勿重复触发指令'])
      return false
    }

    const res = await this.user.getData('qrCodeLogin', { device: this.device }, false)
    if (!res?.data?.url) {
      this.e.reply('获取二维码失败，请稍后再试')
      return false
    }

    res.data.ticket = res?.data?.ticket || res?.data?.url?.split('ticket=')[1]
    if (!res.data.ticket) {
      this.e.reply('二维码数据异常，未找到ticket')
      return false
    }

    return res
  }

  /** 轮询扫码状态（5s × 60次 = 5分钟），确认后返回 {cookie, stoken}
   * @param {string} ticket
   * @param {string} qrMsgId QR 消息 ID，扫码后自动撤回
   */
  async GetQrCode (ticket, qrMsgId) {
    if (!ticket) return false

    const redisKey = `Axiu-Plugin:qrLogin:${this.e.user_id}`
    // 设置5分钟缓存，防重复触发
    await redis.set(redisKey, JSON.stringify({ GetQrCode: 1 }), { EX: 300 })

    let res
    let redisData = { GetQrCode: 1 }

    for (let n = 1; n < 60; n++) {
      await sleepAsync(5000)
      res = await this.user.getData('qrCodeQuery', { device: this.device, ticket }, false)

      if (res?.retcode && res.retcode !== 0) {
        await redis.del(redisKey)
        await this.e.reply(res?.message || '二维码已过期', true)
        return false
      }

      const status = res?.data?.status || res?.data?.stat
      if (status === 'Scanned' && redisData.GetQrCode === 1) {
        // 【安全】不记录完整响应：虽无 token 但 user_info 含手机号/实名信息
        logger.mark(`[Axiu-Plugin] QR status=Scanned user=${this.e?.user_id}`)
        // 撤回二维码图片
        if (qrMsgId) {
          try {
            this.e.group?.recallMsg?.(qrMsgId) || this.e.friend?.recallMsg?.(qrMsgId)
          } catch {}
        }
        await this.e.reply('二维码已扫描，请确认登录', true)
        redisData.GetQrCode++
      }
      if (status === 'Confirmed') {
        // 【安全】不记录完整响应：tokens[] 包含明文 stoken，泄露即账号接管
        logger.mark(`[Axiu-Plugin] QR status=Confirmed user=${this.e?.user_id}`)
        break
      }
    }

    await redis.del(redisKey)

    if ((res?.data?.status || res?.data?.stat) !== 'Confirmed') {
      await this.e.reply('验证超时', true)
      return false
    }

    const result = await this._buildLoginResult(res)
    if (result.error) {
      await this.e.reply(result.error, true)
      return false
    }

    return { cookie: result.cookie, stoken: result.stoken }
  }

  /**
   * 由「扫码已确认」的响应组装 {cookie, stoken}（只取数，不回复、不落盘）
   *
   * ltoken 与 stoken 必须分开取：扫码走 passport 登录，响应的 `tokens[]` 通常只有
   * stoken/stoken_v2；任何「任意非空 token」的兜底都会把 stoken 当成 ltoken 用，
   * 并短路掉 getLtoken 的正确结果（第四轮 #1）。
   *
   * @param {object} res 二维码轮询的 Confirmed 响应
   * @returns {Promise<{cookie?:string, stoken?:string, ltoken?:string, error?:string}>}
   */
  async _buildLoginResult (res) {
    const SToken = this.pickToken(res?.data?.tokens, ['stoken_v2', 'stoken'])?.token
    const stuid = res?.data?.user_info?.aid || res?.data?.user_info?.uid || res?.data?.user_info?.account_id
    const mid = res?.data?.user_info?.mid

    if (!SToken || !stuid) {
      return { error: '扫码登录返回信息不完整，未能获取stoken' }
    }
    if (!String(SToken).startsWith('v2_')) {
      return { error: '扫码返回的 stoken 不是 v2_ 格式，无法换票，请重新扫码' }
    }

    // 走换票接口（老的 getCookieAccountInfoBySToken 已废弃，会 -464「请使用最新版本」）
    // dst_token_type=2 → ltoken_v2；dst_token_type=4 → cookie_token_v2
    const ex2 = await this.user.getData('exchange', { token: SToken, mid, dstTokenType: 2 }, false)
    const ex4 = await this.user.getData('exchange', { token: SToken, mid, dstTokenType: 4 }, false)
    const ltoken = ex2?.data?.token?.token
    const cookieToken = ex4?.data?.token?.token

    if (!ltoken) {
      return { error: `扫码换取 ltoken_v2 失败：${ex2?.message || '接口返回为空'}` }
    }
    if (!cookieToken) {
      return { error: `扫码换取 cookie_token_v2 失败：${ex4?.message || '接口返回为空'}` }
    }

    // 全 v2 cookie（与 MiyoQian build_cookie 一致）+ 兼容 Axiu 内部按 ltuid/account_id 解析的旧别名
    const cookie = [
      `account_id_v2=${stuid}`,
      mid ? `account_mid_v2=${mid}` : '',
      `cookie_token_v2=${cookieToken}`,
      mid ? `ltmid_v2=${mid}` : '',
      `ltoken_v2=${ltoken}`,
      `ltuid_v2=${stuid}`,
      `account_id=${stuid}`,
      `ltuid=${stuid}`,
      mid ? `mid=${mid}` : '',
      `ltoken=${ltoken}`,
      `cookie_token=${cookieToken}`
    ].filter(Boolean).join(';') + ';'

    return {
      ltoken,
      cookie,
      stoken: `stoken=${SToken};stuid=${stuid};ltoken=${ltoken};${mid ? `mid=${mid};` : ''}`
    }
  }

  /** 从 token 数组中按名称优先级匹配
   * @param {Array} tokens
   * @param {string[]} names 名称优先级
   * @param {boolean} [fallback=true] 无具名匹配时是否兜底取「任意非空 token」
   *   —— 只有字段名不由我们掌握的场景（stoken）才该兜底；**ltoken 绝不能兜底**（第四轮 #1）
   */
  pickToken (tokens = [], names = [], fallback = true) {
    if (!Array.isArray(tokens)) return false
    for (const name of names) {
      const token = tokens.find(item => item?.name === name)
      if (token?.token) return token
    }
    return fallback ? tokens.find(item => item?.token) : false
  }
}
