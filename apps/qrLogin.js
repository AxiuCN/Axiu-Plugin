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

  // ==================== #扫码登录 ====================

  async qrCodeLogin (e) {
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

  /** 扫码成功后绑定 stoken 并自动将 CK 注入 cookie 池（对齐逍遥 bindSkCK） */
  async _bindSkCK (e, loginRes) {
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

    // 调 bbsGetCookie + userGameInfo → seachUid 保存
    const ckRes = await user.getData('bbsGetCookie',
      { cookies: `uid=${e.sk.get('stuid')}&stoken=${e.sk.get('stoken')}${e.sk.get('mid') ? '&mid=' + e.sk.get('mid') : ''}` },
      false
    )
    if (ckRes?.data) {
      await user.seachUid(ckRes)
    }
  }

  // ==================== #刷新ck ====================

  async updCookie (e) {
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
      e.region = getServer(stoken[item].uid)
      e.uid = stoken[item].uid
      if (!e?.uid) {
        logger.mark(`${LOG_PREFIX} [刷新ck] qq:${e?.user_id} uid为空，跳过`)
        continue
      }

      let cookies = `uid=${stoken[item].stuid}&stoken=${stoken[item].stoken}`
      if (stoken[item]?.mid) cookies += `&mid=${stoken[item]?.mid}`

      const data = { cookies }
      if (String(e.uid)[0] * 1 > 5) data.method = 'post'

      const res = await user.getData('bbsGetCookie', data, false)
      if (!res?.data) {
        e.reply(`uid:${stoken[item].uid},请求异常：${res?.message || res?.retcode}`)
        continue
      }

      const ck = res.data.cookie_token
      e.msg = `ltoken=${stoken[item].ltoken};ltuid=${stoken[item].stuid};cookie_token=${ck}; account_id=${stoken[item].stuid};`

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
      const bot = e.bot || Bot
      const nickname = bot.nickname || 'Yunzai-Bot'
      const msgList = sendMsg.map(msg => ({
        message: msg,
        nickname,
        user_id: bot.uin
      }))
      const forwardMsg = e.isGroup
        ? await e.group.makeForwardMsg(msgList)
        : await e.friend.makeForwardMsg(msgList)
      await e._reply(forwardMsg)
    }
    return true
  }
}
