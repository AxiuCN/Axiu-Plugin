/** 用户模型 — 从 xiaoyao-cvs-plugin model/user.js + apps/user.js 精简移植
 *  保留：getData、cookie、stoken、seachUid、delSytk、getRefreshedCookieAndStoken
 *  删除：签到、BBS、云游戏 全部逻辑
 */

import fs from 'node:fs'
import YAML from 'yaml'
import lodash from 'lodash'
import PassportApi from './mys/passportApi.js'
import * as utils from './mys/passportUtils.js'
import gsCfg from './stokenStore.js'

const plugin = 'Axiu-Plugin'
const stokenPath = `./plugins/${plugin}/data/stoken/`

export default class QrUser {
  constructor (e) {
    this.e = e
    this.stokenPath = stokenPath
    this.configSign = {}
    try {
      this.configSign = gsCfg.getfileYaml(`./plugins/${plugin}/config/`, 'config')
    } catch { /* 配置不存在时使用空对象 */ }
  }

  /** 执行 API 请求（自动初始化 cookie） */
  async getData (type, data = {}, isck = true) {
    if (isck) {
      await this.cookie(this.e)
    }
    this.passportApi = new PassportApi(this.e)
    const res = await this.passportApi.getData(type, data)
    return res
  }

  /** Cookie 管理入口：检查 cookie → 尝试从 login_ticket 换取 stoken
   *  @param {object} e 事件对象
   *  @param {'gs'|'sr'} game 目标游戏（决定取哪个游戏的 UID / CK）
   */
  async cookie (e, game = 'gs') {
    const { cookie } = await this.getCookie(e, game)
    if (!cookie) return false

    const stokens = this.getStoken(e.user_id)
    if (!stokens) return true

    if (!cookie.includes('login_ticket')) return false

    const flot = await this.stoken(cookie, e)
    await utils.sleepAsync(1000)
    if (!flot) return false
    return true
  }

  /** 获取当前用户在指定游戏下的 cookie 和 uid
   *
   *  只负责「按游戏取当前账号」，不做跨游戏顶替：
   *  星铁没有绑定 CK 时返回空，由调用方决定提示还是改用其它来源。
   *  @param {object} e 事件对象
   *  @param {'gs'|'sr'} game
   *  @returns {Promise<{cookie: string, uid: string, skuid?: object}>}
   */
  async getCookie (e, game = 'gs') {
    let skuid, cookie, uid

    // 尝试从 genshin 插件获取（V3 运行时）：UID 与 CK 都按目标游戏取
    if (e?.user?.getUid) {
      uid = e.user.getUid(game)
      cookie = (e.user.getMysUser ? e.user.getMysUser(game) : e.user.mysUser)?.ck
    }

    // 以下两条回退只对原神成立：MysCookie 目录与 _regUid 都是原神旧数据
    if (!uid && game === 'gs') {
      try {
        skuid = gsCfg.getBingCookie(e.user_id)
        cookie = skuid?.ck
        uid = skuid?.item
      } catch { /* 文件不存在等 */ }
    }

    if (!uid && game === 'gs') {
      uid = e.runtime?.user?._regUid
    }

    // 调用方可能已按目标 UID 解析好 e.uid（如星铁命令带了 UID 参数），
    // 星铁口径下不回写 uid，避免把目标覆盖成「当前账号」的 UID
    if (game === 'gs') this.e.uid = uid
    this.e.cookie = cookie
    return { cookie, uid, skuid }
  }

  /** 按指定 UID 取同账号 CK
   *
   *  CK 是米游社账号级，但「哪个账号」由该 UID 的 ltuid 决定（genshin NoteUser.getMysUser 同源），
   *  因此目标 UID 不在本用户名下时返回 null，绝不拿其它账号的 CK 顶替。
   *  @param {object} e 事件对象
   *  @param {string} uid 目标 UID
   *  @param {'gs'|'sr'} game
   *  @returns {Promise<{uid: string, cookie: string}|null>}
   */
  async getCookieForUid (e, uid, game = 'gs') {
    if (!uid) return null
    const uidData = e?.user?.getUidData?.(uid, game)
    const ltuid = uidData?.ltuid
    if (!ltuid) return null
    const cookie = e?.user?.mysUsers?.[ltuid]?.ck
    return cookie ? { uid: String(uid), cookie } : null
  }

