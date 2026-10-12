/**
 * 圣遗物总榜（原神）/ 遗器总榜（星铁）— 数据层，集中所有 miao-plugin 依赖
 *
 * 数据来源：miao-plugin 的群排行 Redis ZSET
 *   miao:rank:{groupId}:{type}:{charId}   ZSET（member = uid, score = 分数），type ∈ mark|dmg|crit|valid
 *   miao:rank:uid-info:{uid}              String JSON（{qq, uidType}）
 *   miao:rank:{groupId}:cfg               String JSON（status === 1 = 本群已关闭群排名）
 *
 * 口径：
 *   - 只读 `mark`（圣遗物/遗器评分）；伤害榜没有统一标准，不做
 *   - 一行 = (uid, 角色, 分数)：同角色多 uid 各占一行、同 uid 多角色各占一行
 *   - 按分数降序取前 N（N = miao 的「排行人数」配置），每个键只取前 N 条
 *   - 容忍残留：ZSET 里可能有已退群/已删角色的旧条目（上游「重置」键构造有误，清不掉），
 *     读出来照常显示，本模块不额外清理
 *
 * 对 miao-plugin 的 import 一律用**相对路径**（`#miao` 别名只在 miao 包内生效），
 * 且「懒加载 + try/catch」：拿不到就降级成「该功能需要 miao-plugin」，不影响插件其他功能。
 * 依赖集中在 `miaoAccessor` 里，回归套件可用 `setMiaoAccessor()` 注入替身。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOG_PREFIX } from '../components/constants.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')

/** 日志前缀（与其他模块一致的 `[Axiu-Plugin][模块名] 消息` 形式） */
const RANK_LOG_PREFIX = `${LOG_PREFIX}[圣遗物总榜] `

/** 只读评分榜：圣遗物/遗器评分的键类型 */
const RANK_TYPE = 'mark'

/** miao 的排行人数配置项（喵喵设置 → 排行人数）与其兜底值 */
const MIAO_RANK_NUMBER_CFG = 'rankNumber'
export const DEFAULT_TOP_N = 15

/** miao 排行键：miao:rank:{groupId}:{type}:{charId}（群号与角色 id 均为数字） */
const RANK_KEY_RE = /^miao:rank:(\d+):(mark|dmg|crit|valid):(\d+)$/

/** 角色 id 形态：原神 8 位、星铁 4 位（与 miao 的 getCharacterFromKey 一致） */
const CHAR_ID_LEN = { gs: 8, sr: 4 }

/** 键数超过该阈值就分批 await，避免一次并发几百个 Redis 请求 */
export const BATCH_THRESHOLD = 300

/** 单个批次并发数 */
const BATCH_SIZE = 50

/** 本群范围键模式 / 全局（跨群）范围键模式 */
const groupMarkPattern = (groupId) => `miao:rank:${groupId}:${RANK_TYPE}:*`
const GLOBAL_MARK_PATTERN = `miao:rank:*:${RANK_TYPE}:*`

/** 面向用户的固定文案（app 层直接回，套件断言也用这里的原文） */
export const MESSAGES = {
  notGroup: '总榜功能仅限群聊使用',
  groupClosed: '本群已关闭群排名，群管理员或 Bot 主人可通过【#启用排名】启用',
  noMiao: '该功能需要 miao-plugin',
  noData: '暂无排行数据：请先在群内用 #面板 / *面板 查看过角色面板'
}

/* ==================== miao 访问器（懒加载 + 降级） ==================== */

/** 懒加载缓存：null = 还没加载过，false = 不可用，对象 = 可用 */
let miaoModules = null

/**
 * 加载 miao-plugin 的组件与 model
 * 相对路径 import：不能写 `#miao`（该别名只在 miao 包内生效）
 * @returns {Promise<{Cfg: object, Data: object, Format: object, Player: object}|false>}
 */
