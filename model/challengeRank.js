/**
 * 终局挑战排行存储模型
 *
 * 基于文件系统存储群聊排行：
 *   data/challenge/SR/{typeName}/{scheduleId}/{uid}.json
 *
 * 排行时机：用户在群聊中查询挑战数据（详细版 API 成功）时自动上报
 * 群配置（开关）保留 Redis KV 存储
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOG_PREFIX } from '../components/constants.js'

// ==================== 常量 ====================

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const DATA_BASE = path.join(pluginRoot, 'data', 'challenge', 'SR')

/** 挑战类型中文名（同时也是目录名） */
const TYPE_NAMES = ['末日幻影', '虚构叙事', '忘却之庭', '异相仲裁']

/** 各类型起始日期 — 用于计算「第N期」，周期42天/期（6周一个星铁版本） */
const EPOCH_CONFIG = {
  0: { start: new Date('2024-06-19T04:00:00'), cycleDays: 42 },
  1: { start: new Date('2024-01-08T04:00:00'), cycleDays: 42 },
  2: { start: new Date('2023-04-26T04:00:00'), cycleDays: 42 }
  // 3: 异相仲裁不按固定周期
}

/** 排行维度定义 */
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

// ==================== 路径工具 ====================

function currentKeyPath (typeName, groupId) {
  return path.join(DATA_BASE, typeName, `${groupId}-current.json`)
}

function uidJsonPath (typeName, scheduleId, uid) {
  return path.join(DATA_BASE, typeName, String(scheduleId), `${uid}.json`)
}

function seasonDir (typeName, scheduleId) {
  return path.join(DATA_BASE, typeName, String(scheduleId))
}

