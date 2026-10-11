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
import { withKeyLock } from '../components/asyncLock.js'

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
 * 名次键：**决定名次**的字段，数组顺序即优先级
 *
 * - 深渊：层 → 星（战斗次数会随重复查询增长，进名次会让排名往回走，因此只展示）
 * - 剧诗：模式 → 幕 → 星章 → 用时（借出同上，只展示）
 * - 危战：难度 → 用时（用时就该决定名次，不是展示项）
 *
 * 首查时间**不进名次键**：它只在「名次键相同」时决定先后（见 getRank）。
 */
const RANK_KEY_FIELDS = {
  0: ['floor', 'star'],
  1: ['mode', 'floor', 'flower', 'time'],
  2: ['difficulty', 'time'],
  3: ['difficulty', 'time']
}

/** 只展示、不进名次的 scores 字段（可配项，取**最后一次观测**的值） */
const DISPLAY_ONLY_FIELDS = {
  0: ['battle'],
  1: ['borrow'],
  2: [],
  3: []
}

/**
 * 名次键每级的取值上界
 *
 * 编码用混合进制（块宽 = 上界 + 1），因此上界必须**覆盖真实取值**，否则会向上借位、
 * 把高一级的分数顶掉。上界给的都比实际宽（例：深渊层 = 层*10+间，真实最大 123）
 */
const RANK_KEY_CAPS = {
  floor: 999,        // 深渊 = 层*10+间；剧诗 = 幕数
  star: 99,          // 深渊最深楼层星数
  mode: 99,          // 剧诗模式（difficulty_id）
  flower: 99,        // 剧诗明星挑战星章
  difficulty: 99,    // 危战难度
  time: 999999       // 用时（秒）上界：剧诗总耗时 / 危战单场用时
}

function capOf (key) { return RANK_KEY_CAPS[key] ?? 999 }

/**
 * 某一级 → 非负、且「越大越好」的整数
 *
 * `time` 这类 higher=false 的维度在 scores 里存**负的秒数**，加 cap 即「用时越短值越大」
 */
