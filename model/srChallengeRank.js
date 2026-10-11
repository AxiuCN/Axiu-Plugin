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
import { withKeyLock } from '../components/asyncLock.js'

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
    { key: 'star', label: '星数', desc: '最深层星数', higher: true },
    { key: 'score', label: '分数', desc: '总分', higher: true },
    { key: 'battle', label: '战斗', desc: '战斗次数', higher: false },
    { key: 'round', label: '轮数', desc: '使用轮数', higher: false }
  ],
  1: [
    { key: 'star', label: '星数', desc: '最深层星数', higher: true },
    { key: 'score', label: '分数', desc: '总分', higher: true },
    { key: 'battle', label: '战斗', desc: '战斗次数', higher: false },
    { key: 'round', label: '轮数', desc: '使用轮数', higher: false }
  ],
  2: [
    { key: 'star', label: '星数', desc: '最深层星数', higher: true },
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
 * 名次键：**决定名次**的字段，数组顺序即优先级
 *
 * 末日 难度→分；虚构 层→星→分→轮；忘却 层→星→轮；仲裁 绝境→王棋→骑士→轮
 * （战斗次数会随重复挑战增长，进名次会让排名往回走，因此只展示）
 *
 * 首查时间**不进名次键**：只在「名次键相同」时决定先后（见 getRank）。
 */
const RANK_KEY_FIELDS = {
  0: ['floor', 'score'],
  1: ['floor', 'star', 'score', 'round'],
  2: ['floor', 'star', 'round'],
  3: ['hard', 'boss', 'mob', 'round']
}

/** 只展示、不进名次的 scores 字段（取**最后一次观测**的值） */
const DISPLAY_ONLY_FIELDS = {
  0: ['battle'],
  1: ['battle'],
  2: ['battle'],
  3: []
}

/**
 * 名次键每级的取值上界（块宽 = 上界 + 1）
 *
 * 上界必须覆盖真实取值，否则会向上借位：旧的虚构公式 `score*10` 在 score ≥ 10000 时
 * 就会顶掉星数位，正是不够宽的例子。这里给的都留了余量（分数按 6 位取）
 */
const RANK_KEY_CAPS = {
  floor: 999, star: 99, score: 999999, round: 99, hard: 99, boss: 99, mob: 99
}

function capOf (key) { return RANK_KEY_CAPS[key] ?? 999 }

/** 某一级 → 非负、且「越大越好」的整数（`round` 在 scores 里存负的轮数，加 cap 即轮数越少越大） */
function levelValue (scores, key) {
  const raw = Number(scores?.[key] ?? 0)
  const v = Number.isFinite(raw) ? raw : 0
  const cap = capOf(key)
  const normalized = key === 'round' ? cap + v : v
  return Math.max(0, Math.min(cap, normalized))
}

/** 只展示的字段（取最后一次观测值），用于「名次键没变好」时刷新展示数据 */
function pickDisplayFields (scores, challengeType) {
  const out = {}
  for (const key of DISPLAY_ONLY_FIELDS[challengeType] || []) {
    if (scores?.[key] != null) out[key] = scores[key]
  }
  return out
}

/**
 * 名次键编码 —— `__` 维度的 ZSET 分数
 *
 * 混合进制折叠：每级块宽 `R = 上界 + 1`，**高一级的一个单位大于所有低级的最大合计**，
 * 低级永远翻不到高级之上（同分数 ⇔ 同名次键，并列判定因此是结构性的）。
 * 首查时间不编进来（会越过 2^53 丢精度），并列组内的先后由展示侧按 firstTime 排。
 */
function rankKeyScore (scores, challengeType) {
  const fields = RANK_KEY_FIELDS[challengeType] || []
  let value = 0
  for (const field of fields) {
    value = value * (capOf(field) + 1) + levelValue(scores, field)
  }
  return value
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

/**
 * 重置互斥锁的键 —— 上报与重置共用一把**按玩法**的锁
 *
 * 上报与重置写的是同一批键（uid 元信息 + 各维度 ZSET + current/赛季指针），只按 uid 加锁管不到
 * ZSET 与重置的删键，两边没有共同互斥点就会交错出「ZSET 有成员但元信息无槽位」这类残留。
 * 星铁四种挑战的 current / 赛季键本来就各按 type 独立，粒度即 challengeType 本身（没有 base type）。
 * 获取顺序统一为 **resetLock → uidLock**，不得反向获取（见 report / resetRank）。
 */
function resetLockKey (type) {
  return `${KEY}:lock:reset:${type}`
}

/**
 * 依次取多个玩法的重置锁后执行 fn —— 重置可能一次覆盖多个玩法
 *
 * 按 type 升序获取：并发重置若各持一把再互相等待会形成环形等待，升序可避免。
 * @param {number[]} types - 本次涉及的挑战类型
 * @param {function(): Promise<any>} fn - 锁内任务
 */
function withResetLocks (types, fn) {
  const order = [...new Set(types)].sort((a, b) => a - b)
  const run = (i) => (i >= order.length ? fn() : withKeyLock(resetLockKey(order[i]), () => run(i + 1)))
  return run(0)
}

export default class SrChallengeRank {
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

  /**
   * @param {boolean} [isCurrent=true] 是否当期数据 — 仅当期才更新 current 指针，防止上期/往期查询污染
   */
  static async report (uid, qq, groupId, challengeType, data, scheduleId, isCurrent = true) {
    // 整个方法体都在本玩法的重置锁内：元信息合并、各维度 ZSET、current 指针、赛季元信息要么全在
    // 重置之前、要么全在之后，不会与重置的删键交错（锁序 resetLock → uidLock，不得反向）
    return withKeyLock(resetLockKey(challengeType), async () => {
      const { scores, extra } = this.extractScores(data, challengeType)

      // 同一 uid 的并发上报（如 *深渊 并发查询三种挑战）会读写同一 uidKey，非原子读改写会互相覆盖
      // → 按 uidKey 串行化；段内完成「读已有信息 → 合并出本期最优成绩 → 写回本类型本期槽位」
      let effective = scores
      try {
        effective = await withKeyLock(uidKey(uid), async () => {
          const existing = await redis.get(uidKey(uid))
          const info = existing ? JSON.parse(existing) : {}
          info.qq = String(qq || '')
          if (!info[challengeType] || typeof info[challengeType] !== 'object') info[challengeType] = {}
          const prevSlot = info[challengeType][String(scheduleId)]
          // 首查时间 = 该期**第一次观测到成绩**的时刻；落定后不再改（成绩提升也不刷新）
          const ft = Number.isFinite(prevSlot?.firstTime) ? Number(prevSlot.firstTime) : Date.now()
          // 名次键取本期最优（编码单调 ⇒ 比编码等价于比元组）；不进名次的展示字段取最后一次观测
          const prevScores = prevSlot?.scores
          const best = (!prevScores || rankKeyScore(scores, challengeType) > rankKeyScore(prevScores, challengeType))
            ? scores
            : { ...prevScores, ...pickDisplayFields(scores, challengeType) }
          info[challengeType][String(scheduleId)] = { scores: best, extra, firstTime: ft, time: Date.now() }
          await redis.setEx(uidKey(uid), TTL, JSON.stringify(info))
          return best
        })
      } catch (err) {
        logger?.error(`${LOG_PREFIX}[排行] 设置 UID 信息失败`, err)
      }

      // `__` 维度写名次键编码（首查不进分数，并列组内的先后由展示侧按 firstTime 排）
      const compound = rankKeyScore(effective, challengeType)
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
        const val = effective[dim.key]
        if (val == null) continue
        try {
          const rk = rankKey(challengeType, dim.key, scheduleId)
          await redis.zAdd(rk, { score: val, value: String(uid) })
          await redis.expire(rk, TTL)
        } catch (err) {
          logger?.error(`${LOG_PREFIX}[排行] zAdd 失败`, err)
        }
      }

      // 当前赛季 scheduleId — 仅当期更新，上期/往期上报不污染 current 指针
      if (isCurrent) {
        try { await redis.setEx(currentKey(challengeType), TTL, scheduleId) } catch {}
      }

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

      // UID 信息已在上面的 uidKey 串行段内写回（含首查时间与本期最优成绩）
    })
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

    /** 首查时间：只在并列（同分数 = 同名次键）时决定先后；缺失的排到同名次末尾 */
    const firstTimeOf = (uid) => {
      const slot = (infoMap[uid] || {})[challengeType]
      const cur = slot && typeof slot === 'object' ? slot[String(scheduleId)] : null
      const ft = Number(cur?.firstTime ?? slot?.firstTime)
      return Number.isFinite(ft) ? ft : Number.MAX_SAFE_INTEGER
    }

    const rows = members.map(m => {
      const uid = String(m.value || m.member)
      const info = infoMap[uid] || {}
      return {
        uid,
        raw: Number(m.score) || 0,
        firstTime: firstTimeOf(uid),
        qq: info.qq || '',
        extra: this._extractUidExtra(info, challengeType, scheduleId)
      }
    })

    /* 分数降序；同分按首查升序。**密集名次**（1,1,2）：分数一变才 +1 —— 同分 ⇔ 同名次键 */
    rows.sort((a, b) => (b.raw - a.raw) || (a.firstTime - b.firstTime))
    let rank = 0
    let prevRaw = null
    return rows.map(r => {
      if (prevRaw === null || r.raw !== prevRaw) rank += 1
      prevRaw = r.raw
      return {
        rank,
        uid: r.uid,
        score: isCompound ? displayScore(r.extra, challengeType) : Math.round(r.raw),
        qq: r.qq,
        extra: r.extra
      }
    })
  }

  static async getRankForUid (uid, groupId, challengeType, dimension, scheduleId) {
    const isCompound = dimension === '__'
    const key = rankKey(challengeType, dimension, scheduleId)
    try {
      const score = await redis.zScore(key, String(uid))
      if (score == null) return null
      /* 密集名次：只数「严格更好的不同分数」个数（同分并列同名次，不再用名次下标 + 1） */
      const all = await redis.zRangeWithScores(key, 0, -1)
      const better = new Set()
      for (const m of all || []) {
        const s = Number(m.score) || 0
        if (s > Number(score)) better.add(s)
      }

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
        ? (() => { switch (challengeType) { case 0: return extra.total_score || extra.star_num || 0; case 1: return extra.star_num || 0; case 2: return extra.star_num || 0; case 3: return extra.boss_stars || 0; default: return 0 } })()
        : Math.round(score)
      return { rank: better.size + 1, uid: String(uid), score: displayScore, qq, extra }
    } catch { return null }
  }

  static async getRankCount (groupId, challengeType, dimension, scheduleId) {
    try { return await redis.zCard(rankKey(challengeType, dimension, scheduleId)) } catch { return 0 }
  }

  // ==================== 刷新（重排） ====================

  /**
   * 全量重排行榜：遍历 uid 元数据，用存储的 scores/extra 重算综合分与各维度分，
   * 重建全部 scheduleId 的 ZSET。用于公式调整或数据异常后的重排修复。
   * @param {number|null} onlyType 只重排指定类型（null = 全部 0-3）
   * @returns {Promise<{total: number, types: object}>} 处理的 uid 数 / 各类型 schedule 数
   */
  static async rebuildAll (onlyType = null) {
    const types = onlyType != null ? [onlyType] : [0, 1, 2, 3]
    // 整个方法体在本玩法（challengeType）的重置锁内：重排遍历全部 uid 元信息后重建 ZSET，
    // 与上报 / 重置交错会写出「元信息已删但 ZSET 刚被重排写回」这类残留；
    // 锁序 resetLock → uidLock（本方法内部不取 uid 锁），不得反向
    return withResetLocks(types, async () => {
      const stats = {}
      for (const ct of types) stats[ct] = { uids: 0, schedules: 0 }
      let totalUids = 0

      try {
        const uidKeys = await redis.keys(`${KEY}:uid:*`)
        for (const key of uidKeys) {
          const uid = key.split(':').pop()
          let raw
          try { raw = await redis.get(key) } catch { continue }
          if (!raw) continue
          let info
          try { info = JSON.parse(raw) } catch { continue }

          for (const ct of types) {
            const slotMap = info?.[ct]
            if (!slotMap || typeof slotMap !== 'object') continue
            stats[ct].uids++
            totalUids++

            for (const [sid, slot] of Object.entries(slotMap)) {
              const { scores } = (slot && typeof slot === 'object') ? slot : {}
              if (!scores) continue
              stats[ct].schedules++

              // 重建综合分 ZSET
              const compound = rankKeyScore(scores, ct)
              if (compound > 0) {
                try {
                  const ck = rankKey(ct, '__', sid)
                  await redis.zAdd(ck, { score: compound, value: uid })
                  await redis.expire(ck, TTL)
                } catch (err) {
                  logger?.error(`${LOG_PREFIX}[排行] 重排 compound zAdd 失败 uid=${uid}`, err)
                }
              }
              // 重建各维度 ZSET
              for (const dim of this.getDimensions(ct)) {
                const val = scores[dim.key]
                if (val == null) continue
                try {
                  const rk = rankKey(ct, dim.key, sid)
                  await redis.zAdd(rk, { score: val, value: uid })
                  await redis.expire(rk, TTL)
                } catch (err) {
                  logger?.error(`${LOG_PREFIX}[排行] 重排 zAdd 失败 uid=${uid}`, err)
                }
              }
            }
          }
        }
      } catch (err) {
        logger?.error(`${LOG_PREFIX}[排行] 重排失败`, err)
      }
      return { total: totalUids, types: stats }
    })
  }

  // ==================== 管理 ====================

  static async resetRank (groupId, challengeType = null) {
    const types = challengeType != null ? [challengeType] : [0, 1, 2, 3]
    // 整个方法体在本玩法的重置锁内：与 report 共用同一把锁，删键与上报不再交错；
    // 锁序 resetLock → uidLock（_pruneUidInfo 内部再取 uid 锁），不得反向
    return withResetLocks(types, async () => {
      const delKeys = []
      for (const ct of types) {
        // 排行 ZSET（含综合 __ 与各维度）
        const zsetPattern = `${KEY}:${ct}:*`
        try {
          const keys = await redis.keys(zsetPattern)
          if (keys?.length) delKeys.push(...keys)
        } catch (err) {
          logger?.error(`${LOG_PREFIX}[排行] 扫描 ZSET 失败`, err)
        }
        // 当前赛季指针
        try {
          const cur = await redis.get(currentKey(ct)) || null
          if (cur) delKeys.push(currentKey(ct))
        } catch {}
        // 赛季元信息（按本次目标类型精确清理，不波及其他类型）
        try {
          const seasonKeys = await redis.keys(`${KEY}:season:${ct}:*`)
          if (seasonKeys?.length) delKeys.push(...seasonKeys)
        } catch (err) {
          logger?.error(`${LOG_PREFIX}[排行] 扫描赛季元信息失败`, err)
        }
      }
      // UID 元信息一个 key 含所有类型，只能按类型修剪槽位，不能整键删除
      await this._pruneUidInfo(types)
      if (delKeys.length) {
        try { await redis.del(...delKeys) } catch (err) {
          logger?.error(`${LOG_PREFIX}[排行] 删除排行数据失败`, err)
        }
      }
      logger?.mark(`${LOG_PREFIX}[排行] 已重置排行数据（类型: ${types.join('/')}）`)
    })
  }

  /**
   * 定向重置时修剪 UID 元信息：仅移除目标挑战类型的槽位，其他类型的成绩明细保留；
   * 全部类型槽位清空后才删除整个 key
   * @param {number[]} types - 本次重置的挑战类型
   */
  static async _pruneUidInfo (types) {
    try {
      const uidKeys = await redis.keys(`${KEY}:uid:*`)
      for (const key of uidKeys || []) {
        // 与 report() 共用同一把 key 锁，且读取必须在锁内：
        // 否则锁外取的旧快照会覆盖并发上报刚写入的其他玩法明细（第三轮 P2-2）
        await withKeyLock(key, async () => {
          let info = null
          try {
            const raw = await redis.get(key)
            if (!raw) return
            info = JSON.parse(raw)
          } catch { return }
          if (!info || typeof info !== 'object') return

          let changed = false
          for (const ct of types) {
            if (info[ct] != null) { delete info[ct]; changed = true }
          }
          if (!changed) return

          if (Object.keys(info).filter(k => k !== 'qq').length === 0) {
            await redis.del(key)
          } else {
            await redis.setEx(key, TTL, JSON.stringify(info))
          }
        })
      }
    } catch (err) {
      logger?.error(`${LOG_PREFIX}[排行] 修剪 UID 元信息失败`, err)
    }
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