// ==================== 主类 ====================

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

  // ==================== scheduleId 提取 ====================

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

  // ==================== 期数计算 ====================

  /**
   * 基于 API begin_time 计算第几期
   * @param {object} data - queryChallenge 返回的格式化 data
   * @param {number} challengeType
   * @returns {number|null} 期数（从 1 开始），异相仲裁或缺失时间时返回 null
   */
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
    } catch {
      return null
    }
  }

  // ==================== score 提取 ====================

  /**
   * 从格式化后的 data 提取各维度 score + 原始值
   * @returns {{ scores: object, extra: object }}
   */
  static extractScores (data, challengeType) {
    const scores = {}
    const extra = {}

    if (challengeType === 3) {
      const rec = data.peak_records
      if (!rec) return { scores, extra }

      if (rec.boss_stars != null) {
        scores.boss = Number(rec.boss_stars)
        extra.boss_stars = Number(rec.boss_stars)
      }
      if (rec.mob_stars != null) {
        scores.mob = Number(rec.mob_stars)
        extra.mob_stars = Number(rec.mob_stars)
      }

      let totalRound = 0
      let hasRound = false
      if (rec.boss_record?.round_num != null) {
        totalRound += Number(rec.boss_record.round_num)
        extra.boss_round = Number(rec.boss_record.round_num)
        hasRound = true
      }
      if (rec.mob_records?.length) {
        const mobRounds = []
        for (const m of rec.mob_records) {
          if (m.round_num != null) {
            totalRound += Number(m.round_num)
            mobRounds.push(Number(m.round_num))
            hasRound = true
          }
        }
        extra.mob_rounds = mobRounds
      }
      if (hasRound) {
        scores.round = -totalRound
        extra.round_num = totalRound
      }
      if (rec.boss_record?.hard_mode != null) {
        scores.hard = rec.boss_record.hard_mode ? 1 : 0
        extra.hard_mode = rec.boss_record.hard_mode
      }
    } else {
      if (data.star_num != null) {
        scores.star = Number(data.star_num)
        extra.star_num = Number(data.star_num)
      }
      if (data.max_floor != null) {
        const floor = parseInt(data.max_floor)
        if (!isNaN(floor)) {
          scores.floor = floor
          extra.max_floor = data.max_floor
        }
      }
      if (data.battle_num != null) {
        scores.battle = -Number(data.battle_num)
        extra.battle_num = Number(data.battle_num)
      }

      if (data.all_floor_detail?.length) {
        let totalRound = 0
        let hasRound = false
        for (const floor of data.all_floor_detail) {
          if (floor.round_num != null) {
            totalRound += Number(floor.round_num)
            hasRound = true
          }
        }
        if (hasRound) {
          scores.round = -totalRound
          extra.round_num = totalRound
        }
        if ([0, 1].includes(challengeType) && data.all_floor_detail.some(f => f.score != null)) {
          let totalScore = 0
          for (const floor of data.all_floor_detail) {
            totalScore += Number(floor.score) || 0
          }
          if (totalScore > 0) {
            scores.score = totalScore
            extra.total_score = totalScore
          }
        }
      }
    }

    return { scores, extra }
  }

  // ==================== 上报 ====================

  /**
   * 将 uid 的挑战数据写入 JSON 文件
   * @param {string} uid - 游戏 UID
   * @param {string|number} qq - QQ 号
   * @param {number|string} groupId - QQ 群号
   * @param {number} challengeType - 0-3
   * @param {object} data - queryChallenge 返回的格式化 data
   * @param {string} scheduleId - 赛季标识
   */
  static async report (uid, qq, groupId, challengeType, data, scheduleId) {
    const typeName = TYPE_NAMES[challengeType]
    const { scores, extra } = this.extractScores(data, challengeType)

    const record = {
      uid: String(uid),
      qq: String(qq || ''),
      time: Date.now(),
      scheduleId: String(scheduleId),
      scores,
      extra
    }

    // 写入 uid.json
    const targetDir = path.join(DATA_BASE, typeName, String(scheduleId))
    try {
      fs.mkdirSync(targetDir, { recursive: true })
      fs.writeFileSync(
        path.join(targetDir, `${uid}.json`),
        JSON.stringify(record, null, 2),
        'utf8'
      )
    } catch (err) {
      logger?.error(`${LOG_PREFIX}[排行] 写入排行文件失败`, err)
      return
    }

    // 更新当前赛季标记（含时间/期数信息）
    try {
      fs.mkdirSync(path.join(DATA_BASE, typeName), { recursive: true })
      const marker = {
        scheduleId: String(scheduleId),
        time: Date.now()
      }
      if (data.beginTime) marker.beginTime = data.beginTime
      if (data.endTime) marker.endTime = data.endTime
      const periodNum = this.getPeriodNumber(data, challengeType)
      if (periodNum != null) marker.periodNumber = periodNum

      fs.writeFileSync(
        currentKeyPath(typeName, groupId),
        JSON.stringify(marker, null, 2),
        'utf8'
      )
    } catch (err) {
      logger?.error(`${LOG_PREFIX}[排行] 写入赛季标记失败`, err)
    }
  }

  // ==================== 查询 ====================

  static async getCurrentScheduleId (challengeType, groupId) {
    const typeName = TYPE_NAMES[challengeType]
    try {
      const raw = fs.readFileSync(currentKeyPath(typeName, groupId), 'utf8')
      return JSON.parse(raw)?.scheduleId || null
    } catch {
      return null
    }
  }

  /**
   * 获取当前赛季的元信息（含 beginTime/endTime/periodNumber）
   * @returns {Promise<{scheduleId, beginTime?, endTime?, periodNumber?, time}|null>}
   */
  static async getSeasonMeta (challengeType, groupId) {
    const typeName = TYPE_NAMES[challengeType]
    try {
      const raw = fs.readFileSync(currentKeyPath(typeName, groupId), 'utf8')
      return JSON.parse(raw) || null
    } catch {
      return null
    }
  }

  /**
   * 获取 Top N 排行列表
   * @returns {Promise<Array<{rank, uid, score, record}>>}
   */
  static async getRank (groupId, challengeType, dimension, scheduleId, topN = 20) {
    const sDir = seasonDir(TYPE_NAMES[challengeType], scheduleId)

    let files = []
    try {
      files = fs.readdirSync(sDir).filter(
        f => f.endsWith('.json') && !f.endsWith('-current.json')
      )
    } catch {
      return []
    }

    const entries = []
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(sDir, file), 'utf8')
        const record = JSON.parse(raw)
        const score = record.scores?.[dimension]
        if (score == null || score === 0) continue
        entries.push({ uid: record.uid, score, record })
      } catch { /* 跳过损坏文件 */ }
    }

    // 降序排序（越小越好的维度已在 scores 中取反）
    entries.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      return String(a.uid).localeCompare(String(b.uid))
    })

    return entries.slice(0, topN).map((e, i) => ({
      rank: i + 1,
      uid: e.uid,
      score: Math.round(e.score),
      record: e.record
    }))
  }

  /**
   * 获取某 uid 在排行中的名次
   */
  static async getRankForUid (uid, groupId, challengeType, dimension, scheduleId) {
    const typeName = TYPE_NAMES[challengeType]
    const sDir = seasonDir(typeName, scheduleId)

    let record
    try {
      record = JSON.parse(fs.readFileSync(uidJsonPath(typeName, scheduleId, uid), 'utf8'))
    } catch {
      return null
    }

    const targetScore = record.scores?.[dimension]
    if (targetScore == null || targetScore === 0) return null

    let files = []
    try {
      files = fs.readdirSync(sDir).filter(
        f => f.endsWith('.json') && !f.endsWith('-current.json')
      )
    } catch {
      return null
    }

    let rank = 1
    for (const file of files) {
      if (file === `${uid}.json`) continue
      try {
        const r = JSON.parse(fs.readFileSync(path.join(sDir, file), 'utf8'))
        const s = r.scores?.[dimension]
        if (s == null || s === 0) continue
        if (s > targetScore || (s === targetScore && String(r.uid).localeCompare(String(uid)) < 0)) rank++
      } catch { /* skip */ }
    }

    return { rank, uid: String(uid), score: Math.round(targetScore), record }
  }

  static async getRankCount (groupId, challengeType, dimension, scheduleId) {
    const sDir = seasonDir(TYPE_NAMES[challengeType], scheduleId)
    try {
      const files = fs.readdirSync(sDir).filter(
        f => f.endsWith('.json') && !f.endsWith('-current.json')
      )
      let count = 0
      for (const file of files) {
        try {
          const record = JSON.parse(fs.readFileSync(path.join(sDir, file), 'utf8'))
          if (record.scores?.[dimension] != null && record.scores[dimension] !== 0) count++
        } catch { /* skip */ }
      }
      return count
    } catch {
      return 0
    }
  }

  // ==================== 管理 ====================

  static async resetRank (groupId, challengeType = null) {
    const types = challengeType != null ? [challengeType] : [0, 1, 2, 3]
    for (const ct of types) {
      const cp = currentKeyPath(TYPE_NAMES[ct], groupId)
      try {
        if (fs.existsSync(cp)) fs.unlinkSync(cp)
      } catch (err) {
        logger?.error(`${LOG_PREFIX}[排行] 重置标记失败`, err)
      }
    }
    logger?.mark(`${LOG_PREFIX}[排行] 已重置群 ${groupId} 的赛季标记`)
  }

  static async resetRankData (challengeType) {
    const typeDir = path.join(DATA_BASE, TYPE_NAMES[challengeType])
    try {
      if (fs.existsSync(typeDir)) {
        fs.rmSync(typeDir, { recursive: true, force: true })
        logger?.mark(`${LOG_PREFIX}[排行] 已删除 ${TYPE_NAMES[challengeType]} 所有排行数据`)
      }
    } catch (err) {
      logger?.error(`${LOG_PREFIX}[排行] 删除排行数据失败`, err)
    }
  }

  // ==================== 群配置（Redis） ====================

  static _cfgKey (groupId) {
    return `Axiu:challenge:rank:${groupId}:cfg`
  }

  static async getGroupCfg (groupId) {
    try {
      const raw = await redis.get(this._cfgKey(groupId))
      if (raw) return JSON.parse(raw)
    } catch {}
    return { status: 1, timestamp: Date.now() }
  }

  static async setGroupStatus (groupId, status) {
    try {
      await redis.set(this._cfgKey(groupId), JSON.stringify({ status, timestamp: Date.now() }))
    } catch (err) {
      logger?.error(`${LOG_PREFIX}[排行] 设置群状态失败`, err)
    }
  }
}
