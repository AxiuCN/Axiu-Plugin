/**
 * 原神深渊排行存储模型 — 基于 Redis ZSET，全局排行
 *
 * Key 设计：
 *   Axiu:gsAbyss:rank:{type}:{dim}:{scheduleId}    ZSET (member=uid, 全局)
 *   Axiu:gsAbyss:rank:current:{type}               String (当前赛季 scheduleId)
 *   Axiu:gsAbyss:rank:season:{type}:{scheduleId}   String (JSON 赛季元信息)
 *   Axiu:gsAbyss:rank:uid:{uid}                    String (JSON qq+scores+extra+scheduleId, 全局)
 *   Axiu:gsAbyss:rank:{groupId}:cfg                String (JSON 群开关)
 *
 * 类型：
 *   0 = 深境螺旋 (spiralAbyss)
 *   1 = 真境幻想剧诗 (role_combat)
 *   2 = 幽境危战 (hard_challenge)
 */

import { LOG_PREFIX } from '../components/constants.js'

const KEY = 'Axiu:gsAbyss:rank'
const TTL = 90 * 24 * 3600 // 90 天
const TYPE_NAMES = ['深境螺旋', '真境幻想剧诗', '幽境危战']

/** 维度定义 */
const DIMENSIONS = {
  0: [ // 深境螺旋 — 层数 > 星数 > 战斗次数（无用时）
    { key: 'floor', label: '层数', desc: '最深抵达', higher: true },
    { key: 'star', label: '星数', desc: '最深楼层星数', higher: true },
    { key: 'battle', label: '战斗', desc: '战斗次数', higher: false }
  ],
  1: [ // 真境幻想剧诗 — 模式 > 层数 > 用时 > 借出
    { key: 'mode', label: '模式', desc: '难度模式', higher: true },
    { key: 'floor', label: '层数', desc: '完成幕数', higher: true },
    { key: 'time', label: '用时', desc: '总用时(秒)', higher: false },
    { key: 'borrow', label: '借出', desc: '借出角色次数', higher: true }
  ],
  2: [ // 幽境危战 — 难度 > 用时
    { key: 'difficulty', label: '难度', desc: '难度n', higher: true },
    { key: 'time', label: '用时', desc: '用时(秒)', higher: false }
  ]
}

const DEFAULT_DIMENSION = { 0: '__', 1: '__', 2: '__' }

/**
 * 综合排序分数 — 多维度加权编码
 */
function compoundScore (scores, extra, challengeType) {
  const R = (v, max) => Math.max(0, Math.min(v, max))
  switch (challengeType) {
    case 0: // 深境螺旋: 层数 > 星数 > 战斗(少)
      return (scores.floor || 0) * 1000000
        + (scores.star || 0) * 100000
        + (99 - R(extra.battle_num || 0, 99))
    case 1: // 真境幻想剧诗: 模式 > 层数 > 用时(少) > 借出(多)
      return (scores.mode || 0) * 100000000
        + (scores.floor || 0) * 1000000
        - (R(extra.total_time || 0, 999999))
        + (extra.borrow_num || 0) * 100
    case 2: // 幽境危战: 难度 > 用时(少)
      return (scores.difficulty || 0) * 1000000
        - (R(extra.time_second || 0, 999999))
    default: return 0
  }
}

const DIM_ALIAS = {
  '层数': 'floor', '最深': 'floor', '最深抵达': 'floor',
  '星数': 'star', '星星': 'star', '总星数': 'star',
  '战斗': 'battle', '次数': 'battle', '战斗次数': 'battle',
  '模式': 'mode', '难度模式': 'mode',
  '借出': 'borrow', '借出次数': 'borrow', '借出角色': 'borrow',
  '难度': 'difficulty', '难度n': 'difficulty',
  '星': 'star', '层': 'floor'
}

// ==================== Key 构造 ====================

function rankKey (type, dim, scheduleId) {
  return `${KEY}:${type}:${dim}:${scheduleId}`
}

function currentKey (type) {
  return `${KEY}:current:${type}`
}

function seasonKey (type, scheduleId) {
  return `${KEY}:season:${type}:${scheduleId}`
}

function uidKey (uid) {
  return `${KEY}:uid:${uid}`
}

function cfgKey (groupId) {
  return `${KEY}:${groupId}:cfg`
}

export default class GsChallengeRank {
  // ==================== 维度工具 ====================

