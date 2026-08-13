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
 *   1 = 幻想真境剧诗 (role_combat)
 *   2 = 幽境危战·单人 (hard_challenge.single)
 *   3 = 幽境危战·多人 (hard_challenge.mp)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOG_PREFIX } from '../components/constants.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const KEY = 'Axiu:gsAbyss:rank'
const TTL = 90 * 24 * 3600 // 90 天
const TYPE_NAMES = ['深境螺旋', '幻想真境剧诗', '幽境危战·单人', '幽境危战·多人']

/** nanoka 图鉴数据目录（Atlas-Plugin 的子模块） */
const GS_NANOKA_BASE = path.resolve(pluginRoot, '../Atlas-Plugin/tool/nanoka-atlas-backend/nanoka-atlas-backend/data/items/简体中文/原神')

/**
 * 各类型赛季名来源目录（nanoka 子目录名）
 * 文件名（不含扩展名）即为赛季名
 */
const GS_SEASON_DIR = {
  0: '深境螺旋',
  1: null,          // 剧诗无赛季名
  2: '地脉异常',
  3: '地脉异常',
}

/** 各类型起始日期（用于计算期数） */
const GS_EPOCH_CONFIG = {
  0: { start: new Date('2020-07-01T04:00:00'), cycleDays: 15 },  // 深境螺旋 三测 起 ~15天/期
  1: { start: new Date('2024-07-01T04:00:00'), cycleDays: 30 },  // 幻想真境剧诗 v4.7 起 ~30天/期
  2: { start: new Date('2025-06-25T04:00:00'), cycleDays: 42 },  // 幽境危战 v5.7 起 ~42天/期
  3: { start: new Date('2025-06-25T04:00:00'), cycleDays: 42 },  // 幽境危战·多人 同单人
}

/** 维度定义 */
const DIMENSIONS = {
  0: [ // 深境螺旋 — 层数 > 星数 > 战斗次数（无用时）
    { key: 'floor', label: '层数', desc: '最深抵达', higher: true },
    { key: 'star', label: '星数', desc: '最深楼层星数', higher: true },
    { key: 'battle', label: '战斗', desc: '战斗次数', higher: false }
  ],
  1: [ // 幻想真境剧诗 — 模式 > 幕数 > 星章 > 用时(少) > 借出
    { key: 'mode', label: '模式', desc: '难度模式', higher: true },
    { key: 'floor', label: '幕数', desc: '完成幕数', higher: true },
    { key: 'flower', label: '星章', desc: '明星挑战星章', higher: true },
    { key: 'time', label: '用时', desc: '总耗时(秒)', higher: false },
    { key: 'borrow', label: '借出', desc: '借出角色次数', higher: true }
  ],
  2: [ // 幽境危战·单人 — 难度 > 用时
    { key: 'difficulty', label: '难度', desc: '难度n', higher: true },
    { key: 'time', label: '用时', desc: '用时(秒)', higher: false }
  ],
  3: [ // 幽境危战·多人 — 同单人维度
    { key: 'difficulty', label: '难度', desc: '难度n', higher: true },
    { key: 'time', label: '用时', desc: '用时(秒)', higher: false }
  ]
}

const DEFAULT_DIMENSION = { 0: '__', 1: '__', 2: '__', 3: '__' }

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
    case 1: // 幻想真境剧诗: 模式 > 幕 > 花 > 用时(少) > 借出(多)
      return (scores.mode || 0) * 10000000000
        + (scores.floor || 0) * 100000000
        + (scores.flower || 0) * 1000000
        + (999999 - R(extra.time_second || 0, 999999))
        + R(extra.borrow_num || 0, 99)
    case 2:
    case 3: // 幽境危战: 难度 > 用时(少)
      return (scores.difficulty || 0) * 1000000
        - (R(extra.time_second || 0, 999999))
    default: return 0
  }
}