function levelValue (scores, key) {
  const raw = Number(scores?.[key] ?? 0)
  const v = Number.isFinite(raw) ? raw : 0
  const cap = capOf(key)
  const normalized = key === 'time' ? cap + v : v
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
 * 混合进制折叠：`v1*R2*R3... + v2*R3... + ...`，每级块宽 `R = 上界 + 1`，
 * **高一级的一个单位大于所有低级的最大合计**，所以低级永远翻不到高级之上
 * （第三轮踩过"块宽不够导致借位翻转"的坑）。同分数 ⇔ 同名次键，并列判定因此是结构性的。
 *
 * 首查时间**不编进来**：剧诗名次键已经到 1e13 量级，再乘时间戳会越过 2^53 丢精度；
 * 而"同键才比首查"这条约束靠"不同键 = 不同分数"天然成立，展示侧排序即可（见 getRank）。
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

/**
 * 重置互斥锁的键 —— 上报与重置共用一把**按玩法**的锁
 *
 * 上报与重置写的是同一批键（uid 元信息 + 各维度 ZSET + current/赛季指针），只按 uid 加锁管不到
 * ZSET 与重置的删键，两边没有共同互斥点就会交错出「ZSET 有成员但元信息无槽位」这类残留。
 * 粒度取 base type：危战单人/多人共用一把（两者的赛季键本来就共用一套），与其他玩法互不阻塞。
 * 获取顺序统一为 **resetLock → uidLock**，不得反向获取（见 report / resetRank）。
 */
function resetLockKey (type) {
  return `${KEY}:lock:reset:${type}`
}

/**
 * 依次取多个玩法的重置锁后执行 fn —— 重置可能一次覆盖多个玩法
 *
 * 按 base type 升序获取：并发重置若各持一把再互相等待会形成环形等待，升序可避免。
 * @param {number[]} bases - 本次涉及的 base type 列表
 * @param {function(): Promise<any>} fn - 锁内任务
 */
function withResetLocks (bases, fn) {
  const order = [...new Set(bases)].sort((a, b) => a - b)
  const run = (i) => (i >= order.length ? fn() : withKeyLock(resetLockKey(order[i]), () => run(i + 1)))
  return run(0)
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
    // 整个方法体都在本玩法的重置锁内：元信息合并、各维度 ZSET、current 指针、赛季元信息要么全在
    // 重置之前、要么全在之后，不会与重置的删键交错（锁序 resetLock → uidLock，不得反向）
    return withKeyLock(resetLockKey(this._baseType(challengeType)), async () => {
      const { scores, extra } = this.extractScores(data, challengeType)
      const slotKey = String(scheduleId)
      const startTs = data?.start_time || data?.schedule?.start_time || null

      // 同一 uid 的并发上报会读写同一 uidKey，非原子读改写会互相覆盖 → 按 uidKey 串行化。
      // 段内完成「读已有信息 → 合并出本期最优成绩 → 写回本类型本期槽位」，返回要写进 ZSET 的那份成绩
      const stored = await withKeyLock(uidKey(uid), async () => {
        let existing = null
        try { existing = await redis.get(uidKey(uid)) } catch {}
        let info = {}
        if (existing) {
          try { info = JSON.parse(existing) || {} } catch { info = {} }
        }
        info.qq = String(qq || '')
        if (!info[challengeType] || typeof info[challengeType] !== 'object') info[challengeType] = {}
        const prevSlot = info[challengeType][slotKey]
        // 首查时间 = 该期**第一次观测到成绩**的时刻；落定后不再改（成绩提升也不刷新）
        const ft = Number.isFinite(prevSlot?.firstTime) ? Number(prevSlot.firstTime) : Date.now()
        // 名次键取本期最优（编码单调 ⇒ 比编码等价于比元组）；不进名次的展示字段取最后一次观测
        const prevScores = prevSlot?.scores
        const best = (!prevScores || rankKeyScore(scores, challengeType) > rankKeyScore(prevScores, challengeType))
          ? scores
          : { ...prevScores, ...pickDisplayFields(scores, challengeType) }
        info[challengeType][slotKey] = { scores: best, extra, firstTime: ft, startTs, time: Date.now() }
        try {
          await redis.setEx(uidKey(uid), 90 * 24 * 3600, JSON.stringify(info))
        } catch (err) {
          logger?.error(`${LOG_PREFIX}[原神排行] 设置 UID 信息失败`, err)
        }
        return best
      })

      // `__` 维度写名次键编码（首查不进分数，并列组内的先后由展示侧按 firstTime 排）
      const compound = rankKeyScore(stored, challengeType)
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
        const val = stored[dim.key]
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

      // UID 信息已在上面按 uidKey 串行化的段内写回（含首查时间与本期槽位）

      logger?.mark(`${LOG_PREFIX}[原神排行] ${TYPE_NAMES[challengeType] || challengeType} uid:${uid} 上报完成, scheduleId:${scheduleId}, compound:${compound}`)
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
      return { rank: better.size + 1, uid: String(uid), score: displayScore, qq, extra }
    } catch { return null }
  }

  static async getRankCount (groupId, challengeType, dimension, scheduleId) {
    try { return await redis.zCard(rankKey(challengeType, dimension, scheduleId)) } catch { return 0 }
  }

  // ==================== 刷新（重排） ====================

  /**
   * 全量重排行榜：遍历 uid 元数据，用存储的 scores/extra/firstTime/startTs 重算综合分与各维度分，
   * 重建全部 scheduleId 的 ZSET。用于公式调整或数据异常后的重排修复。
   * @param {number|null} onlyType 只重排指定类型（null = 全部 0-3）
   * @returns {Promise<{total: number, types: object}>} 处理的 uid 数 / 各类型 schedule 数
   */
  static async rebuildAll (onlyType = null) {
    const types = onlyType != null ? [onlyType] : [0, 1, 2, 3]
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

            const compound = rankKeyScore(scores, ct)
            if (compound > 0) {
              try {
                const ck = rankKey(ct, '__', sid)
                await redis.zAdd(ck, { score: compound, value: uid })
                await redis.expire(ck, TTL)
              } catch (err) {
                logger?.error(`${LOG_PREFIX}[原神排行] 重排 compound zAdd 失败 uid=${uid}`, err)
              }
            }
            for (const dim of this.getDimensions(ct)) {
              const val = scores[dim.key]
              if (val == null) continue
              try {
                const rk = rankKey(ct, dim.key, sid)
                await redis.zAdd(rk, { score: val, value: uid })
                await redis.expire(rk, TTL)
              } catch (err) {
                logger?.error(`${LOG_PREFIX}[原神排行] 重排 zAdd 失败 uid=${uid}`, err)
              }
            }
          }
        }
      }
    } catch (err) {
      logger?.error(`${LOG_PREFIX}[原神排行] 重排失败`, err)
    }
    return { total: totalUids, types: stats }
  }

  // ==================== 管理 ====================

  static async resetRank (groupId, challengeType = null) {
    const types = challengeType != null ? [challengeType] : [0, 1, 2, 3]
    // 整个方法体在本玩法（base type）的重置锁内：与 report 共用同一把锁，删键与上报不再交错；
    // 锁序 resetLock → uidLock（_pruneUidInfo 内部再取 uid 锁），不得反向
    return withResetLocks(types.map(t => this._baseType(t)), async () => {
      const delKeys = []
      for (const ct of types) {
        // 排行 ZSET 按真实 type 存储（危战单/多人各自独立）
        const zsetPattern = `${KEY}:${ct}:*`
        try {
          const keys = await redis.keys(zsetPattern)
          if (keys?.length) delKeys.push(...keys)
        } catch (err) {
          logger?.error(`${LOG_PREFIX}[原神排行] 扫描 ZSET 失败`, err)
        }
        // 当前赛季指针与赛季元信息按 base type 共享（危战单/多人共用一个 key，重置其一会一并清除，下次上报重建）
        const baseT = this._baseType(ct)
        try {
          const cur = await redis.get(currentKey(baseT)) || null
          if (cur) delKeys.push(currentKey(baseT))
        } catch {}
        try {
          const seasonKeys = await redis.keys(`${KEY}:season:${baseT}:*`)
          if (seasonKeys?.length) delKeys.push(...seasonKeys)
        } catch (err) {
          logger?.error(`${LOG_PREFIX}[原神排行] 扫描赛季元信息失败`, err)
        }
      }
      // UID 元信息一个 key 含所有类型，只能按类型修剪槽位，不能整键删除
      await this._pruneUidInfo(types)
      if (delKeys.length) {
        try { await redis.del(...delKeys) } catch (err) {
          logger?.error(`${LOG_PREFIX}[原神排行] 删除排行数据失败`, err)
        }
      }
      logger?.mark(`${LOG_PREFIX}[原神排行] 已重置排行数据（类型: ${types.join('/')}）`)
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
      logger?.error(`${LOG_PREFIX}[原神排行] 修剪 UID 元信息失败`, err)
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
      logger?.error(`${LOG_PREFIX}[原神排行] 设置群状态失败`, err)
    }
  }
}
