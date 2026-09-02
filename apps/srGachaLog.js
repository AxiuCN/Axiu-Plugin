/** 星铁抽卡记录管理
 *  命令1: *更新星铁抽卡记录 — 官方 API 全量拉取（stoken→authkey→genshin GachaLog isSr 模式）
 *  命令2: *获取星铁抽卡链接 — stoken→authkey→生成抽卡 URL（仅私聊）
 *
 *  复用 genshin gcLog 查询/统计/渲染体系（*角色记录 / *光锥记录 / *全部记录 等），
 *  本文件只负责数据获取（官方 authkey 链路，星铁 game_biz=hkrpg_cn）。
 *  参考荷花重制版（Lotus-ReFactor）星铁抽卡同步思路，但采用 authkey 全量方案。
 */

import plugin from '../../../lib/plugins/plugin.js'
import { getSrServer } from '../model/mys/passportUtils.js'
import { LOG_PREFIX } from '../components/constants.js'
import { tryAcquireGachaLock, gachaLockRemaining, getUidFromNoteUser, getAuthKey } from '../components/gachaUtils.js'

export class srGachaLog extends plugin {
  constructor () {
    super({
      name: '[Axiu-Plugin] 星铁抽卡记录管理',
      dsc: '星铁更新抽卡记录、获取抽卡链接',
      event: 'message',
      priority: 500,
      rule: [
        // 命令1: 更新星铁抽卡记录（官方 authkey 全量拉取）
        // 兼容两种输入：*更新星铁抽卡记录（标准化为 #星铁更新星铁抽卡记录）与 #星铁更新抽卡记录
        {
          reg: '^#星铁(更新)?(星铁)?(抽卡|祈愿)?(记录|历史)$',
          fnc: 'srGachaLog',
          permission: 'all',
          log: true
        },
        // 命令2: 获取星铁抽卡链接（仅私聊）
        {
          reg: '^#星铁获取(星铁)?(抽卡|祈愿)?链接$',
          fnc: 'getSrGachaUrl',
          permission: 'all'
        }
      ]
    })
  }

  // ==================== 命令1: *更新星铁抽卡记录 ====================

  async srGachaLog (e) {
    // 任务开始前原子占锁（SET NX EX），并发重复命令只有一个能执行
    const lockKey = `Axiu-Plugin:gachaLog:sr:update:${e.user_id}`
    if (!await tryAcquireGachaLock(lockKey)) {
      e.reply(`请求过快，请${await gachaLockRemaining(lockKey) || 5 * 60}秒后重试...`)
      return true
    }

    // 获取星铁 UID（优先 NoteUser 星铁绑定，回退消息内 UID）
    if (!e.uid || !/^[1-9]\d{8}$/.test(String(e.uid))) {
      const msgMatch = e.msg.match(/\d{9,10}/)
      e.uid = msgMatch?.[0] || await getUidFromNoteUser(e, 'sr')
    }
    if (!e.uid) {
      e.reply('未绑定星铁UID\n请先发送【*绑定uid 你的星铁UID】或提供UID')
      return true
    }
    e.region = getSrServer(e.uid)

    // stoken → authkey（星铁 game_biz=hkrpg_cn）
    const authkey = await getAuthKey(e, 'hkrpg_cn')
    if (!authkey) {
      e.reply('星铁 authkey 获取失败\n请确认已绑定stoken，发送【#扫码登录】绑定后重试')
      return true
    }

    // 构造星铁抽卡 URL → 委托 genshin GachaLog（isSr 模式全量拉取）
    e.msg = `https://public-operation-hkrpg.mihoyo.com/common/gacha_record/api/getGachaLog?authkey_ver=1&sign_type=2&auth_appid=webview_gacha&game_biz=hkrpg_cn&gacha_type=11&page=1&size=5&end_id=0&region=${e.region}&lang=zh-cn&authkey=${encodeURIComponent(authkey)}`

    try {
      const GachaLog = (await import('../../genshin/model/gachaLog.js')).default
      await (new GachaLog(e)).logUrl()
    } catch (err) {
      logger.error(`${LOG_PREFIX} 星铁更新抽卡记录失败: ${err.message}`)
      e.reply(`更新星铁抽卡记录失败：${err.message}`)
    }
    return true
  }

  // ==================== 命令2: *获取星铁抽卡链接 ====================

  async getSrGachaUrl (e) {
    if (!e.isPrivate) {
      e.reply('请私聊发送该指令')
      return true
    }

    const lockKey = `Axiu-Plugin:gachaLog:sr:getUrl:${e.user_id}`
    if (!await tryAcquireGachaLock(lockKey)) {
      e.reply(`请求过快，请${await gachaLockRemaining(lockKey) || 5 * 60}秒后重试...`)
      return true
    }

    if (!e.uid || !/^[1-9]\d{8}$/.test(String(e.uid))) {
      const msgMatch = e.msg.match(/\d{9,10}/)
      e.uid = msgMatch?.[0] || await getUidFromNoteUser(e, 'sr')
    }
    if (!e.uid) {
      e.reply('未绑定星铁UID\n请先发送【*绑定uid 你的星铁UID】或提供UID')
      return true
    }
    e.region = getSrServer(e.uid)

    const authkey = await getAuthKey(e, 'hkrpg_cn')
    if (!authkey) {
      e.reply('获取星铁 authkey 失败，请先绑定stoken\n发送【#扫码登录】进行绑定')
      return true
    }

    const url = `https://public-operation-hkrpg.mihoyo.com/common/gacha_record/api/getGachaLog?authkey_ver=1&sign_type=2&auth_appid=webview_gacha&game_biz=hkrpg_cn&gacha_type=11&page=1&size=5&end_id=0&region=${e.region}&lang=zh-cn&authkey=${encodeURIComponent(authkey)}`
    e.reply(`uid:${e.uid}\n星铁抽卡链接：\n${url}`)
    return true
  }
}