  /** 从 login_ticket 换取 stoken */
  async stoken (cookie, e) {
    this.e = e
    const datalist = this.getStoken(e.user_id) || {}
    if (Object.keys(datalist).length > 0) return true

    const map = await utils.getCookieMap(cookie)
    let loginTicket = map?.get('login_ticket')
    const loginUid = map?.get('login_uid') || map?.get('ltuid')

    // V3 回退：从 MysCookie 文件读取 login_ticket
    if (!loginTicket) {
      loginTicket = gsCfg.getBingCookie(e.user_id)?.login_ticket
    }

    const mhyapi = new PassportApi(this.e)
    const res = await mhyapi.getData('bbsStoken', { loginUid, loginTicket })
    if (res?.data) {
      datalist[e.uid] = {
        stuid: map?.get('account_id'),
        stoken: res.data.list[0].token,
        ltoken: res.data.list[1].token,
        uid: e.uid,
        userId: e.user_id,
        is_sign: true
      }
      gsCfg.saveBingStoken(e.user_id, datalist)
    }
    return true
  }

  /** 读取 stoken */
  getStoken (userId) {
    const file = `${stokenPath}${userId}.yaml`
    try {
      let ck = fs.readFileSync(file, 'utf-8')
      ck = YAML.parse(ck)
      // 兼容旧格式（单 uid 直接保存）
      if (ck?.uid) {
        const datalist = {}
        ck.userId = this.e.user_id
        datalist[ck.uid] = ck
        ck = datalist
        gsCfg.saveBingStoken(this.e.user_id, datalist)
      }
      return ck[this.e.uid] || {}
    } catch (error) {
      return {}
    }
  }

  /** QR 登录/绑定 stoken 后查找游戏 UID 并保存 */
  async seachUid (data) {
    if (data?.data) {
      let ltoken = ''
      let v2Sk

      if (this.e.sk) {
        const stuid = this.e.sk.get('stuid') || this.e.stuid
        const mid = this.e.sk.get('mid') || ''
        ltoken = this.e.sk.get('ltoken') || ''
        if (this.e.sk.get('stoken')?.includes('v2_')) {
          // 扫码结果已直接带 ltoken_v2，不再调用已废弃的 getLTokenBySToken
          if (!ltoken) {
            const res = await this.getData('getLtoken', { cookies: this.e.raw_message }, false)
            ltoken = res?.data?.ltoken
          }
          // 全 v2 cookie（cookie_token 由 exchange 换得）+ 兼容旧别名
          this.e.cookie = [
            `account_id_v2=${stuid}`,
            mid ? `account_mid_v2=${mid}` : '',
            `cookie_token_v2=${data.data.cookie_token}`,
            mid ? `ltmid_v2=${mid}` : '',
            `ltoken_v2=${ltoken}`,
            `ltuid_v2=${stuid}`,
            `account_id=${stuid}`,
            `ltuid=${stuid}`,
            mid ? `mid=${mid}` : '',
            `ltoken=${ltoken}`,
            `cookie_token=${data.data.cookie_token}`
          ].filter(Boolean).join(';') + ';'
        } else {
          v2Sk = await this.getData('getByStokenV2', { headers: { Cookie: this.e.raw_message } }, false)
          this.e.cookie =
            `ltoken=${this.e.sk?.get('ltoken') || ltoken};ltuid=${stuid};cookie_token=${data.data.cookie_token}; account_id=${stuid};`
        }
      } else {
        this.e.cookie = this.e.original_msg
        this.cookies = `stuid=${this.e.stuid};stoken=${data?.data?.list[0].token};ltoken=${data?.data?.list[1].token}`
        const res = await this.getData('getLtoken', { cookies: this.cookies }, false)
        ltoken = res?.data?.ltoken
        v2Sk = await this.getData('getByStokenV2', { headers: { Cookie: this.cookies } }, false)
      }

      // 查找原神 + 星铁角色
      const list = []
      for (const game of ['原神', '崩坏星穹铁道']) {
        const result = await this.getData('userGameInfo', {
          biz: game === '原神' ? 'hk4e_cn' : 'hkrpg_cn'
        }, false)
        if (result?.retcode !== 0) continue
        list.push(...(result?.data?.list || []))
      }
      if (list.length === 0) {
        logger.warn(`[Axiu-Plugin] seachUid 未查到角色列表 uid=${this.e?.uid}，stoken 未保存`)
        return false
      }

      const uids = []
      for (const s of list) {
        const datalist = {}
        const uid = s.game_uid
        uids.push(s.region_name + ':' + uid)
        datalist[uid] = {
          stuid: this.e?.sk?.get('stuid') || this.e.stuid,
          stoken: v2Sk?.data?.token?.token || this.e?.sk?.get('stoken') || data?.data?.list[0].token,
          ltoken: this.e?.sk?.get('ltoken') || ltoken || data?.data?.list[1].token,
          mid: this.e?.sk?.get('mid') || v2Sk?.data?.user_info?.mid,
          uid,
          userId: this.e.user_id,
          is_sign: true,
          region_name: s.region_name,
          region: s.region
        }
        await gsCfg.saveBingStoken(this.e.user_id, datalist)
      }

      const msg = `${uids.join('\n')}\nstoken绑定成功您可通过下列指令进行操作:` +
        '\n【#更新抽卡记录】更新抽卡记录' +
        '\n【#刷新ck】刷新失效cookie' +
        '\n【#我的stoken】查看绑定信息' +
        '\n【#删除stoken】删除绑定信息'
      this.e.reply(msg)
    }
  }