  static getDimensions (challengeType) {
    return DIMENSIONS[challengeType] || DIMENSIONS[0]
  }

  static getDefaultDimension (challengeType) {
    return DEFAULT_DIMENSION[challengeType] || '__'
  }

  static resolveDimensionAlias (text) {
    if (!text) return null
    if (DIM_ALIAS[text]) return DIM_ALIAS[text]
    const keys = Object.keys(DIM_ALIAS).sort((a, b) => b.length - a.length)
    for (const k of keys) {
      if (text.includes(k)) return DIM_ALIAS[k]
    }
    return null
  }

  static getTypeName (challengeType) {
    return TYPE_NAMES[challengeType] || '未知'
  }

  // ==================== 徽章计算 ====================

  /**
   * 幽境危战徽章（仅展示，不参与排序）
   * 优先取 API 原始字段，否则按 difficulty + time 推算
   * @returns {number} 0=无, 1-6=基础徽章, 7=彩虹徽章(diff6≤180s)
   */
  static _calcBadge (data, difficulty, timeSecond) {
    // 尝试从 API 原始字段提取
    if (data?.badge != null) return Number(data.badge)
    if (data?.medal != null) return Number(data.medal)
    if (data?.medal_type != null) return Number(data.medal_type)

    const diff = difficulty != null ? Number(difficulty) : (data?.difficulty ?? 0)
    const time = timeSecond != null ? Number(timeSecond) : (data?.second ?? data?.time ?? 999)
    if (!diff || diff < 1) return 0

    // 难度 6 + ≤180s → 彩虹徽章
    if (diff >= 6 && time <= 180) return 7
    // 基础徽章对应难度等级
    return diff
  }

  // ==================== scheduleId ====================

  static getScheduleId (data, challengeType) {
    // 优先 schedule_id
    if (data?.schedule_id != null) return String(data.schedule_id)
    // 真境幻想剧诗 / 幽境危战: schedule 对象
    if (data?.schedule?.id != null) return String(data.schedule.id)
    if (data?.schedule?.schedule_id != null) return String(data.schedule.schedule_id)

    // fallback: start_time Unix 秒时间戳
    const ts = data?.start_time || data?.schedule?.start_time
    if (ts) {
      const d = new Date(ts * 1000)
      if (!isNaN(d.getTime())) return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    }

    // fallback: schedule.start_date_time 对象
    const sdt = data?.schedule?.start_date_time
    if (sdt) return `${sdt.year}${String(sdt.month).padStart(2, '0')}${String(sdt.day).padStart(2, '0')}`

    return 'unknown'
  }

  /** 计算期数（基于 start_time） */
  static getPeriodNumber (data, challengeType) {
    const ts = data?.start_time || data?.schedule?.start_time
    if (!ts) return null
    try {
      const d = new Date(ts * 1000)
      if (isNaN(d.getTime())) return null
      // 深境螺旋从 2022-09-01 开始（3.0版本），每月两期
      // 简单用月份差计算
      const epoch = new Date('2022-09-01')
      const diffMonths = (d.getFullYear() - epoch.getFullYear()) * 12 + (d.getMonth() - epoch.getMonth())
      // 每月约 2 期，取近似值
      return Math.max(1, Math.round(diffMonths * 2 + (d.getDate() > 15 ? 1 : 0.5)))
    } catch { return null }
  }

  // ==================== score 提取 ====================