async function loadMiaoModules () {
  if (miaoModules !== null) return miaoModules
  try {
    const [components, models] = await Promise.all([
      import('../../miao-plugin/components/index.js'),
      import('../../miao-plugin/models/index.js')
    ])
    const { Cfg, Data, Format } = components || {}
    const { Player } = models || {}
    if (typeof Cfg?.get !== 'function' || typeof Data?.getData !== 'function') {
      throw new Error('模块结构不符合预期（缺 Cfg.get / Data.getData）')
    }
    if (typeof Player?.create !== 'function') {
      throw new Error('模块结构不符合预期（缺 Player.create）')
    }
    miaoModules = { Cfg, Data, Format, Player }
  } catch (err) {
    miaoModules = false
    logger?.warn(`${RANK_LOG_PREFIX}加载 miao-plugin 失败，该功能降级：${err?.message ?? err}`)
  }
  return miaoModules
}

/** 元素中文 → 本插件 common.css 的元素 class（天赋图标底色按元素区分，映射同 miao 的 elemLayout） */
const ELEM_CLASS = {
  火: 'pyro',
  水: 'hydro',
  冰: 'cryo',
  风: 'anemo',
  雷: 'electro',
  草: 'dendro',
  岩: 'geo',
  量子: 'quantum',
  虚数: 'geo',
  物理: 'sr'
}

/** 天赋格的键表（键与 miao `avatar.getData('imgs')` / `talent` 一致） */
const TALENT_KEYS = {
  gs: { a: '普攻', e: '战技', q: '爆发' },
  sr: { a: '普攻', e: '战技', t: '天赋', q: '爆发' },
  srJoy: { a: '普攻', e: '战技', t: '天赋', q: '爆发', xe: '欢愉技' },
  srMemosprite: { a: '普攻', e: '战技', t: '天赋', q: '爆发', me: '忆灵技', mt: '忆灵天赋' }
}

/**
 * 该行的天赋格键表
 *
 * miao 的排行卡是按「当前查询的那一个角色」整页判定欢愉 / 记忆命途，总榜是混合行，
 * 因此这里按行判定，其余（原神 3 格 / 星铁 4 格）与 miao 一致。
 * @param {object} avatar miao Avatar 实例（weaponType 由角色元数据回填）
 * @param {'gs'|'sr'} game
 * @returns {object} { 键: 中文名 }
 */
function talentKeysOf (avatar, game) {
  if (game !== 'sr') return TALENT_KEYS.gs
  if (avatar?.weaponType === '欢愉') return TALENT_KEYS.srJoy
  if (avatar?.weaponType === '记忆') return TALENT_KEYS.srMemosprite
  return TALENT_KEYS.sr
}

/**
 * 默认 miao 访问器（生产用）
 * @returns {{available: () => Promise<boolean>, getRankNumber: () => Promise<number|null>,
 *   buildRow: (param: {uid: string, charId: string, game: string}) => Promise<object|null>}}
 */
