/** 圣遗物总榜 / 遗器总榜（原神 + 星铁）
 *
 *  语义：不指定角色，把 miao 群排行里的所有角色摊平成一张榜；
 *        一行 = (uid, 角色, 分数)，同角色多 uid、同 uid 多角色都会各占一行，
 *        按分数降序取前 N（N = miao 的「排行人数」配置），只读 mark（圣遗物/遗器评分）。
 *
 *  命令：
 *    #圣遗物总榜 / #遗器总榜            — 本群总榜
 *    #全局圣遗物总榜 / #全局遗器总榜    — 全局（跨群）总榜
 *    星铁侧 *遗器总榜 / *全局遗器总榜   — 框架把 `*` 归一成 `#星铁`，正则容忍可选的「星铁」
 *
 *  数据：miao-plugin 的群排行 ZSET，见 model/artisRank.js
 */
import { buildArtisRank, MESSAGES, miaoResourcesBase } from '../model/artisRank.js'
import { render } from '../components/render.js'
import { LOG_PREFIX } from '../components/constants.js'

/** 本群总榜：#圣遗物总榜 / #遗器总榜 / #星铁遗器总榜 */
const GROUP_RANK_REG = '^(#|[*＊])(星铁)?(圣遗物|遗器)总榜$'
/** 全局总榜：#全局圣遗物总榜 / #全局遗器总榜 / #星铁全局遗器总榜 */
const GLOBAL_RANK_REG = '^(#|[*＊])(星铁)?全局(圣遗物|遗器)总榜$'

export class ArtisRankApp extends plugin {
  constructor () {
    super({
      name: '[Axiu-Plugin] 圣遗物总榜',
      dsc: 'miao 群排行总榜（原神圣遗物 / 星铁遗器，支持本群与全局）',
      event: 'message',
      // 与 apps/challenge.js 的排行命令同级：先于 miao 的群排行命令匹配
      priority: 1,
      rule: [
        { reg: GROUP_RANK_REG, fnc: 'artisRank', permission: 'all' },
        { reg: GLOBAL_RANK_REG, fnc: 'artisRank', permission: 'all' }
      ]
    })
  }

  // ==================== #圣遗物总榜 / #全局圣遗物总榜 ====================

  /**
   * 总榜入口（本群与全局共用）
   *
   * 范围与游戏都从消息里取：`全局` → 跨群，`星铁` 前缀（或框架置位的 e.isSr）→ 星铁
   */
  async artisRank (e) {
    const msg = String(e.msg || '')
    const isGlobal = /全局/.test(msg)
    const game = (/星铁/.test(msg) || e.isSr) ? 'sr' : 'gs'

    if (!isGlobal && !e.isGroup) {
      await e.reply(MESSAGES.notGroup)
      return true
    }

    const res = await buildArtisRank({
      groupId: isGlobal ? null : String(e.group_id),
      game
    })
    if (!res.ok) {
      if (res.reason === 'no-miao') {
        logger?.warn(`${LOG_PREFIX}[圣遗物总榜] miao-plugin 不可用，命令降级`)
      }
      await e.reply(this._reasonText(res.reason))
      return true
    }

    await this._fillMemberInfo(e, res.rows)

    const img = await render('artisRank', 'rank', {
      title: game === 'sr' ? '遗器总榜' : '圣遗物总榜',
      scopeText: isGlobal ? '全局' : '本群',
      showGid: isGlobal,
      topN: res.topN,
      count: res.rows.length,
      list: res.rows,
      faceBase: miaoResourcesBase()
    })
    if (img) await e.reply(img)
    return true
  }

  /** 降级原因 → 用户提示 */
  _reasonText (reason) {
    if (reason === 'group-closed') return MESSAGES.groupClosed
    if (reason === 'no-miao') return MESSAGES.noMiao
    return MESSAGES.noData
  }

  /**
   * 补全用户昵称与头像：本群优先群名片/群头像，取不到保留 model 层的回落值
   * （回落口径与 modules/challenge/gsRank.js 一致）
   */
  async _fillMemberInfo (e, rows) {
    if (!e?.isGroup || typeof e.group?.pickMember !== 'function') return rows
    const cache = new Map()
    await Promise.all(rows.map(async (row) => {
      if (!row.qq) return
      try {
        if (!cache.has(row.qq)) cache.set(row.qq, e.group.pickMember(row.qq))
        const member = cache.get(row.qq)
        if (!member) return
        const face = await Promise.resolve(member.getAvatarUrl?.()).catch(() => null)
        if (face) row.face = face
        const info = await Promise.resolve(member.getInfo?.()).catch(() => null)
        const nick = info?.card || info?.nickname
        if (nick) row.nick = nick
      } catch { /* 取不到就用回落值，不影响出图 */ }
    }))
    return rows
  }
}