  /** 删除 stoken 或云原神 token */
  async delSytk (path = stokenPath, e, type = 'stoken') {
    await this.getCookie(e)
    const file = `${path}${e.user_id}.yaml`
    fs.exists(file, (exists) => {
      if (!exists) return true
      let ck = fs.readFileSync(file, 'utf-8')
      ck = YAML.parse(ck)
      if (!ck) return true
      // 云原神 token 格式（yuntoken 字段）
      if (ck?.yuntoken) {
        fs.unlinkSync(file)
        return true
      }
      if (!ck[e.uid]) return true
      const sk = ck[e.uid]
      lodash.forEach(ck, (v, i) => {
        if (sk?.stoken === v?.stoken) delete ck[i]
      })
      if (Object.keys(ck).length === 0) {
        fs.unlinkSync(file)
      } else {
        fs.writeFileSync(file, YAML.stringify(ck), 'utf8')
      }
      e.reply(`已删除${/米游社|mys|米币|米游币|sk|stoken/.test(e.msg) ? 'stoken' : '云原神token'}`)
      return true
    })
  }

  /** 获取全部 stoken 列表 */
  async getBingStoken () {
    return gsCfg.getBingStoken()
  }

  // ====================================================
  // === #刷新ck 核心：迭代 stoken → exchange 换票 → 返回新 cookie ===
  // ====================================================

  /**
   * 刷新并获取用户的 stoken 和 cookie
   * @param {string} userId QQ号
   * @returns {Promise<Object|null>}
   */
  async getRefreshedCookieAndStoken (userId) {
    const stokenData = await gsCfg.getUserStoken(userId)
    if (Object.keys(stokenData).length === 0) {
      logger.warn(`[Axiu-Plugin] 用户 ${userId} 未绑定stoken`)
      return null
    }

    const firstAccountKey = Object.keys(stokenData)[0]
    const accountStoken = stokenData[firstAccountKey]

    // uid 传游戏 uid，使 PassportApi 能从 stoken YAML 构建 Cookie header（对齐 TRSS）
    const e = { user_id: userId, uid: String(firstAccountKey) }
    const user = new QrUser(e)

    if (!accountStoken?.stuid || !accountStoken?.stoken) {
      logger.error(`[Axiu-Plugin] 用户 ${userId} 的stoken数据不完整`)
      return null
    }
    // v1 stoken 换不了 v2 凭证，只能重新扫码
    if (!String(accountStoken.stoken).startsWith('v2_')) {
      logger.error(`[Axiu-Plugin] 用户 ${userId} 的stoken不是v2_格式，无法换票，请重新扫码绑定`)
      return null
    }

    // 老的 getCookieAccountInfoBySToken 已废弃（-464「请使用最新版本产品/链接」），改走换票接口：
    // dst_token_type=2 → ltoken_v2；dst_token_type=4 → cookie_token_v2
    const mid = accountStoken.mid || ''
    const ex2 = await user.getData('exchange', { token: accountStoken.stoken, mid, dstTokenType: 2 }, false)
    const ex4 = await user.getData('exchange', { token: accountStoken.stoken, mid, dstTokenType: 4 }, false)
    const ltoken = ex2?.data?.token?.token
    const cookieToken = ex4?.data?.token?.token

    if (!ltoken) {
      logger.error(`[Axiu-Plugin] 换取ltoken_v2失败: ${ex2?.message || ex2?.retcode || '接口返回为空'}`)
      return null
    }
    if (!cookieToken) {
      logger.error(`[Axiu-Plugin] 换取cookie_token_v2失败: ${ex4?.message || ex4?.retcode || '接口返回为空'}`)
      return null
    }

    // 全 v2 cookie + 兼容 Axiu 内部按 ltuid/account_id 解析的旧别名（与 qrLogin._buildLoginResult 一致）
    const fullCookie = [
      `account_id_v2=${accountStoken.stuid}`,
      mid ? `account_mid_v2=${mid}` : '',
      `cookie_token_v2=${cookieToken}`,
      mid ? `ltmid_v2=${mid}` : '',
      `ltoken_v2=${ltoken}`,
      `ltuid_v2=${accountStoken.stuid}`,
      `account_id=${accountStoken.stuid}`,
      `ltuid=${accountStoken.stuid}`,
      mid ? `mid=${mid}` : '',
      `ltoken=${ltoken}`,
      `cookie_token=${cookieToken}`
    ].filter(Boolean).join(';') + ';'

    return {
      cookie: fullCookie,
      ltoken,
      stuid: accountStoken.stuid,
      stoken: accountStoken.stoken,
      mid
    }
  }
}