function createDefaultAccessor () {
  return {
    /** miao-plugin 是否可用 */
    async available () {
      return (await loadMiaoModules()) !== false
    },

    /**
     * 排行人数上限（miao「排行人数」配置）
     * miao 的 `Cfg.get` 取不到时返回 undefined，这里统一兜底成 `DEFAULT_TOP_N`
     * @returns {Promise<number|null>} 取不到 miao 时返回 null
     */
    async getRankNumber () {
      const mods = await loadMiaoModules()
      if (!mods) return null
      try {
        const n = Number(mods.Cfg.get(MIAO_RANK_NUMBER_CFG, DEFAULT_TOP_N))
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TOP_N
      } catch (err) {
        logger?.warn(`${RANK_LOG_PREFIX}读取 miao 排行人数失败，用默认值 ${DEFAULT_TOP_N}：${err?.message ?? err}`)
        return DEFAULT_TOP_N
      }
    },

    /**
     * 按 miao 排行卡片的口径组装一行
     *
     * 字段与 miao `apps/profile/ProfileRank.js` 的 `renderCharRankList` 一致（同一批
     * `avatar.getData(...)` / `Data.getData(mark, ...)`），供搬迁过来的自建模板直接使用。
     *
     * 评分取 `profile.getArtisMark(false)`：即 miao `ProfileRank.getTypeValue('mark')` 内部的同一步。
     * **不调 `ProfileRank.getRank`**：`getRank(profile, false)` 在 uid 已进 ZSET 时（总榜的行本就来自 ZSET）
     * 不会计算 value，拿不到 `data.mark.data`，评分会全变 0。
     * 伤害按 miao `getTypeValue('dmg')` 同一步计算（`mode: 'single'`），只展示、不参与排序。
     * @param {{uid: string, charId: string, game: 'gs'|'sr'}} param
     * @returns {Promise<object|null>} 取不到面板（已删角色 / 无面板数据）返回 null，由调用方跳过该行
     */
    async buildRow ({ uid, charId, game = 'gs' }) {
      const mods = await loadMiaoModules()
      if (!mods) return null
      try {
        const player = mods.Player.create(uid, game)
        const avatar = player?.getAvatar(charId)
        if (!avatar) return null
        const profile = avatar.getProfile()
        if (!profile?.hasData) return null

        const mark = profile.getArtisMark?.(false)
        const row = {
          uid,
          isMax: false,
          ...avatar.getData('id,star,name,sName,level,fetter,cons,weapon,elem,talent,artisSet,imgs'),
          artisMark: mods.Data.getData(mark, 'mark,markClass,valid,crit'),
          talentKeys: talentKeysOf(avatar, game)
        }
        row.elem = ELEM_CLASS[row.elem] || row.elem
        row._mark = mark?._mark || 0
        row._formatmark = mods.Format.comma(row._mark, 1)
        row._star = 5 - (Number(row.star) || 0)
        row._dmg = 0

        // 伤害列：与 miao 一致的算法与标题缩短规则（miao ProfileRank.js:203-216）
        if (profile.hasDmg) {
          const dmg = await profile.calcDmg({ enemyLv: game === 'gs' ? 103 : 80, mode: 'single' })
          if (dmg?.avg) {
            let title = dmg.title
            if (title.length > 10) title = title.replace(/[ ·]*/g, '')
            title = title.length > 10 ? title.replace(/伤害$/, '') : title
            row.dmg = {
              title,
              avg: dmg.type !== 'text' ? mods.Format.comma(dmg.avg, 1) : dmg.avg
            }
          }
        }
        return row
      } catch (err) {
        logger?.warn(`${RANK_LOG_PREFIX}组装排行行失败 uid=${uid} char=${charId}：${err?.message ?? err}`)
        return null
      }
    }
  }
}

/** 当前 miao 访问器（生产为默认实现，套件可注入替身） */
let miaoAccessor = createDefaultAccessor()

/**
 * 注入 miao 访问替身（**回归套件专用**，生产不调用）
 * @param {object} accessor 只覆盖需要的字段，其余沿用默认实现
 */
export function setMiaoAccessor (accessor) {
  miaoAccessor = { ...createDefaultAccessor(), ...(accessor || {}) }
}

/** 还原默认 miao 访问器 */
export function resetMiaoAccessor () {
  miaoAccessor = createDefaultAccessor()
}

/**
 * miao-plugin 是否可用（供定时任务判断是否只刷 Axiu 一侧）
 * @param {object} [accessor] 访问替身，缺省用当前访问器
 */
export async function miaoAvailable (accessor = null) {
  try {
    return !!(await (accessor || miaoAccessor).available())
  } catch (err) {
    logger?.warn(`${RANK_LOG_PREFIX}探测 miao-plugin 失败：${err?.message ?? err}`)
    return false
  }
}

/* ==================== 键解析 ==================== */

/**
 * 角色 id → 游戏
 * @param {string|number} charId
 * @returns {'gs'|'sr'|null} 原神 8 位 / 星铁 4 位，其他形态返回 null
 */
export function gameOfCharId (charId) {
  const id = String(charId ?? '')
  if (!/^\d+$/.test(id)) return null
  if (id.length === CHAR_ID_LEN.gs) return 'gs'
  if (id.length === CHAR_ID_LEN.sr) return 'sr'
  return null
}

/**
 * 解析 miao 排行键
 * @param {string} key 形如 miao:rank:10001:mark:10000052
 * @param {'gs'|'sr'} game 期望的游戏（角色 id 形态不匹配时不算命中）
 * @returns {{groupId: string, charId: string, type: string}|null}
 */
export function parseRankKey (key, game = 'gs') {
  const m = RANK_KEY_RE.exec(String(key ?? ''))
  if (!m) return null
  const [, groupId, type, charId] = m
  if (gameOfCharId(charId) !== game) return null
  return { groupId, charId, type }
}

