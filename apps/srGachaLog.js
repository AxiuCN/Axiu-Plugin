/** 星铁抽卡记录管理 — 方案1（荷花 badge login + rpg_gacha_record）
 *  命令1: *更新星铁抽卡记录 — cookie → badge login → 五星/垫抽/池统计 → 镜像 genshin srJson
 *  命令2: *获取星铁抽卡链接 — 星铁外部 authkey 不可用，提示改用自动更新或手动导入
 *
 *  查询/统计/渲染复用 genshin gcLog（*角色记录 / *光锥记录 / *全部记录 等）。
 *  数据完整度：官方小程序接口仅五星 + 垫抽 + 池统计（无每抽明细），
 *              每抽全量需手动星铁 authkey 链接走 genshin 导入。
 */

import plugin from '../../../lib/plugins/plugin.js'
import QrUser from '../model/qrUser.js'
import stokenStore from '../model/stokenStore.js'
import { getSrServer } from '../model/mys/passportUtils.js'
import { StarRailGachaService } from '../model/srGacha.js'
import { tryAcquireGachaLock, gachaLockRemaining, getUidFromNoteUser } from '../components/gachaUtils.js'

export class srGachaLog extends plugin {
  constructor () {
    super({
      name: '[Axiu-Plugin] 星铁抽卡记录管理',
      dsc: '星铁更新抽卡记录、获取抽卡链接',
      event: 'message',
      priority: -1000000,
      rule: [
        // 命令1: 更新星铁抽卡记录（荷花 badge login 方案）
        // 兼容两种输入：*更新星铁抽卡记录（标准化为 #星铁更新星铁抽卡记录）与 #星铁更新抽卡记录
        // 末尾可选跟一个 9~10 位 UID，用于显式指定目标账号（如 *更新星铁抽卡记录 200000002）
        {
          reg: '^#星铁(星铁)?更新(星铁)?(抽卡|祈愿)?(记录|历史)(\\s+[1-9]\\d{8,9})?\\s*$',
          fnc: 'srGachaLog',
          permission: 'all',
          log: true
        },
        // 命令2: 获取星铁抽卡链接（提示不可用）
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
      e.reply('未找到星铁UID\n请先发送【#扫码登录】绑定星铁账号后重试')
      return true
    }
    e.region = getSrServer(e.uid)

    // 获取账号 cookie：优先按目标星铁 UID 反查 stoken 条目（保证 cookie 与 UID 配套）
    let cookie = null
    try {
      const stokenData = await stokenStore.getUserStoken(e.user_id)
      // stoken 数据顶层键即游戏 UID
      let entry = stokenData?.[String(e.uid)] || null
      if (!entry) {
        // 精确 UID 未命中时，只接受「同一米游社账号（ltuid 相同）」的条目；
        // 绝不回退到任意带 stoken 的条目——那会把别的账号的凭据配给目标 UID。
        const ltuid = e.user?.getUidData?.(e.uid, 'sr')?.ltuid
        entry = Object.values(stokenData || {}).find(s =>
          s?.stoken && (String(s?.uid) === String(e.uid) || (ltuid && String(s?.stuid) === String(ltuid)))
        ) || null
      }
      if (entry?.stoken) {
        const qrUser = new QrUser({ user_id: e.user_id, uid: e.uid, region: e.region })
        const cookies = `uid=${entry.stuid}&stoken=${entry.stoken}${entry.mid ? `&mid=${entry.mid}` : ''}`
        const res = await qrUser.getData('bbsGetCookie', { cookies }, false)
        if (res?.data?.cookie_token) {
          cookie = `ltoken=${entry.ltoken};ltuid=${entry.stuid};cookie_token=${res.data.cookie_token};account_id=${entry.stuid};`
        }
      }
    } catch {}

    // 回退：按**目标 UID** 取同账号 CK（CK 是账号级，靠该 UID 的 ltuid 定位账号）。
    // 不再调 QrUser.cookie(e)：那条路按「当前账号的星铁 UID」取，会覆盖本命令已解析好的目标 UID，
    // 且星铁没有 CK 时会拿原神 CK 顶替，导致用错账号还回复成功。
    if (!cookie) {
      try {
        const user = new QrUser(e)
        const byUid = await user.getCookieForUid(e, e.uid, 'sr')
        if (byUid?.cookie) {
          cookie = byUid.cookie
          e.cookie = byUid.cookie
        }
      } catch {}
    }

    if (!cookie) {
      e.reply(`未获取到星铁 UID ${e.uid} 的账号 cookie\n可用【#扫码登录】绑定该账号，或去掉命令里的 UID 后重试`)
      return true
    }

    // 收口：region 始终由最终 UID 生成，避免中途换号后仍带着先前算出的区域
    e.region = getSrServer(e.uid)

    // 拉取并镜像 srJson
    const service = new StarRailGachaService()
    try {
      const result = await service.updateByCookie({
        qq: e.user_id,
        uid: e.uid,
        region: e.region,
        cookie
      })
      const pools = result.pools
      // 三类池：常规更新 / 已有真实数据追加新记录 / 已有真实数据无新增
      const rebuilt = pools.filter(p => !p.kept && !p.merged)
      const mergedPools = pools.filter(p => p.merged)
      const keptPools = pools.filter(p => p.kept)
      const totalStars = rebuilt.reduce((s, p) => s + p.total, 0) + mergedPools.reduce((s, p) => s + p.total, 0)
      const hasData = rebuilt.some(p => p.total > 0 || p.totalDraws > 0)
      const lines = rebuilt
        .filter(p => p.total > 0 || p.totalDraws > 0)
        .map(p => `${p.name}: 五星 ${p.total}${p.added > 0 ? `（新增${p.added}）` : ''} · 已抽 ${p.totalDraws} · 垫 ${p.pity ?? '?'}`)
      const mergedLines = mergedPools.map(p => `${p.name}: 已追加 ${p.added} 个五星（保留原有导入数据）· 垫 ${p.pity ?? '?'}`)
      const keptLines = keptPools.map(p => `${p.name}: 已有完整数据，暂无新增`)
      const header = (!hasData && !mergedPools.length)
        ? '星铁抽卡记录更新完成（暂无新抽卡数据）\n'
        : '星铁抽卡记录更新完成\n'
      e.reply(
        header +
        (lines.length ? lines.join('\n') + '\n' : '') +
        (mergedLines.length ? mergedLines.join('\n') + '\n' : '') +
        (keptLines.length ? keptLines.join('\n') + '\n' : '') +
        ((hasData || mergedPools.length) ? `共 ${totalStars} 个五星${result.added > 0 ? `，新增 ${result.added}` : ''}\n` : '') +
        '可查看【*角色记录】【*光锥记录】【*全部记录】等'
      )
    } catch (err) {
      logger?.error(`[Axiu-Plugin][星铁抽卡] 更新失败: retcode=${err?.retcode} msg=${err?.message}`)
      // 登录失效（retcode -100 / 登录字样）提示重绑；角色不存在提示检查 UID
      if (err?.retcode === -100 || /登录|login|cookie|token/i.test(String(err?.message))) {
        e.reply(`星铁抽卡记录更新失败：${err?.message}\n账号 cookie 可能已失效，请重新发送【#扫码登录】`)
      } else if (/角色不存在|等级不符/i.test(String(err?.message))) {
        e.reply(`星铁抽卡记录更新失败：${err?.message}\n请确认目标 UID（${e.uid}）属于已绑定账号，或发送【#扫码登录】重新绑定`)
      } else {
        e.reply(`星铁抽卡记录更新失败：${err?.message}`)
      }
    }
    return true
  }

  // ==================== 命令2: *获取星铁抽卡链接 ====================

  async getSrGachaUrl (e) {
    e.reply('星铁暂不支持外部 authkey 获取链接\n请直接发送【*更新星铁抽卡记录】自动更新，或粘贴游戏内星铁抽卡链接导入')
    return true
  }
}