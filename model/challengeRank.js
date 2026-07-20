/**
 * 终局挑战排行存储模型
 *
 * 基于 Redis ZSET 实现群聊排行：
 *   Key: Axiu:challenge:rank:{groupId}:{challengeType}:{dimension}:{scheduleId}
 *   member: uid（游戏 UID）
 *   score:  排行数值（round_num/battle_num 等越小越好指标取反存储）
 *
 * 排行时机：用户在群聊中查询挑战数据（详细版 API 成功）时自动上报
 */

import { LOG_PREFIX } from '../components/constants.js'

/** 排行维度定义 — 各 challengeType 支持的维度及提取规则 */
const DIMENSIONS = {
  // 忘却之庭
  2: [
    { key: 'star', label: '星数', desc: '总星数', higher: true },
    { key: 'round', label: '轮数', desc: '使用轮数', higher: false },
    { key: 'battle', label: '战斗', desc: '战斗次数', higher: false },
    { key: 'floor', label: '层数', desc: '最深抵达', higher: true }
  ],
  // 虚构叙事 / 末日幻影（共用）
  default_: [
    { key: 'star', label: '星数', desc: '总星数', higher: true },
    { key: 'score', label: '分数', desc: '总分', higher: true },
    { key: 'battle', label: '战斗', desc: '战斗次数', higher: false },
    { key: 'round', label: '轮数', desc: '使用轮数', higher: false }
  ]
}
DIMENSIONS[0] = DIMENSIONS.default_ // 末日幻影
DIMENSIONS[1] = DIMENSIONS.default_ // 虚构叙事

// 异相仲裁
DIMENSIONS[3] = [
  { key: 'boss', label: '王棋', desc: '王棋星数', higher: true },
  { key: 'mob', label: '骑士', desc: '骑士星数', higher: true },
  { key: 'round', label: '轮数', desc: '总轮数', higher: false },
  { key: 'hard', label: '绝境', desc: '绝境模式', higher: true }
]

/** 各 challengeType 默认排行维度 */
const DEFAULT_DIMENSION = { 0: 'score', 1: 'score', 2: 'star', 3: 'boss' }

/** 排行维度别名映射（命令关键词 → 维度 key） */
const DIM_ALIAS = {
  '星': 'star', '星数': 'star', '星星': 'star',
  '分数': 'score', '总分': 'score', '得分': 'score',
  '轮数': 'round', '轮次': 'round', '回合': 'round',
  '战斗': 'battle', '次数': 'battle',
  '层数': 'floor', '最深': 'floor',
  '王棋': 'boss', '骑士': 'mob',
  '绝境': 'hard'
}

/** 挑战类型中文名 */
const TYPE_NAMES = ['末日幻影', '虚构叙事', '忘却之庭', '异相仲裁']

/** Redis Key 前缀 */
const KEY_PREFIX = 'Axiu:challenge:rank'

/** ZSET 完整 key */
function rankKey (groupId, challengeType, dimension, scheduleId) {
  return `${KEY_PREFIX}:${groupId}:${challengeType}:${dimension}:${scheduleId}`
}

/** 群配置 key */
function cfgKey (groupId) {
  return `${KEY_PREFIX}:${groupId}:cfg`
}

/** UID 信息缓存 key */
function uidInfoKey (uid) {
  return `${KEY_PREFIX}:uid-info:${uid}`
}

export default class ChallengeRank {
  // ==================== 维度工具 ====================

  /**
   * 获取某 challengeType 支持的维度列表
   * @param {number} challengeType 0-3
   * @returns {Array<{key, label, desc, higher}>}
   */
  static getDimensions (challengeType) {
    return DIMENSIONS[challengeType] || DIMENSIONS.default_
  }

  /**
   * 获取默认维度 key
   * @param {number} challengeType
   * @returns {string}
   */
  static getDefaultDimension (challengeType) {
    return DEFAULT_DIMENSION[challengeType] || 'star'
  }

  /**
   * 解析维度别名 → 维度 key
   * @param {string} text 用户输入的关键词
   * @returns {string|null}
   */
  static resolveDimensionAlias (text) {
    if (!text) return null
    // 精确匹配
    if (DIM_ALIAS[text]) return DIM_ALIAS[text]
    // 最长前缀模糊匹配
    const keys = Object.keys(DIM_ALIAS).sort((a, b) => b.length - a.length)
    for (const k of keys) {
      if (text.includes(k)) return DIM_ALIAS[k]
    }
    return null
  }