/**
 * 有排行数据（mark）的群集合
 *
 * 定时刷新只刷这些群，不遍历机器人所在的所有群；群号取自键本身。
 * @returns {Promise<string[]>} 群号升序数组
 */
export async function listRankGroups () {
  let keys = []
  try {
    keys = await redis.keys(GLOBAL_MARK_PATTERN)
  } catch (err) {
    logger?.warn(`${RANK_LOG_PREFIX}扫描排行键失败：${err?.message ?? err}`)
    return []
  }
  const groups = new Set()
  for (const key of keys) {
    const m = RANK_KEY_RE.exec(String(key))
    if (!m) continue
    // 角色 id 形态不是 8/4 位的键不是排行键（例如 miao:rank:uid-info:{uid} 这类）
    if (!gameOfCharId(m[3])) continue
    groups.add(m[1])
  }
  return [...groups].sort()
}

/* ==================== 群开关 / 用户信息 ==================== */

/**
 * 本群群排名开关（miao:rank:{groupId}:cfg）
 * @param {string} groupId
 * @returns {Promise<number>} 0 = 开启，1 = 已关闭；读不出来按开启处理
 */
export async function getGroupRankStatus (groupId) {
  try {
    const raw = await redis.get(`miao:rank:${groupId}:cfg`)
    if (!raw) return 0
    const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Number(cfg?.status) === 1 ? 1 : 0
  } catch (err) {
    logger?.warn(`${RANK_LOG_PREFIX}读取群排名开关失败 group=${groupId}：${err?.message ?? err}`)
    return 0
  }
}

/**
 * uid → 用户信息（miao:rank:uid-info:{uid} 是 JSON，含 qq / uidType）
 * @param {string} uid
 * @returns {Promise<object|null>}
 */
export async function getUidInfo (uid) {
  try {
    const raw = await redis.get(`miao:rank:uid-info:${uid}`)
    if (!raw) return null
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }
}

/**
 * miao-plugin 的 resources 目录（角色立绘 / 天赋图标 / 武器与圣遗物图标的前缀）
 *
 * 行数据里的图片字段（`avatar.getData('imgs')`、`weapon.img`、`artisSet.imgs`）是 miao 资源
 * 相对路径，拼上本前缀才能被模板加载。只读它的静态资源，不 import 也不改 miao 的任何文件。
 * @returns {string} 正斜杠绝对路径（不带结尾斜杠）
 */
export function miaoResourcesBase () {
  return path.resolve(pluginRoot, '../miao-plugin/resources').replace(/\\/g, '/')
}

/* ==================== 汇总流水线 ==================== */

/**
 * 分批 await：一批最多 `limit` 个并发
 * @param {any[]} items
 * @param {number} limit
 * @param {(item: any, index: number) => Promise<any>} fn
 */
async function mapLimit (items, limit, fn) {
  const size = Math.max(1, limit)
  const out = []
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size)
    out.push(...await Promise.all(batch.map((item, idx) => fn(item, i + idx))))
  }
  return out
}

/** 排行人数：优先用调用方指定，其次 miao 配置，最后兜底值 */
async function resolveTopN (topN, miao) {
  const given = Number(topN)
  if (Number.isFinite(given) && given > 0) return Math.floor(given)
  let n = null
  try {
    n = await miao.getRankNumber()
  } catch (err) {
    logger?.warn(`${RANK_LOG_PREFIX}读取排行人数失败：${err?.message ?? err}`)
  }
  const num = Number(n)
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : DEFAULT_TOP_N
}

/** 范围内的 mark 排行键（含从键里解析出的群号与角色 id） */
async function collectRankKeys (scope, groupId, game) {
  const pattern = scope === 'global' ? GLOBAL_MARK_PATTERN : groupMarkPattern(groupId)
  let keys = []
  try {
    keys = await redis.keys(pattern)
  } catch (err) {
    logger?.warn(`${RANK_LOG_PREFIX}扫描排行键失败 pattern=${pattern}：${err?.message ?? err}`)
    return []
  }
  const out = []
  for (const key of keys) {
    const parsed = parseRankKey(key, game)
    if (parsed) out.push({ key: String(key), ...parsed })
  }
  return out
}

