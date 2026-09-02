/** 原神抽卡记录管理
 *  命令1: #更新抽卡记录 — Mihoyo 官方 API（从 qrLogin 迁移，精简为仅更新）
 *  命令2: #更新小助手抽卡记录 [链接] — lelaer.com 全历史导入（从天如移植）
 *  命令3: #获取抽卡链接 — stoken→authkey→返回 URL（仅私聊）
 *
 *  三个命令各有独立的 5 分钟频率限制锁。
 *  星铁抽卡记录见 apps/srGachaLog.js（stoken→authkey→genshin GachaLog 全量拉取）
 */

import plugin from '../../../lib/plugins/plugin.js'
import fetch from 'node-fetch'
import { getServer } from '../model/mys/passportUtils.js'
import { LOG_PREFIX } from '../components/constants.js'
import { tryAcquireGachaLock, gachaLockRemaining, getUidFromNoteUser, getAuthKey } from '../components/gachaUtils.js'

/** 卡池类型 → 中文名 */
const TYPE_NAME = {
  301: '角色',
  302: '武器',
  500: '集录',
  200: '常驻'
}

export class gsGachaLog extends plugin {
  constructor () {
    super({
      name: '[Axiu-Plugin] 原神抽卡记录管理',
      dsc: '原神更新抽卡记录、提瓦特小助手全历史导入、获取抽卡链接',
      event: 'message',
      priority: 500,
      rule: [
        // 命令1: #更新抽卡记录（从 qrLogin 迁移，精简为仅更新）
        {
          reg: '^#更新抽卡记录$',
          fnc: 'gachaLog',
          permission: 'all',
          log: true
        },
        // 命令2: #更新小助手抽卡记录 [链接] / #获取提瓦特小助手抽卡记录（从天如移植）
        {
          reg: '^#?(获取|更新)(提瓦特)?小助手(抽卡|祈愿)?(记录|历史)( *|(\\r|\\n)*)(https.*)?',
          fnc: 'gachaLogAssistant'
        },
        // 命令3: #获取抽卡链接（仅私聊）
        {
          reg: '^#获取抽卡链接$',
          fnc: 'getGachaUrl',
          permission: 'all'
        }
      ]
    })
  }

  // ==================== 命令1: #更新抽卡记录（从 qrLogin 迁移，仅保留更新） ====================

  async gachaLog (e) {
    // 任务开始前原子占锁（SET NX EX），并发重复命令只有一个能执行
    const lockKey = `Axiu-Plugin:gachaLog:update:${e.user_id}`
    if (!await tryAcquireGachaLock(lockKey)) {
      e.reply(`请求过快，请${await gachaLockRemaining(lockKey) || 5 * 60}秒后重试...`)
      return true
    }

    const user = new QrUser(e)
    await user.cookie(e)

    // 获取 authkey
    if (!e.uid) {
      e.uid = e?.runtime?.user?._regUid
    }
    e.region = getServer(e.uid)

    const authkeyRes = await user.getData('authKey', {
      auth_appid: 'webview_gacha'
    })
    if (!authkeyRes?.data) {
      // 命中登录失效类错误时给出明确指引（API 原文为「登录状态失效，请重新登录」，需放宽匹配）
      e.reply(`uid:${e.uid},authkey获取失败：${/登录(状态)?失效/.test(authkeyRes?.message || '') ? '请重新绑定stoken' : authkeyRes?.message}`)
      return true
    }

    const authkey = authkeyRes.data.authkey

    // 构造抽卡 URL → 委托 genshin 插件
    e.msg = `https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey_ver=1&sign_type=2&auth_appid=webview_gacha&init_type=301&gacha_id=fecafa7b6560db5f3182222395d88aaa6aaac1bc&timestamp=${Math.floor(Date.now() / 1000)}&lang=zh-cn&device_type=mobile&plat_type=ios&region=${e.region}&authkey=${encodeURIComponent(authkey)}&game_biz=hk4e_cn&gacha_type=301&page=1&size=5&end_id=0`

    try {
      const GachaLog = (await import('../../genshin/model/gachaLog.js')).default
      await (new GachaLog(e)).logUrl()
    } catch (err) {
      logger.error(`${LOG_PREFIX} 更新抽卡记录失败: ${err.message}`)
      e.reply(`更新抽卡记录失败：${err.message}`)
    }
    return true
  }