  static extractScores (data, challengeType) {
    const scores = {}
    const extra = {}

    switch (challengeType) {
      case 0: { // 深境螺旋
        // 层数 — 解析 max_floor："12-3" → 123
        const mf = data?.max_floor
        if (mf != null) {
          const parts = String(mf).split('-')
          const floor = parseInt(parts[0]) || 0
          const chamber = parseInt(parts[1]) || 0
          scores.floor = floor * 10 + chamber
          extra.max_floor = String(mf)
        }

        // 星数 — 最深层 floor 的 star
        const floors = data?.floors || []
        let maxIdx = -1; let maxFloorObj = null
        for (const f of floors) {
          const idx = parseInt(f?.index) || 0
          if (idx > maxIdx) { maxIdx = idx; maxFloorObj = f }
        }
        if (maxFloorObj?.star != null) {
          scores.star = Number(maxFloorObj.star)
          extra.max_floor_star = scores.star
        }

        // 战斗次数
        if (data?.total_battle_times != null) {
          const bt = Number(data.total_battle_times)
          scores.battle = -bt
          extra.battle_num = bt
        }

        extra.total_star = data?.total_star ?? 0
        break
      }

      case 1: { // 真境幻想剧诗
        const stat = data?.stat || {}

        // 模式 — difficulty_id: 1=轻简, 2=普通, 3=困难, 4=卓越, 5=月谕
        if (stat.difficulty_id != null) {
          scores.mode = Number(stat.difficulty_id)
          extra.mode_id = scores.mode
        }

        // 层数 — rounds_data 数组长度
        const rounds = data?.detail?.rounds_data
        if (rounds?.length) {
          scores.floor = rounds.length
          extra.round_count = rounds.length
        }

        // 用时 — total_use_time (秒)
        if (stat.total_use_time != null) {
          const tt = Number(stat.total_use_time)
          scores.time = -tt
          extra.total_time = tt
        } else if (data?.detail?.fight_statisic?.total_use_time) {
          const ttObj = data.detail.fight_statisic.total_use_time
          const tt = (ttObj.hour || 0) * 3600 + (ttObj.minute || 0) * 60 + (ttObj.second || 0)
          scores.time = -tt
          extra.total_time = tt
        }

        // 借出角色次数
        if (stat.rent_cnt != null) {
          scores.borrow = Number(stat.rent_cnt)
          extra.borrow_num = scores.borrow
        }
        break
      }

      case 2: { // 幽境危战
        // 难度 n
        const diff = data?.best?.difficulty ?? data?.difficulty
        if (diff != null) {
          scores.difficulty = Number(diff)
          extra.difficulty = scores.difficulty
        }

        // 用时 (秒)
        const sec = data?.best?.second ?? data?.second
        if (sec != null) {
          scores.time = -Number(sec)
          extra.time_second = Number(sec)
        }

        // 徽章 — 仅展示
        extra.badge = this._calcBadge(data, diff, sec)
        break
      }
    }

    return { scores, extra }
  }

  // ==================== 上报 ====================

  static async report (uid, qq, groupId, challengeType, data, scheduleId) {
    const { scores, extra } = this.extractScores(data, challengeType)

    // 综合排序分
    const compound = compoundScore(scores, extra, challengeType)
    if (compound > 0) {
      try {
        const ck = rankKey(challengeType, '__', scheduleId)
        await redis.zAdd(ck, { score: compound, value: String(uid) })
        await redis.expire(ck, TTL)
      } catch (err) {
        logger?.error(`${LOG_PREFIX}[原神排行] compound zAdd 失败`, err)
      }
    }

    // 写 ZSET（每个维度一个 key）
    for (const dim of this.getDimensions(challengeType)) {
      const val = scores[dim.key]
      if (val == null) continue
      try {
        const rk = rankKey(challengeType, dim.key, scheduleId)
        await redis.zAdd(rk, { score: val, value: String(uid) })
        await redis.expire(rk, TTL)
      } catch (err) {
        logger?.error(`${LOG_PREFIX}[原神排行] zAdd 失败`, err)
      }
    }

    // 当前赛季 scheduleId
    try { await redis.setEx(currentKey(challengeType), TTL, scheduleId) } catch {}

    // 赛季元信息
    try {
      const periodNum = this.getPeriodNumber(data, challengeType)
      const fmtTs = (ts) => {
        if (!ts) return ''
        const d = new Date(ts * 1000)
        if (isNaN(d.getTime())) return ''
        return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
      }
      const bt = fmtTs(data?.start_time || data?.schedule?.start_time)
      const et = fmtTs(data?.end_time || data?.schedule?.end_time)
      await redis.setEx(seasonKey(challengeType, scheduleId), TTL, JSON.stringify({
        beginTime: bt,
        endTime: et,
        periodNumber: periodNum
      }))
    } catch {}

    // UID 信息（QQ + extra + scores + scheduleId，全局共享）
    try {
      const existing = await redis.get(uidKey(uid))
      const info = existing ? JSON.parse(existing) : {}
      info.qq = String(qq || '')
      if (!info[challengeType] || info[challengeType].time < Date.now()) {
        info[challengeType] = { scores, extra, scheduleId: String(scheduleId), time: Date.now() }
      }
      await redis.setEx(uidKey(uid), 90 * 24 * 3600, JSON.stringify(info))
    } catch {}
  }