  /** 获取挑战类型中文名 */
  static getTypeName (challengeType) {
    return TYPE_NAMES[challengeType] || '未知'
  }

  // ==================== scheduleId ====================

  /**
   * 从格式化后的 data 提取 schedule_id
   * 多路径尝试：schedule_id → group_id → begin_time
   * @param {object} data - queryChallenge 返回的格式化 data
   * @param {number} challengeType
   * @param {string} type - scheduleType "1"|"2"|"3"
   * @returns {string}
   */
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

  // ==================== score 提取 ====================

  /**
   * 从格式化后的 data 提取各维度 score
   * @param {object} data - queryChallenge 返回的格式化 data
   * @param {number} challengeType
   * @returns {object} { star: 36, round: -5, ... }（越小越好已取反）
   */
  static extractScores (data, challengeType) {
    const scores = {}

    if (challengeType === 3) {
      // === 异相仲裁 ===
      const rec = data.peak_records
      if (!rec) return scores

      if (rec.boss_stars != null) scores.boss = Number(rec.boss_stars)
      if (rec.mob_stars != null) scores.mob = Number(rec.mob_stars)

      let totalRound = 0
      let hasRound = false
      if (rec.boss_record?.round_num != null) {
        totalRound += Number(rec.boss_record.round_num)
        hasRound = true
      }
      if (rec.mob_records?.length) {
        for (const m of rec.mob_records) {
          if (m.round_num != null) {
            totalRound += Number(m.round_num)
            hasRound = true
          }
        }
      }
      if (hasRound) scores.round = -totalRound

      if (rec.boss_record?.hard_mode != null) {
        scores.hard = rec.boss_record.hard_mode ? 1 : 0
      }
    } else {
      // === 忘却之庭 / 虚构叙事 / 末日幻影 ===
      if (data.star_num != null) scores.star = Number(data.star_num)
      if (data.max_floor != null) {
        const floor = parseInt(data.max_floor)
        if (!isNaN(floor)) scores.floor = floor
      }
      if (data.battle_num != null) scores.battle = -Number(data.battle_num)

      if (data.all_floor_detail?.length) {
        let totalRound = 0
        let hasRound = false
        for (const floor of data.all_floor_detail) {
          if (floor.round_num != null) {
            totalRound += Number(floor.round_num)
            hasRound = true
          }
        }
        if (hasRound) scores.round = -totalRound

        if ([0, 1].includes(challengeType) && data.all_floor_detail.some(f => f.score != null)) {
          let totalScore = 0
          for (const floor of data.all_floor_detail) {
            totalScore += Number(floor.score) || 0
          }
          if (totalScore > 0) scores.score = totalScore
        }
      }
    }

    return scores
  }

  // ==================== 上报 ====================

  /**
   * 将 uid 的挑战数据写入所有适用维度的 ZSET
   * @param {string} uid - 游戏 UID
   * @param {number|string} groupId - QQ 群号
   * @param {number} challengeType - 0-3
   * @param {object} data - queryChallenge 返回的格式化 data
   * @param {string} scheduleId - 赛季标识
   */
  static async report (uid, groupId, challengeType, data, scheduleId) {
    const scores = this.extractScores(data, challengeType)
    const dims = this.getDimensions(challengeType)

    for (const dim of dims) {
      const value = scores[dim.key]
      if (value == null || value === 0) continue

      const key = rankKey(groupId, challengeType, dim.key, scheduleId)
      try {
        await redis.zAdd(key, { score: value, value: uid })
      } catch (err) {
        logger?.error(`${LOG_PREFIX}[排行] zAdd 失败: ${key}`, err)
      }
    }

    // 更新 UID 信息缓存（TTL 90 天）
    try {
      const infoKey = uidInfoKey(uid)
      const existing = await redis.get(infoKey)
      const info = existing ? JSON.parse(existing) : {}
      info.qq = info.qq || null
      info[challengeType] = info[challengeType] || {}
      for (const [dim, val] of Object.entries(scores)) {
        const prev = info[challengeType][dim]
        if (prev == null || val > prev) {
          info[challengeType][dim] = val
        }
      }
      await redis.setEx(infoKey, 90 * 24 * 3600, JSON.stringify(info))
    } catch (err) {
      logger?.error(`${LOG_PREFIX}[排行] 更新 UID 信息缓存失败`, err)
    }
  }