  // ==================== 命令2: #更新小助手抽卡记录（从天如移植） ====================

  async gachaLogAssistant (e) {
    // 任务开始前原子占锁
    const lockKey = `Axiu-Plugin:gachaLog:assistant:${e.user_id}`
    if (!await tryAcquireGachaLock(lockKey)) {
      e.reply(`请求过快，请${await gachaLockRemaining(lockKey) || 5 * 60}秒后重试...`)
      return true
    }
    this.e._lockKey = lockKey

    // 用户提供了抽卡链接 → 解析链接获取 authkey
    const urlMatch = /https.*/.exec(this.e.msg)
    if (urlMatch) {
      if (!this.e.uid) {
        this.e.uid = e?.runtime?.user?._regUid || await getUidFromNoteUser(this.e)
      }
      this.e.msg = urlMatch[0]
      await this.logUrl(e)
      return true
    }

    // 尝试通过 stoken 获取 authkey
    if (!this.e.uid) {
      this.e.uid = e?.runtime?.user?._regUid || await getUidFromNoteUser(this.e)
    }
    if (!this.e.region) {
      this.e.region = getServer(this.e.uid)
    }

    const authkey = await getAuthKey(this.e)

    if (!authkey) {
      this.e.reply('获取authkey失败，stoken可能已过期\n请发送【#扫码登录】重新绑定')
      return true
    }

    this.e.authkey = authkey
    await this._getGcLog(e)
    return true
  }

  /** context 回调：用户发送了抽卡链接 */
  async logUrl (e) {
    if (!this.e.uid) {
      this.e.uid = e?.runtime?.user?._regUid || await getUidFromNoteUser(this.e)
    }
    const GachaLog = (await import('../../genshin/model/gachaLog.js')).default
    const gacha = new GachaLog(e)
    gacha.uid = this.e.uid
    const url = this.e.msg
    const param = gacha.dealUrl(url)
    if (!param) {
      this.finish('logUrl')
      return
    }
    if (!await gacha.checkUrl(param)) {
      this.e.reply('链接错误或已失效')
      this.finish('logUrl')
      return
    }
    this.e.authkey = param.authkey
    this.e.region = param.region
    await this._getGcLog(e)
    this.finish('logUrl')
  }

  /** 核心：POST lelaer.com → 解析 UIGF JSON → 合并写入本地 GachaLog */
  async _getGcLog (e) {
    if (!this.e.authkey) return true
    if (!this.e.uid) {
      this.e.uid = e?.runtime?.user?._regUid || await getUidFromNoteUser(this.e)
    }

    const gachaURL = `https://hk4e-api.mihoyo.com/event/gacha_info/api/getGachaLog?authkey_ver=1&sign_type=2&auth_appid=webview_gacha&init_type=301&gacha_id=fecafa7b6560db5f3182222395d88aaa6aaac1bc&timestamp=${Math.floor(Date.now() / 1000)}&lang=zh-cn&device_type=mobile&plat_type=ios&region=${this.e.region}&authkey=${encodeURIComponent(this.e.authkey)}&game_biz=hk4e_cn&gacha_type=301&page=1&size=5&end_id=0`

    let response
    try {
      response = await fetch('https://www.lelaer.com/outputGacha.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `uid=${this.e.uid}&gachaurl=${encodeURIComponent(gachaURL)}&lang=zh-Hans`,
        // 宿主 fetch 为自实现（undici），timeout 选项会被静默忽略，改用 AbortSignal 超时
        signal: AbortSignal.timeout(10000)
      })
    } catch (err) {
      logger?.error(`${LOG_PREFIX}[小助手] 请求 lelaer.com 失败: ${err.message}`)
      this.e.reply('获取抽卡记录失败，请稍后再试')
      return true
    }

