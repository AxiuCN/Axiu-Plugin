/** QR 扫码登录 + 刷新CK
 *  从 xiaoyao-cvs-plugin apps/mhyTopUpLogin.js + apps/user.js 合并移植
 *  注：#更新抽卡记录 已迁移至 apps/gachaLog.js
 */

import plugin from '../../../lib/plugins/plugin.js'
import QrLogin from '../model/qrLogin.js'
import QrUser from '../model/qrUser.js'
import stokenStore from '../model/stokenStore.js'
import { getServer } from '../model/mys/passportUtils.js'
import { render } from '../components/render.js'
import { getPluginConfig } from '../components/config.js'
import { buildV2Cookie } from '../components/mysCookie.js'
import { LOG_PREFIX } from '../components/constants.js'

export class QrLoginApp extends plugin {
  constructor () {
    super({
      name: '[Axiu-Plugin] 扫码登录',
      dsc: 'QR扫码登录、刷新CK',
      event: 'message',
      priority: 500,
      rule: [
        {
          reg: '^#扫码(登录|登陆|绑定)$',
          fnc: 'qrCodeLogin',
          permission: 'all',
          log: true
        },
        {
          reg: '^#(刷新|更新|获取)(ck|cookie)$',
          fnc: 'updCookie',
          permission: 'all',
          log: true
        }
      ]
    })
  }

  /** 扫码登录开关（fail-closed：关闭时命令直接拒绝） */
  _qrEnabled () {
    return getPluginConfig()?.api?.qrLogin_enabled !== false
  }

  // ==================== #扫码登录 ====================

  async qrCodeLogin (e) {
    if (!this._qrEnabled()) {
      e.reply('扫码登录功能已关闭')
      return true
    }
    const qr = new QrLogin(e)
    await qr.init()

    const res = await qr.qrCodeLogin()
    if (!res?.data) return true

    const { url, ticket } = res.data

    // 渲染 QR 码 HTML 页面
    const imgRet = await render('qrCode', 'index', { url })
    if (!imgRet) {
      e.reply('QR码渲染失败，请稍后再试')
      return true
    }
    // 发送 QR 码，@绑定者（对齐逍遥：at用户 + 捕获消息ID用于扫码后撤回）
    const replyResult = await e.reply([segment.at(e.user_id), '\n请使用米游社扫描二维码登录', imgRet])
    const qrMsgId = replyResult?.message_id || replyResult

    // 轮询等待扫码（传入消息ID，扫码后自动撤回QR码）
    const loginRes = await qr.GetQrCode(ticket, qrMsgId)
    if (!loginRes) return true

    // 绑定 stoken + CK（对齐逍遥 bindSkCK）
    await this._bindSkCK(e, loginRes)
    return true
  }

  /** 扫码成功后绑定 stoken 并自动将 CK 注入 cookie 池（对齐逍遥 bindSkCK）
 *  绑定阶段（seachUid + bing）的提示合并为一条转发消息，避免扫码完成后连环刷屏
 */
  async _bindSkCK (e, loginRes) {
    // 拦截绑定阶段的所有 reply（seachUid「stoken绑定成功」/ bing「绑定Cookie成功+使用说明」），收集后合并转发
    const sendMsg = []
    const origReply = e.reply
    e.reply = (msg) => { sendMsg.push(msg) }

    try {
      // 1. 绑定 stoken
      e.msg = loginRes.stoken
      e.raw_message = loginRes.stoken
      await this._bindStoken(e, loginRes)

      // 2. 绑定 CK 到 V3 cookie 池（GetQrCode 已返回完整 cookie，无需再次获取）
      e.ck = loginRes.cookie
      e.msg = loginRes.cookie
      e.raw_message = loginRes.cookie
      try {
        const userck = (await import('../../../plugins/genshin/model/user.js')).default
        await (new userck(e)).bing()
        logger?.info(`${LOG_PREFIX} 扫码登录自动绑定CK成功: QQ=${e.user_id}`)
      } catch (err) {
        logger?.warn(`${LOG_PREFIX} 自动绑定CK失败: QQ=${e.user_id} ${err.message}`)
      }
    } finally {
      e.reply = origReply
    }

    // 合并转发绑定提示
    if (sendMsg.length > 0) {
      const msgList = [
        { message: '扫码登录成功，Bot大部分功能已开放' },
        ...sendMsg.map(msg => ({ message: msg }))
      ]
      const forwardMsg = e.isGroup
        ? await e.group.makeForwardMsg(msgList)
        : await e.friend.makeForwardMsg(msgList)
      await origReply(forwardMsg)
    }
  }

