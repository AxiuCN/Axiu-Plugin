/**
 * 终局挑战排行存储模型 — 基于 Redis ZSET
 *
 * Key 设计：
 *   Axiu:challenge:rank:{groupId}:{type}:{dim}:{scheduleId}    ZSET (member=uid)
 *   Axiu:challenge:rank:current:{type}:{groupId}                String (scheduleId)
 *   Axiu:challenge:rank:season:{type}:{scheduleId}              String (JSON 季节元信息)
 *   Axiu:challenge:rank:uid:{uid}                               String (JSON qq + extra)
 *   Axiu:challenge:rank:{groupId}:cfg                           String (JSON 群开关)
 */

import { LOG_PREFIX } from '../components/constants.js'

const KEY = 'Axiu:challenge:rank'
const TYPE_NAMES = ['末日幻影', '虚构叙事', '忘却之庭', '异相仲裁']

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

const DEFAULT_DIMENSION = { 0: 'score', 1: 'score', 2: 'star', 3: 'boss' }

const DIM_ALIAS = {
  '星': 'star', '星数': 'star', '星星': 'star',
  '分数': 'score', '总分': 'score', '得分': 'score',
  '轮数': 'round', '轮次': 'round', '回合': 'round',
  '战斗': 'battle', '次数': 'battle',
  '层数': 'floor', '最深': 'floor',
  '王棋': 'boss', '骑士': 'mob',
  '绝境': 'hard'
}

// ==================== Key 构造 ====================

function rankKey (groupId, type, dim, scheduleId) {
  return `${KEY}:${groupId}:${type}:${dim}:${scheduleId}`
}

function currentKey (type, groupId) {
  return `${KEY}:current:${type}:${groupId}`
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
    if (!cfg || !data.begin_time) return null
    try {
      const { year, month, day, hour = 4, minute = 0 } = data.begin_time
      const apiDate = new Date(year, month - 1, day, hour, minute)
      const diff = apiDate.getTime() - cfg.start.getTime()
      if (diff < 0) return 1
      return Math.floor(diff / (cfg.cycleDays * 24 * 3600 * 1000)) + 1
    } catch { return null }
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
      let totalRound = 0; let hasRound = false
      if (rec.boss_record?.round_num != null) { totalRound += Number(rec.boss_record.round_num); extra.boss_round = Number(rec.boss_record.round_num); hasRound = true }
      if (rec.mob_records?.length) {
        const mr = []; for (const m of rec.mob_records) { if (m.round_num != null) { totalRound += Number(m.round_num); mr.push(Number(m.round_num)); hasRound = true } }
        extra.mob_rounds = mr
      }
      if (hasRound) { scores.round = -totalRound; extra.round_num = totalRound }
      if (rec.boss_record?.hard_mode != null) { scores.hard = rec.boss_record.hard_mode ? 1 : 0; extra.hard_mode = rec.boss_record.hard_mode }
    } else {
      if (data.star_num != null) { scores.star = Number(data.star_num); extra.star_num = Number(data.star_num) }
      if (data.max_floor != null) { const f = parseInt(data.max_floor); if (!isNaN(f)) { scores.floor = f; extra.max_floor = data.max_floor } }
      if (data.battle_num != null) { scores.battle = -Number(data.battle_num); extra.battle_num = Number(data.battle_num) }
      if (data.all_floor_detail?.length) {
        let tr = 0; let hr = false
        for (const fl of data.all_floor_detail) { if (fl.round_num != null) { tr += Number(fl.round_num); hr = true } }
        if (hr) { scores.round = -tr; extra.round_num = tr }
        if ([0, 1].includes(challengeType) && data.all_floor_detail.some(f => f.score != null)) {
          let ts = 0; for (const fl of data.all_floor_detail) ts += Number(fl.score) || 0
          if (ts > 0) { scores.score = ts; extra.total_score = ts }
        }
      }
    }
    return { scores, extra }
  }

  // ==================== 上报 ====================

  static async report (uid, qq, groupId, challengeType, data, scheduleId) {
    const { scores, extra } = this.extractScores(data, challengeType)

    // 写 ZSET（每个维度一个 key）
    for (const dim of this.getDimensions(challengeType)) {
      const val = scores[dim.key]
      if (val == null || val === 0) continue
      try {
        await redis.zAdd(rankKey(groupId, challengeType, dim.key, scheduleId), { score: val, value: String(uid) })
      } catch (err) {
        logger?.error(`${LOG_PREFIX}[排行] zAdd 失败`, err)
      }
    }

    // 当前赛季 scheduleId
    try { await redis.set(currentKey(challengeType, groupId), scheduleId) } catch {}

    // 赛季元信息
    try {
      await redis.set(seasonKey(challengeType, scheduleId), JSON.stringify({
        beginTime: data.beginTime || '',
        endTime: data.endTime || '',
        periodNumber: this.getPeriodNumber(data, challengeType)
      }))
    } catch {}

    // UID 信息（QQ + extra）
    try {
      const existing = await redis.get(uidKey(uid))
      const info = existing ? JSON.parse(existing) : {}
      info.qq = String(qq || '')
      if (!info[challengeType] || info[challengeType].time < Date.now()) {
        info[challengeType] = { extra, time: Date.now() }
      }
      await redis.setEx(uidKey(uid), 90 * 24 * 3600, JSON.stringify(info))
    } catch {}
  }

  // ==================== 查询 ====================

  static async getCurrentScheduleId (challengeType, groupId) {
    try { return await redis.get(currentKey(challengeType, groupId)) } catch { return null }
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
    const key = rankKey(groupId, challengeType, dimension, scheduleId)
    let members
    try {
      members = await redis.zRangeWithScores(key, -topN, -1)
    } catch { return [] }
    if (!members?.length) return []

    members.reverse()
    const uids = members.map(m => String(m.value || m.member))
    const infoMap = await this._getUidInfoMap(uids)

    return members.map((m, i) => {
      const uid = String(m.value || m.member)
      const info = infoMap[uid] || {}
      return {
        rank: i + 1,
        uid,
        score: Math.round(m.score),
        qq: info.qq || '',
        extra: info[challengeType]?.extra || {}
      }
    })
  }

  static async getRankForUid (uid, groupId, challengeType, dimension, scheduleId) {
    const key = rankKey(groupId, challengeType, dimension, scheduleId)
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

      return { rank: rank + 1, uid: String(uid), score: Math.round(score), qq, extra }
    } catch { return null }
  }

  static async getRankCount (groupId, challengeType, dimension, scheduleId) {
    try { return await redis.zCard(rankKey(groupId, challengeType, dimension, scheduleId)) } catch { return 0 }
  }

  // ==================== 管理 ====================

  static async resetRank (groupId, challengeType = null) {
    const pattern = challengeType != null
      ? `${KEY}:${groupId}:${challengeType}:*`
      : `${KEY}:${groupId}:*`
    try {
      const keys = await redis.keys(pattern)
      if (keys?.length) await redis.del(...keys)
    } catch (err) {
      logger?.error(`${LOG_PREFIX}[排行] 重置失败`, err)
    }
    try { await redis.del(currentKey(challengeType ?? '*', groupId)) } catch {}
    logger?.mark(`${LOG_PREFIX}[排行] 已重置群 ${groupId} 排行`)
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