    let json
    try {
      json = await response.json()
    } catch {
      this.e.reply('解析抽卡记录失败')
      return true
    }

    const list = json?.list
    if (!json || !list) {
      await this.e.reply(`获取失败 ${json?.result || ''}`)
      return true
    }
    if (!list.length) {
      await this.e.reply('"提瓦特小助手"抽卡记录为空')
      return true
    }

    // 校验 UIGF 必要字段
    const reqField = ['gacha_type', 'item_type', 'name', 'time']
    for (const field of reqField) {
      if (!list[0][field]) {
        this.e.reply(`数据格式错误：缺少必要字段${field}`)
        return true
      }
    }

    // 按 uigf_gacha_type 分组
    const data = {}
    for (const item of list) {
      const type = item.uigf_gacha_type
      if (!data[type]) data[type] = []
      data[type].push(item)
    }

    // 逐池子合并写入本地
    const msg = []
    const GachaLog = (await import('../../genshin/model/gachaLog.js')).default
    const gachaLog = new GachaLog(this.e)
    gachaLog.uid = this.e.uid

    for (const type of Object.keys(data)) {
      if (!TYPE_NAME[type]) continue
      gachaLog.type = Number(type)
      const log = gachaLog.readJson()
      const merged = mergeJson(log.list, data[type])
      gachaLog.writeJson(merged)
      msg.push(`${TYPE_NAME[type]}记录：${data[type].length}条，现共${merged.length}条`)
    }

    msg.push('导入成功')
    msg.push('您还可回复\n【#全部记录】统计全部抽卡数据\n【#武器记录】统计武器池数据\n【#角色统计】按卡池统计数据\n【#导出记录】导出记录数据')
    await this.e.reply(msg.join('\n'))
  }

  // ==================== 命令3: #获取抽卡链接（仅私聊） ====================

  async getGachaUrl (e) {
    if (!e.isPrivate) {
      e.reply('请私聊发送该指令')
      return true
    }

    // 任务开始前原子占锁
    const lockKey = `Axiu-Plugin:gachaLog:getUrl:${e.user_id}`
    if (!await tryAcquireGachaLock(lockKey)) {
      e.reply(`请求过快，请${await gachaLockRemaining(lockKey) || 5 * 60}秒后重试...`)
      return true
    }

    if (!e.uid) {
      e.uid = e?.runtime?.user?._regUid || await getUidFromNoteUser(e)
    }
    e.region = getServer(e.uid)

    const authkey = await getAuthKey(e)
    if (!authkey) {
      e.reply('获取authkey失败，请先绑定stoken\n发送【#扫码登录】进行绑定')
      return true
    }

    const url = `https://hk4e-api.mihoyo.com/event/gacha_info/api/getGachaLog?authkey_ver=1&sign_type=2&auth_appid=webview_gacha&init_type=301&gacha_id=fecafa7b6560db5f3182222395d88aaa6aaac1bc&timestamp=${Math.floor(Date.now() / 1000)}&lang=zh-cn&device_type=mobile&plat_type=ios&region=${e.region}&authkey=${encodeURIComponent(authkey)}&game_biz=hk4e_cn&gacha_type=301&page=1&size=5&end_id=0`

    e.reply(`uid:${e.uid}\n抽卡链接：\n${url}`)
    return true
  }
}

// ==================== 工具函数 ====================

/** 去重合并：以 id 为键，remote 覆盖 local，按 id 降序 */
function mergeJson (local, remote) {
  const map = new Map()
  for (const item of local) map.set(item.id, item)
  for (const item of remote) map.set(item.id, item)
  return [...map.values()].sort((a, b) => Number(b.id) - Number(a.id))
}
