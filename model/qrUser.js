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

  /** Cookie 管理入口：检查 cookie → 尝试从 login_ticket 换取 stoken */
  async cookie (e) {
    const { cookie, uid } = await this.getCookie(e)
    if (!cookie) return false

    const stokens = this.getStoken(e.user_id)
    if (!stokens) return true

    if (!cookie.includes('login_ticket')) return false

    const flot = await this.stoken(cookie, e)
    await utils.sleepAsync(1000)
    if (!flot) return false
    return true
  }

  /** 获取当前用户的 cookie 和 uid */
  async getCookie (e) {
    let skuid, cookie, uid

    // 尝试从 genshin 插件获取（V3 运行时）
    if (e?.user?.getUid) {
      uid = e?.user?.getUid('gs')
      cookie = e?.user?.mysUser?.ck
    }

    // 回退：从 MysCookie 目录读取
    if (!uid) {
      try {
        skuid = gsCfg.getBingCookie(e.user_id)
        cookie = skuid?.ck
        uid = skuid?.item
      } catch { /* 文件不存在等 */ }
    }

    if (!uid) {
      uid = e.runtime?.user?._regUid
    }

    this.e.uid = uid
    this.e.cookie = cookie
    return { cookie, uid, skuid }
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
        if (this.e.sk.get('stoken')?.includes('v2_')) {
          const res = await this.getData('getLtoken', { cookies: this.e.raw_message }, false)
          ltoken = res?.data?.ltoken
        } else {
          v2Sk = await this.getData('getByStokenV2', { headers: { Cookie: this.e.raw_message } }, false)
        }
        this.e.cookie =
          `ltoken=${this.e.sk?.get('ltoken') || ltoken};ltuid=${this.e.sk?.get('stuid')};cookie_token=${data.data.cookie_token}; account_id=${this.e.sk?.get('stuid')};`
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
      if (list.length === 0) return false

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
  // === #刷新ck 核心：迭代 stoken → bbsGetCookie → 返回新 cookie ===
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

    let cookiesForRefresh = `uid=${accountStoken.stuid}&stoken=${accountStoken.stoken}`
    if (accountStoken?.mid) {
      cookiesForRefresh += `&mid=${accountStoken.mid}`
    }

    const cookieHeader = [
      `stuid=${accountStoken.stuid}`,
      `stoken=${accountStoken.stoken}`,
      accountStoken?.mid ? `mid=${accountStoken.mid}` : ''
    ].filter(Boolean).join(';') + ';'

    const res = await user.getData('bbsGetCookie', { cookies: cookiesForRefresh, cookieHeader }, false)
    if (!res?.data?.cookie_token) {
      logger.error(`[Axiu-Plugin] 刷新cookie_token失败: ${res?.message || res?.retcode}`)
      return null
    }

    const ck = res.data.cookie_token
    const fullCookie = `ltoken=${accountStoken.ltoken};ltuid=${accountStoken.stuid};cookie_token=${ck};account_id=${accountStoken.stuid};`

    return {
      cookie: fullCookie,
      stuid: accountStoken.stuid,
      stoken: accountStoken.stoken,
      mid: accountStoken.mid || ''
    }
  }
}