const DIM_ALIAS = {
  // 深境螺旋
  '层数': 'floor', '层': 'floor', '最深': 'floor', '最深抵达': 'floor',
  '星数': 'star', '星': 'star', '星星': 'star', '总星数': 'star',
  '战斗': 'battle', '战': 'battle', '次数': 'battle', '战斗次数': 'battle',
  // 幻想真境剧诗
  '模式': 'mode', '难度模式': 'mode',
  '花': 'flower', '星章': 'flower', '明星挑战': 'flower', '明星挑战星章': 'flower',
  '用时': 'time', '时': 'time', '时间': 'time',
  '借出': 'borrow', '借': 'borrow', '借出次数': 'borrow', '借出角色': 'borrow',
  // 幽境危战
  '难度': 'difficulty', '难': 'difficulty', '难度n': 'difficulty',
  // 通用
  '幕': 'floor', '幕数': 'floor',
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

  /** 危战类型 → 基础 type（用于 season/scheduleId 共享） */
  static _baseType (challengeType) {
    return challengeType === 3 ? 2 : challengeType
  }

  // ==================== 徽章计算 ====================

  /**
   * 幽境危战徽章（仅展示，不参与排序）
   * @returns {number} 0=无, 1-6=基础徽章, 7=彩虹徽章(diff6≤180s)
   */
  static _calcBadge (data, difficulty, timeSecond) {
    if (data?.badge != null) return Number(data.badge)
    if (data?.medal != null) return Number(data.medal)
    if (data?.medal_type != null) return Number(data.medal_type)

    const diff = difficulty != null ? Number(difficulty) : (data?.difficulty ?? 0)
    const time = timeSecond != null ? Number(timeSecond) : (data?.second ?? data?.time ?? 999)
    if (!diff || diff < 1) return 0

    if (diff >= 6 && time <= 180) return 7
    return diff
  }

  // ==================== scheduleId ====================

  static getScheduleId (data, challengeType) {
    if (data?.schedule_id != null) return String(data.schedule_id)
    if (data?.schedule?.id != null) return String(data.schedule.id)
    if (data?.schedule?.schedule_id != null) return String(data.schedule.schedule_id)

    const ts = data?.start_time || data?.schedule?.start_time
    if (ts) {
      const d = new Date(ts * 1000)
      if (!isNaN(d.getTime())) return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    }

    const sdt = data?.schedule?.start_date_time
    if (sdt) return `${sdt.year}${String(sdt.month).padStart(2, '0')}${String(sdt.day).padStart(2, '0')}`

    return 'unknown'
  }

  static getPeriodNumber (data, challengeType) {
    const cfg = GS_EPOCH_CONFIG[challengeType]
    if (!cfg) return null
    const ts = data?.start_time || data?.schedule?.start_time
    if (!ts) return null
    try {
      const d = new Date(ts * 1000)
      if (isNaN(d.getTime())) return null

      // 深渊: 开服~4.6（2024-06-15前）半月一期, 4.7起（2024-06-16后）每月一期
      if (challengeType === 0) {
        if (d < new Date('2024-06-16T04:00:00')) {
          // Phase 1: 半月一期（1号/16号刷新），2020年10月上半月=第1期
          const monthDiff = (d.getFullYear() - 2020) * 12 + (d.getMonth() + 1 - 10)
          if (monthDiff < 0) return 1
          const half = d.getDate() <= 15 ? 0 : 1
          return monthDiff * 2 + half + 1
        } else {
          // Phase 2: 每月一期，16号刷新，第96期=2024.06.16起
          const monthDiff = (d.getFullYear() - 2024) * 12 + (d.getMonth() + 1 - 6)
          let period = 96 + monthDiff
          if (d.getDate() < 16) period-- // 1-15号属于上一周期
          return Math.max(96, period)
        }
      }

      // 剧诗: 每个月一期，按日历月计算
      if (challengeType === 1) {
        const monthDiff = (d.getFullYear() - 2024) * 12 + (d.getMonth() + 1 - 7) // 2024年7月=第1期
        return Math.max(1, monthDiff + 1)
      }

      const diffDays = (d.getTime() - cfg.start.getTime()) / (24 * 3600 * 1000)
      if (diffDays < 0) return 1
      return Math.floor(diffDays / cfg.cycleDays) + 1
    } catch { return null }
  }

  /**
   * 从 nanoka 图鉴数据查找赛季名称
   * 各类型赛季名来源由 GS_SEASON_DIR 定义：
   *   深境螺旋 — 文件名即为赛季名（如"攻辉之月.json"→"攻辉之月"）
   *   地脉异常(危战) — 同上（如"星芒之役.json"→"星芒之役"）
   *   剧诗 — 无命名赛季，返回空
   * 匹配方式：按 content.list.begin/end 日期范围匹配 API start_time
   */
  static _lookupSeasonName (challengeType, data) {
    const subDir = GS_SEASON_DIR[challengeType]
    if (!subDir) return '' // 无赛季名来源
    const targetTs = data?.start_time || data?.schedule?.start_time
    if (!targetTs) return ''
    const targetDate = new Date(targetTs * 1000)
    if (isNaN(targetDate.getTime())) return ''

    const dir = path.join(GS_NANOKA_BASE, subDir, '未分类')
    let files = []
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')) } catch { return '' }

    for (const file of files) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
        const begin = d.content?.list?.begin
        const end = d.content?.list?.end
        if (!begin || !end) continue
        const b = new Date(begin.replace(' ', 'T'))
        const e = new Date(end.replace(' ', 'T'))
        if (!isNaN(b.getTime()) && !isNaN(e.getTime()) && targetDate >= b && targetDate <= e) {
          // 文件名（不含扩展名）即为赛季名
          return file.replace(/\.json$/i, '')
        }
      } catch { /* skip */ }
    }
    return ''
  }

  // ==================== score 提取 ====================

  static extractScores (data, challengeType) {
    const scores = {}
    const extra = {}

    switch (challengeType) {
      case 0: { // 深境螺旋
        const mf = data?.max_floor
        if (mf != null) {
          const parts = String(mf).split('-')
          const floor = parseInt(parts[0]) || 0
          const chamber = parseInt(parts[1]) || 0
          scores.floor = floor * 10 + chamber
          extra.max_floor = String(mf)
        }

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

        if (data?.total_battle_times != null) {
          const bt = Number(data.total_battle_times)
          scores.battle = -bt
          extra.battle_num = bt
        }

        extra.total_star = data?.total_star ?? 0
        break
      }

      case 1: { // 幻想真境剧诗
        const stat = data?.stat || {}
        const detail = data?.detail || {}

        scores.mode = Number(stat.difficulty_id) || 0
        extra.mode_id = scores.mode

        const rounds = detail.rounds_data || []
        scores.floor = rounds.length
        extra.round_count = rounds.length

        // 明星挑战星章（get_medal_round_list 中 1 的个数）
        const medals = (stat.get_medal_round_list || []).filter(v => v === 1).length
        extra.star_medal = medals
        scores.flower = medals

        // 总耗时（秒）
        const sec = Number(stat.total_use_time || detail.fight_statisic?.total_use_time) || 0
        extra.time_second = sec
        scores.time = -sec // 负值：用时越少分数越高

        // 借出
        const rent = Number(stat.rent_cnt) || 0
        scores.borrow = rent
        extra.borrow_num = rent
        break
      }

      case 2: // 幽境危战·单人 — 取 single 子对象
      case 3: { // 幽境危战·多人 — 取 mp 子对象
        const modeData = challengeType === 2
          ? (data?.single || data)
          : (data?.mp || data)

        const diff = modeData?.best?.difficulty ?? modeData?.difficulty
        if (diff != null) {
          scores.difficulty = Number(diff)
          extra.difficulty = scores.difficulty
        }

        const sec = modeData?.best?.second ?? modeData?.second
        if (sec != null) {
          scores.time = -Number(sec)
          extra.time_second = Number(sec)
        }

        extra.badge = this._calcBadge(modeData, diff, sec)
        break
      }
    }

    return { scores, extra }
  }

  // ==================== 上报 ====================

  /**
   * @param {boolean} [isCurrent=true] 是否当期数据 — 仅当期才更新 current 指针与赛季指针，防止上期/往期查询污染
   */
  static async report (uid, qq, groupId, challengeType, data, scheduleId, isCurrent = true) {
    const { scores, extra } = this.extractScores(data, challengeType)

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

    // 当前赛季 scheduleId（单人和多人共享）— 仅当期更新，上期/往期上报不污染 current 指针
    if (isCurrent) {
      try {
        await redis.setEx(currentKey(this._baseType(challengeType)), TTL, scheduleId)
      } catch (err) {
        logger?.error(`${LOG_PREFIX}[原神排行] 设置当前 scheduleId 失败`, err)
      }
    }

    // 赛季元信息（单人和多人共享 base type key，始终更新期数/赛季名）
    try {
      const baseT = this._baseType(challengeType)
      const periodNum = this.getPeriodNumber(data, challengeType)
      const seasonName = this._lookupSeasonName(challengeType, data)
      const fmtTs = (ts) => {
        if (!ts) return ''
        const d = new Date(ts * 1000)
        if (isNaN(d.getTime())) return ''
        return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
      }
      const bt = fmtTs(data?.start_time || data?.schedule?.start_time)
      const et = fmtTs(data?.end_time || data?.schedule?.end_time)
      await redis.setEx(seasonKey(baseT, scheduleId), TTL, JSON.stringify({
        scheduleName: seasonName,
        beginTime: bt,
        endTime: et,
        periodNumber: periodNum
      }))
    } catch (err) {
      logger?.error(`${LOG_PREFIX}[原神排行] 设置赛季元信息失败`, err)
    }

    // UID 信息（QQ + 各 scheduleId 的 scores/extra，全局共享）— 按 scheduleId 隔离，上期上报不覆盖本期展示数据
    try {
      const existing = await redis.get(uidKey(uid))
      const info = existing ? JSON.parse(existing) : {}
      info.qq = String(qq || '')
      if (!info[challengeType] || typeof info[challengeType] !== 'object') info[challengeType] = {}
      info[challengeType][String(scheduleId)] = { scores, extra, time: Date.now() }
      await redis.setEx(uidKey(uid), 90 * 24 * 3600, JSON.stringify(info))
    } catch (err) {
      logger?.error(`${LOG_PREFIX}[原神排行] 设置 UID 信息失败`, err)
    }

    logger?.mark(`${LOG_PREFIX}[原神排行] ${TYPE_NAMES[challengeType] || challengeType} uid:${uid} 上报完成, scheduleId:${scheduleId}, compound:${compound}`)
  }

  // ==================== 查询 ====================

  /**
   * 从 uid 信息中提取指定 scheduleId 的 extra
   * 新结构：info[challengeType] = { [scheduleId]: {scores, extra, time} }
   * 旧结构兼容：info[challengeType] = {scores, extra, scheduleId, time}
   */
  static _extractUidExtra (info, challengeType, scheduleId) {
    if (!info) return {}
    const slot = info[challengeType]
    if (!slot || typeof slot !== 'object') return {}
    const cur = slot[String(scheduleId)]
    if (cur && typeof cur === 'object') return cur.extra || {}
    return slot.extra || {}
  }

  static async getCurrentScheduleId (challengeType, groupId) {
    try {
      const sid = await redis.get(currentKey(this._baseType(challengeType)))
      if (sid) return sid
    } catch {}
    // current key 不存在时尝试从 ZSET key 反查
    return this._fallbackScheduleId(challengeType)
  }

  /**
   * 兜底：若 current key 不存在，从 ZSET key 反查最新 scheduleId
   */
  static async _fallbackScheduleId (challengeType) {
    try {
      const pattern = `${KEY}:${challengeType}:__:*`
      const keys = await redis.keys(pattern)
      if (!keys?.length) return null
      // 取最后一个 `:` 后的部分作为 scheduleId（按 key 名排序取最新的）
      keys.sort()
      const last = keys[keys.length - 1]
      return last.split(':').pop() || null
    } catch { return null }
  }

  static async getSeasonMeta (challengeType, groupId) {
    const sid = await this.getCurrentScheduleId(challengeType, groupId)
    if (!sid) return null
    try {
      const raw = await redis.get(seasonKey(this._baseType(challengeType), sid))
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  }

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

    const displayScore = (extra, ct) => {
      switch (ct) {
        case 0: return extra.max_floor_star || extra.total_star || 0
        case 1: return extra.mode_id || 0
        case 2:
        case 3: return extra.difficulty || 0
        default: return 0
      }
    }

    return members.map((m, i) => {
      const uid = String(m.value || m.member)
      const info = infoMap[uid] || {}
      const ext = this._extractUidExtra(info, challengeType, scheduleId)
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
          extra = this._extractUidExtra(info, challengeType, scheduleId)
        }
      } catch {}

      let displayScore = isCompound
        ? (() => {
          switch (challengeType) {
            case 0: return extra.max_floor_star || extra.total_star || 0
            case 1: return extra.mode_id || 0
            case 2:
            case 3: return extra.difficulty || 0
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
    const types = challengeType != null ? [challengeType] : [0, 1, 2, 3]
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
