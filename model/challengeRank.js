/**
 * 终局挑战排行存储模型 — 基于 Redis ZSET，全局排行
 *
 * Key 设计：
 *   Axiu:challenge:rank:{type}:{dim}:{scheduleId}    ZSET (member=uid, 全局)
 *   Axiu:challenge:rank:season:{type}:{scheduleId}    String (JSON 赛季元信息)
 *   Axiu:challenge:rank:uid:{uid}                     String (JSON qq+scores+extra+scheduleId, 全局)
 *   Axiu:challenge:rank:{groupId}:cfg                 String (JSON 群开关)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOG_PREFIX } from '../components/constants.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const KEY = 'Axiu:challenge:rank'
const TTL = 90 * 24 * 3600 // 90 天
const TYPE_NAMES = ['末日幻影', '虚构叙事', '忘却之庭', '异相仲裁']

// nanoka 图鉴数据目录（Atlas-Plugin 的子模块）
const NANOKA_BASE = path.resolve(pluginRoot, '../Atlas-Plugin/tool/nanoka-atlas-backend/nanoka-atlas-backend/data/items/简体中文/星铁')
// 挑战类型 → nanoka 目录名
const NANOKA_DIR = ['末日幻影', '虚构叙事', '混沌回忆', '异相仲裁']

/** 起始日期 — 42 天/期 */
const EPOCH_CONFIG = {
  0: { start: new Date('2024-06-19T04:00:00'), cycleDays: 42 },
  1: { start: new Date('2024-01-08T04:00:00'), cycleDays: 42 },
  2: { start: new Date('2023-04-26T04:00:00'), cycleDays: 42 }
}

const DIMENSIONS = {
  0: [
    { key: 'star', label: '星数', desc: '总星数', higher: true },
    { key: 'score', label: '分数', desc: '总分', higher: true },
    { key: 'battle', label: '战斗', desc: '战斗次数', higher: false },
    { key: 'round', label: '轮数', desc: '使用轮数', higher: false }
  ],
  1: [
    { key: 'star', label: '星数', desc: '总星数', higher: true },
    { key: 'score', label: '分数', desc: '总分', higher: true },
    { key: 'battle', label: '战斗', desc: '战斗次数', higher: false },
    { key: 'round', label: '轮数', desc: '使用轮数', higher: false }
  ],
  2: [
    { key: 'star', label: '星数', desc: '总星数', higher: true },
    { key: 'round', label: '轮数', desc: '使用轮数', higher: false },
    { key: 'battle', label: '战斗', desc: '战斗次数', higher: false },
    { key: 'floor', label: '层数', desc: '最深抵达', higher: true }
  ],
  3: [
    { key: 'boss', label: '王棋', desc: '王棋星数', higher: true },
    { key: 'mob', label: '骑士', desc: '骑士星数', higher: true },
    { key: 'round', label: '轮数', desc: '总轮数', higher: false },
    { key: 'hard', label: '绝境', desc: '绝境模式', higher: true }
  ]
}

const DEFAULT_DIMENSION = { 0: '__', 1: '__', 2: '__', 3: '__' }

/**
 * 综合排序分数 — 多维度加权编码
 * 忘却: 层数 > 星数 > 轮数(升)   末日: 难度 > 总分
 * 虚构: 层数 > 星数 > 分数 > 轮数(升)   仲裁: 绝境 > 王棋 > 骑士 > 轮数(升)
 */
function compoundScore (scores, extra, challengeType) {
  const R = (v) => Math.max(0, Math.min(v, 99)) // 轮数/战斗数上限
  switch (challengeType) {
    case 0: // 末日: 难度(floor) > 总分(score)
      return (scores.floor || 0) * 100000 + (scores.score || 0)
    case 1: // 虚构: 层数 > 星数 > 分数 > 轮数(升)
      return (scores.floor || 0) * 10000000 + (scores.star || 0) * 100000 + (scores.score || 0) * 10 + (99 - R(extra.round_num || 0))
    case 2: // 忘却: 层数 > 星数 > 轮数(升)
      return (scores.floor || 0) * 10000 + (scores.star || 0) * 100 + (99 - R(extra.round_num || 0))
    case 3: // 仲裁: 绝境 > 王棋 > 骑士 > 轮数(升)
      return (scores.hard || 0) * 1000000 + (scores.boss || 0) * 10000 + (scores.mob || 0) * 100 + (99 - R(extra.round_num || 0))
    default: return 0
  }
}