  // ==================== 查询 ====================

  /**
   * 获取 Top N 排行列表
   * @param {number|string} groupId
   * @param {number} challengeType
   * @param {string} dimension - 维度 key
   * @param {string} scheduleId
   * @param {number} topN
   * @returns {Promise<Array<{rank, uid, score, rawScore}>>}
   */
  static async getRank (groupId, challengeType, dimension, scheduleId, topN = 20) {
    const key = rankKey(groupId, challengeType, dimension, scheduleId)
    let members
    try {
      // ZSET 默认升序，取最后 topN 个（最高分）
      members = await redis.zRangeWithScores(key, -topN, -1)
    } catch (err) {
      logger?.error(`${LOG_PREFIX}[排行] zRangeWithScores 失败: ${key}`, err)
      return []
    }
    if (!members?.length) return []

    members.reverse()

    const dims = this.getDimensions(challengeType)
    const dimDef = dims.find(d => d.key === dimension)
    const isReversed = dimDef && !dimDef.higher

    return members.map((m, i) => ({
      rank: i + 1,
      uid: String(m.value || m.member),
      score: isReversed ? -(m.score) : Math.round(m.score),
      rawScore: m.score
    }))
  }

  /**
   * 获取某 uid 在排行中的名次
   * @returns {{ rank, uid, score } | null}
   */
  static async getRankForUid (uid, groupId, challengeType, dimension, scheduleId) {
    const key = rankKey(groupId, challengeType, dimension, scheduleId)
    try {
      const rank = await redis.zRevRank(key, uid)
      if (rank == null) return null
      const score = await redis.zScore(key, uid)
      const dims = this.getDimensions(challengeType)
      const dimDef = dims.find(d => d.key === dimension)
      const isReversed = dimDef && !dimDef.higher
      return {
        rank: rank + 1,
        uid: String(uid),
        score: isReversed ? -(score) : Math.round(score)
      }
    } catch (err) {
      logger?.error(`${LOG_PREFIX}[排行] zRevRank 失败`, err)
      return null
    }
  }

  /** 获取排行总人数 */
  static async getRankCount (groupId, challengeType, dimension, scheduleId) {
    const key = rankKey(groupId, challengeType, dimension, scheduleId)
    try {
      return await redis.zCard(key)
    } catch {
      return 0
    }
  }

  // ==================== 管理 ====================

  /**
   * 重置群排行
   * @param {number|string} groupId
   * @param {number|null} challengeType - null 时重置该群所有类型
   */
  static async resetRank (groupId, challengeType = null) {
    const pattern = challengeType != null
      ? `${KEY_PREFIX}:${groupId}:${challengeType}:*`
      : `${KEY_PREFIX}:${groupId}:*`
    try {
      const keys = await redis.keys(pattern)
      if (keys?.length) {
        await redis.del(...keys)
        logger?.mark(`${LOG_PREFIX}[排行] 已重置群 ${groupId} 排行: ${keys.length} 个 key`)
      }
    } catch (err) {
      logger?.error(`${LOG_PREFIX}[排行] 重置排行失败`, err)
    }
  }

  // ==================== 群配置 ====================

  /**
   * 获取群排行配置
   * @returns {{ status: number, timestamp: number }}
   */
  static async getGroupCfg (groupId) {
    const key = cfgKey(groupId)
    try {
      const raw = await redis.get(key)
      if (raw) return JSON.parse(raw)
    } catch {}
    return { status: 1, timestamp: Date.now() }
  }

  /**
   * 设置群排行状态
   * @param {number|string} groupId
   * @param {number} status 1=启用, 0=关闭
   */
  static async setGroupStatus (groupId, status) {
    const key = cfgKey(groupId)
    try {
      await redis.set(key, JSON.stringify({ status, timestamp: Date.now() }))
    } catch (err) {
      logger?.error(`${LOG_PREFIX}[排行] 设置群状态失败`, err)
    }
  }
}