  /** 扫码成功后绑定 stoken（对齐逍遥 bindStoken） */
  async _bindStoken (e, loginRes) {
    const user = new QrUser(e)

    // 设置 stoken 消息格式供 seachUid 解析
    e.sk = new Map(Object.entries({
      stuid: loginRes.stoken.match(/stuid=([^;]*)/)?.[1] || '',
      stoken: loginRes.stoken.match(/stoken=([^;]*)/)?.[1] || '',
      ltoken: loginRes.stoken.match(/ltoken=([^;]*)/)?.[1] || '',
      mid: loginRes.stoken.match(/mid=([^;]*)/)?.[1] || ''
    }).filter(([, v]) => v))

    e.uid = e.sk.get('stuid')
    e.region = getServer(e.uid)
    e.raw_message = loginRes.stoken

    // 老 getCookieAccountInfoBySToken 已废弃（-464），改用 exchange 换 cookie_token_v2，
    // 再交给 seachUid（cookie 已带 ltoken_v2）查角色并保存 stoken
    const stoken = e.sk.get('stoken')
    const mid = e.sk.get('mid')
    const ex4 = await user.getData('exchange', { token: stoken, mid, dstTokenType: 4 }, false)
    const cookieToken = ex4?.data?.token?.token
    if (cookieToken) {
      await user.seachUid({ data: { cookie_token: cookieToken } })
    } else if (!String(stoken || '').startsWith('v2_')) {
      logger?.warn(`${LOG_PREFIX} 扫码返回的stoken不是v2_格式，无法换票，请重新扫码`)
    } else {
      logger?.warn(`${LOG_PREFIX} 扫码换cookie_token_v2失败: retcode=${ex4?.retcode} msg=${ex4?.message}`)
    }
  }

  // ==================== #刷新ck ====================

  async updCookie (e) {
    if (!this._qrEnabled()) {
      e.reply('扫码登录功能已关闭')
      return true
    }
    const stoken = await stokenStore.getUserStoken(e.user_id)
    if (Object.keys(stoken).length === 0) {
      e.reply('请先绑定stoken\n发送【#扫码登录】进行绑定')
      return true
    }

    const isGet = /获取/.test(e.msg)
    if (!e.isPrivate && isGet) {
      e.reply('请私聊发送')
      return true
    }

    const user = new QrUser(e)
    const sendMsg = []
    e._reply = e.reply
    e.reply = (msg) => { sendMsg.push(msg) }

    for (const item of Object.keys(stoken)) {
      const st = stoken[item]
      e.region = getServer(st.uid)
      e.uid = st.uid
      if (!e?.uid) {
        logger.mark(`${LOG_PREFIX} [刷新ck] qq:${e?.user_id} uid为空，跳过`)
        continue
      }

      // v1 stoken 换不了 v2 凭证，只能重新扫码
      if (!String(st?.stoken || '').startsWith('v2_')) {
        e.reply(`uid:${st.uid},stoken不是v2_格式，无法刷新，请重新扫码登录`)
        continue
      }

      // 老 getCookieAccountInfoBySToken 已废弃（-464），改走换票接口：
      // dst_token_type=2 → ltoken_v2；dst_token_type=4 → cookie_token_v2
      // 换票必须带 mid，早期条目缺 mid 时只能重新扫码
      const mid = st.mid || ''
      if (!mid) {
        e.reply(`uid:${st.uid},stoken缺少mid，无法刷新，请重新扫码登录`)
        continue
      }
      const ex2 = await user.getData('exchange', { token: st.stoken, mid, dstTokenType: 2 }, false)
      const ex4 = await user.getData('exchange', { token: st.stoken, mid, dstTokenType: 4 }, false)
      const ltoken = ex2?.data?.token?.token
      const cookieToken = ex4?.data?.token?.token
      if (!ltoken || !cookieToken) {
        const fail = !ltoken ? ex2 : ex4
        e.reply(`uid:${st.uid},请求异常：${fail?.message || fail?.retcode}`)
        continue
      }

      // 全 v2 cookie + 兼容旧别名（与扫码登录产出一致）
      e.msg = buildV2Cookie({ stuid: st.stuid, mid, ltoken, cookieToken })

      if (isGet) {
        sendMsg.push(`uid:${stoken[item].uid}`, e.msg)
      } else {
        // 绑定到 V3 cookie 系统
        try {
          const userck = (await import('../../../plugins/genshin/model/user.js')).default
          e.ck = e.msg
          await (new userck(e)).bing()
        } catch (err) {
          logger.error(`${LOG_PREFIX} 绑定cookie失败: ${err.message}`)
          e.reply(`uid:${stoken[item].uid},绑定cookie失败：${err.message}`)
        }
      }
    }

    // 合并转发结果
    if (sendMsg.length > 0) {
      // node 匿名：不携带机器人昵称（与 common.makeForwardMsg 一致）
      const msgList = sendMsg.map(msg => ({ message: msg }))
      const forwardMsg = e.isGroup
        ? await e.group.makeForwardMsg(msgList)
        : await e.friend.makeForwardMsg(msgList)
      await e._reply(forwardMsg)
    }
    return true
  }
}