/**
 * 汇总一张总榜
 * @param {object} [opts]
 * @param {string|null} [opts.groupId] 本群群号；null / 空 = 全局（跨群）
 * @param {'gs'|'sr'} [opts.game]
 * @param {number|null} [opts.topN] 覆盖排行人数（缺省读 miao 配置）
 * @param {object|null} [opts.accessor] miao 访问替身
 * @returns {Promise<{ok: boolean, reason?: string, scope: string, game: string, topN?: number,
 *   rows?: object[], keyCount?: number, candidateCount?: number}>}
 *   ok=false 时 reason ∈ group-closed | no-miao | no-data
 */
export async function buildArtisRank ({ groupId = null, game = 'gs', topN = null, accessor = null } = {}) {
  const miao = accessor || miaoAccessor
  const scope = groupId ? 'group' : 'global'

  // 本群范围先看群开关：关闭时直接提示，不读数据也不出图（全局范围不判群开关）
  if (scope === 'group' && await getGroupRankStatus(groupId) === 1) {
    return { ok: false, reason: 'group-closed', scope, game }
  }

  if (!(await miaoAvailable(miao))) {
    return { ok: false, reason: 'no-miao', scope, game }
  }

  const N = await resolveTopN(topN, miao)
  const keys = await collectRankKeys(scope, groupId, game)
  if (!keys.length) {
    return { ok: false, reason: 'no-data', scope, game, topN: N }
  }

  // 每个键只取前 N 条：汇总榜的前 N 不可能来自某角色第 N 名之后
  const limit = keys.length > BATCH_THRESHOLD ? BATCH_SIZE : keys.length
  const parts = await mapLimit(keys, limit, async (item) => {
    try {
      const list = await redis.zRangeWithScores(item.key, -N, -1)
      if (!Array.isArray(list)) return []
      return list
        .map(ds => ({
          groupId: item.groupId,
          charId: item.charId,
          uid: String(ds?.value ?? ds?.member ?? ''),
          score: Number(ds?.score)
        }))
        .filter(r => r.uid && Number.isFinite(r.score))
    } catch (err) {
      logger?.warn(`${RANK_LOG_PREFIX}读取排行键失败 key=${item.key}：${err?.message ?? err}`)
      return []
    }
  })

  let candidates = parts.flat()

  // 行身份 = (uid, 角色)：同一个 uid 的同一角色会在**多个群的键里各出现一次**，只保留分数最高的那条
  // （同分取群号较小者，保证结果稳定）。口径澄清：不同 uid 练同一角色、同一 uid 的不同角色都仍是多行，
  // 这里去重的只是「同一 uid 的同一角色」这一组合。
  {
    const bestByUidChar = new Map()
    for (const row of candidates) {
      const key = `${row.uid}|${row.charId}`
      const prev = bestByUidChar.get(key)
      const better = !prev ||
        row.score > prev.score ||
        (row.score === prev.score && String(row.groupId).localeCompare(String(prev.groupId)) < 0)
      if (better) bestByUidChar.set(key, row)
    }
    candidates = [...bestByUidChar.values()]
  }

  // 分数降序；同分按 uid → 角色 id → 群号定先后，保证同一份数据每次结果一致
  candidates.sort((a, b) =>
    (b.score - a.score) ||
    a.uid.localeCompare(b.uid) ||
    String(a.charId).localeCompare(String(b.charId)) ||
    String(a.groupId).localeCompare(String(b.groupId))
  )
  const top = candidates.slice(0, N)

  // 逐行按 miao 排行卡片的口径组装；取不到面板的行跳过（与 miao `if (!avatar) continue` 同义）。
  // 顺序执行：伤害计算较重，且与 miao 的 for 循环一致，不并发打满。
  // 额外附上本插件自己的标识字段（charId / score / gid）：模板不使用，供回归断言与排查定位。
  const built = []
  for (const item of top) {
    const row = await miao.buildRow({ uid: item.uid, charId: item.charId, game })
    if (!row) continue
    const info = await getUidInfo(item.uid)
    row.qq = info?.qq ? String(info.qq) : ''
    row.charId = item.charId
    row.score = item.score
    row.gid = item.groupId
    built.push(row)
  }
  const rows = built.map((row, idx) => ({ ...row, rank: idx + 1 }))

  return {
    ok: true,
    scope,
    game,
    topN: N,
    rows,
    keyCount: keys.length,
    candidateCount: candidates.length
  }
}