const DIM_ALIAS = {
  '星': 'star', '星数': 'star', '星星': 'star', '总星数': 'star',
  '分数': 'score', '总分': 'score', '得分': 'score',
  '轮数': 'round', '轮次': 'round', '回合': 'round', '使用轮数': 'round',
  '战斗': 'battle', '次数': 'battle', '战斗次数': 'battle',
  '层数': 'floor', '最深': 'floor', '最深抵达': 'floor',
  '王棋': 'boss', '王棋星数': 'boss',
  '骑士': 'mob', '骑士星数': 'mob',
  '绝境': 'hard', '绝境模式': 'hard'
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

export default class ChallengeRank {
  // ==================== 维度工具 ====================

  static getDimensions (challengeType) {
    return DIMENSIONS[challengeType] || DIMENSIONS[0]
  }

  static getDefaultDimension (challengeType) {
    return DEFAULT_DIMENSION[challengeType] || 'star'
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

  // ==================== scheduleId ====================

  static getScheduleId (data, challengeType, type) {
    if (data.schedule_id != null) return String(data.schedule_id)
    if (data.groups?.[0]?.group_id != null) return String(data.groups[0].group_id)
    if (data.peak_records?.group?.group_id != null) return String(data.peak_records.group.group_id)
    if (data.beginTime) {
      const parts = data.beginTime.split(/[.\s-]/)
      if (parts.length >= 3) return `${parts[0]}${parts[1]}${parts[2]}`
    }
    if (data.begin_time?.year) {
      const { year, month, day } = data.begin_time
      return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`
    }
    const now = new Date()
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  }

  // ==================== 期数 ====================

  static getPeriodNumber (data, challengeType) {
    if (challengeType === 3) return null
    const cfg = EPOCH_CONFIG[challengeType]
    // 末日/虚构的原始时间在 groups[0]，忘却的原始时间在顶层
    const timeData = data.begin_time || data.groups?.[0]?.begin_time
    if (!cfg || !timeData) return null
    try {
      const { year, month, day, hour = 4, minute = 0 } = timeData
      const apiDate = new Date(year, month - 1, day, hour, minute)
      const diff = apiDate.getTime() - cfg.start.getTime()
      if (diff < 0) return 1
      return Math.floor(diff / (cfg.cycleDays * 24 * 3600 * 1000)) + 1
    } catch { return null }
  }

  /**
   * 从 nanoka 图鉴数据查找赛季名称
   * 将 periodNumber 作为索引，在按 recordId 排序的记录中取对应位置
   */
  static _lookupSeasonName (challengeType, periodNumber) {
    if (periodNumber == null || periodNumber < 1) return ''
    const dir = path.join(NANOKA_BASE, NANOKA_DIR[challengeType], '未分类')
    let files = []
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')) } catch { return '' }

    const records = []
    for (const file of files) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
        const id = d.meta?.recordId
        if (id != null) records.push({ id: Number(id), zh: d.content?.list?.zh || '' })
      } catch { /* skip */ }
    }
    records.sort((a, b) => a.id - b.id)

    const idx = Math.min(periodNumber - 1, records.length - 1)
    return records[idx]?.zh || ''
  }

  // ==================== score 提取 ====================

  static extractScores (data, challengeType) {
    const scores = {}
    const extra = {}

    if (challengeType === 3) {
      const rec = data.peak_records
      if (!rec) return { scores, extra }
      if (rec.boss_stars != null) { scores.boss = Number(rec.boss_stars); extra.boss_stars = Number(rec.boss_stars) }
      if (rec.mob_stars != null) { scores.mob = Number(rec.mob_stars); extra.mob_stars = Number(rec.mob_stars) }

      // 轮数：打王棋只算王棋轮，否则只算骑士轮
      const bossRound = rec.boss_record?.round_num != null ? Number(rec.boss_record.round_num) : null
      let roundVal = 0; let roundLabel = ''
      if (bossRound != null) {
        roundVal = bossRound; roundLabel = '王棋'
        extra.boss_round = bossRound
      } else if (rec.mob_records?.length) {
        const mr = []
        for (const m of rec.mob_records) {
          if (m.round_num != null) { roundVal += Number(m.round_num); mr.push(Number(m.round_num)) }
        }
        extra.mob_rounds = mr
        if (mr.length) roundLabel = '骑士'
      }
      if (roundVal > 0) {
        scores.round = -roundVal
        extra.round_num = roundVal
        extra.round_label = roundLabel
      }
      if (rec.boss_record?.hard_mode != null) { scores.hard = rec.boss_record.hard_mode ? 1 : 0; extra.hard_mode = rec.boss_record.hard_mode }
    } else {
      // 楼层难→易排列，取最深层（第一项）的本层数据
      const floors = data.all_floor_detail || []
      const deepFloor = floors[0] || {}
      const floorStar = deepFloor.star_num != null ? Number(deepFloor.star_num) : 0
      const floorRound = deepFloor.round_num != null ? Number(deepFloor.round_num) : 0

      // 本层 star_num 已含星启之星，不重复加
      scores.star = floorStar
      extra.star_num = floorStar
      extra.floor_star = floorStar
      extra.floor_round = floorRound
      if (data.extra_star_num != null) { extra.extra_star_num = Number(data.extra_star_num) || 0 }

      if (data.max_floor != null) {
        let f = parseInt(data.max_floor)
        if (isNaN(f)) f = floors.length
        if (!isNaN(f)) { scores.floor = f; extra.max_floor = data.max_floor }
      }
      if (data.battle_num != null) { scores.battle = -Number(data.battle_num); extra.battle_num = Number(data.battle_num) }

      // 轮数取最深层
      if (deepFloor.round_num != null) { scores.round = -floorRound; extra.round_num = floorRound }
      // 分数取最深层
      if ([0, 1].includes(challengeType) && deepFloor.score != null) {
        const fs = Number(deepFloor.score) || 0
        scores.score = fs
        extra.total_score = fs
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
        logger?.error(`${LOG_PREFIX}[排行] compound zAdd 失败`, err)
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
        logger?.error(`${LOG_PREFIX}[排行] zAdd 失败`, err)
      }
    }

    // 当前赛季 scheduleId
    try { await redis.setEx(currentKey(challengeType), TTL, scheduleId) } catch {}

    // 赛季元信息
    try {
      const periodNum = this.getPeriodNumber(data, challengeType)
      const name = this._lookupSeasonName(challengeType, periodNum)
      const fmt = (t) => t ? `${t.year}.${String(t.month).padStart(2,'0')}.${String(t.day).padStart(2,'0')}` : ''
      const bt = data.beginTime
        || fmt(data.peak_records?.group?.begin_time)
        || fmt(data.groups?.[0]?.begin_time)
        || ''
      const et = data.endTime
        || fmt(data.peak_records?.group?.end_time)
        || fmt(data.groups?.[0]?.end_time)
        || ''
      await redis.setEx(seasonKey(challengeType, scheduleId), TTL, JSON.stringify({
        scheduleName: name,
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

  /** 批量获取 uid-info，返回 { uid: {qq, extra} } */
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

    // 综合排序时，展示分 = 各类型主要维度原始值
    const displayScore = (extra, ct) => {
      switch (ct) {
        case 0: return extra.total_score || extra.star_num || 0   // 末日: 总分
        case 1: return extra.star_num || 0                        // 虚构: 星数
        case 2: return extra.star_num || 0                        // 忘却: 星数
        case 3: return extra.boss_stars || 0                      // 仲裁: 王棋星数
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
        ? (() => { switch (challengeType) { case 0: return extra.total_score || extra.star_num || 0; case 1: return extra.star_num || 0; case 2: return extra.star_num || 0; case 3: return extra.boss_stars || 0; default: return 0 } })()
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
        logger?.error(`${LOG_PREFIX}[排行] 重置 ZSET 失败`, err)
      }
    }
    logger?.mark(`${LOG_PREFIX}[排行] 已重置排行数据`)
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
      logger?.error(`${LOG_PREFIX}[排行] 设置群状态失败`, err)
    }
  }
}