  // ==================== 查询 ====================

  static async getCurrentScheduleId (challengeType, groupId) {
    try { return await redis.get(currentKey(challengeType)) } catch { return null }
  }

  static async getSeasonMeta (challengeType, groupId) {
    const sid = await this.getCurrentScheduleId(challengeType, groupId)
    if (!sid) return null
    try {
      const raw = await redis.get(seasonKey(challengeType, sid))
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  }

  /** 批量获取 uid-info，返回 { uid: {qq, extra, ...} } */
  static async _getUidInfoMap (uids) {
    const map = {}
    for (const uid of uids) {
      try {
        const raw = await redis.get(uidKey(uid))
        if (raw) map[uid] = JSON.parse(raw)
      } catch {}
    }
    return map
  }

  static async getRank (groupId, challengeType, dimension, scheduleId, topN = 20) {
    const isCompound = dimension === '__'
    const key = rankKey(challengeType, dimension, scheduleId)
    let members
    try {
      members = await redis.zRangeWithScores(key, -topN, -1)
    } catch { return [] }
    if (!members?.length) return []

    members.reverse()
    const uids = members.map(m => String(m.value || m.member))
    const infoMap = await this._getUidInfoMap(uids)

    // 综合排序时，展示分 = 主要维度的原始值
    const displayScore = (extra, ct) => {
      switch (ct) {
        case 0: return extra.max_floor_star || extra.total_star || 0    // 深境: 深层星数
        case 1: return extra.mode_id || 0                                 // 剧诗: 模式
        case 2: return extra.difficulty || 0                              // 危战: 难度
        default: return 0
      }
    }

    return members.map((m, i) => {
      const uid = String(m.value || m.member)
      const info = infoMap[uid] || {}
      const ext = info[challengeType]?.extra || {}
      return {
        rank: i + 1,
        uid,
        score: isCompound ? displayScore(ext, challengeType) : Math.round(m.score),
        qq: info.qq || '',
        extra: ext
      }
    })
  }

  static async getRankForUid (uid, groupId, challengeType, dimension, scheduleId) {
    const isCompound = dimension === '__'
    const key = rankKey(challengeType, dimension, scheduleId)
    try {
      const rank = await redis.zRevRank(key, String(uid))
      if (rank == null) return null
      const score = await redis.zScore(key, String(uid))

      let qq = ''; let extra = {}
      try {
        const raw = await redis.get(uidKey(uid))
        if (raw) {
          const info = JSON.parse(raw)
          qq = info.qq || ''
          extra = info[challengeType]?.extra || {}
        }
      } catch {}

      let displayScore = isCompound
        ? (() => {
          switch (challengeType) {
            case 0: return extra.max_floor_star || extra.total_star || 0
            case 1: return extra.mode_id || 0
            case 2: return extra.difficulty || 0
            default: return 0
          }
        })()
        : Math.round(score)
      return { rank: rank + 1, uid: String(uid), score: displayScore, qq, extra }
    } catch { return null }
  }

  static async getRankCount (groupId, challengeType, dimension, scheduleId) {
    try { return await redis.zCard(rankKey(challengeType, dimension, scheduleId)) } catch { return 0 }
  }

  // ==================== 管理 ====================

  static async resetRank (groupId, challengeType = null) {
    const types = challengeType != null ? [challengeType] : [0, 1, 2]
    for (const ct of types) {
      const pattern = `${KEY}:${ct}:*`
      try {
        const keys = await redis.keys(pattern)
        if (keys?.length) await redis.del(...keys)
      } catch (err) {
        logger?.error(`${LOG_PREFIX}[原神排行] 重置 ZSET 失败`, err)
      }
    }
    logger?.mark(`${LOG_PREFIX}[原神排行] 已重置排行数据`)
  }

  // ==================== 群配置 ====================

  static async getGroupCfg (groupId) {
    try {
      const raw = await redis.get(cfgKey(groupId))
      if (raw) return JSON.parse(raw)
    } catch {}
    return { status: 1, timestamp: Date.now() }
  }

  static async setGroupStatus (groupId, status) {
    try {
      await redis.set(cfgKey(groupId), JSON.stringify({ status, timestamp: Date.now() }))
    } catch (err) {
      logger?.error(`${LOG_PREFIX}[原神排行] 设置群状态失败`, err)
    }
  }
}
