/** 星铁抽卡记录同步 — 参考荷花重制版（Lotus-ReFactor）starRailGacha
 *
 *  官方接口链路（不走 authkey，星铁外部 authkey 不可用）：
 *    1. badge login: POST api-takumi.mihoyo.com/common/badge/v1/login/account
 *       （cookie + uid/region/game_biz=hkrpg_cn）→ Set-Cookie e_hkrpg_token
 *    2. rpg_gacha_record: GET act-api-takumi.mihoyo.com/event/rpg_gacha_record/{brief|five_star_list|pool_stat}
 *       （cookie + badge_uid/badge_region + gacha_type，five_star_list 游标分页）
 *    3. 数据镜像成 genshin srJson 格式（data/srJson/{qq}/{uid}/{type}.json），
 *       使 genshin gcLog 查询/统计/渲染体系（*角色记录 等）直接可用
 *
 *  注意：官方小程序接口仅暴露五星列表 + 卡池统计 + 垫抽，无每抽明细——
 *        每抽全量需手动星铁 authkey 链接走 genshin 导入
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')

const BADGE_LOGIN_URL = 'https://api-takumi.mihoyo.com/common/badge/v1/login/account'
const GACHA_API_ROOT = 'https://act-api-takumi.mihoyo.com/event/rpg_gacha_record'

/** 星铁卡池：外部枚举 → 游戏数值 gacha_type */
export const STAR_RAIL_GACHA_TYPES = Object.freeze({
  GachaType_AvatarUp: 11,
  GachaType_EquipmentUp: 12,
  GachaType_CollabAvatarUp: 21,
  GachaType_CollabEquipmentUp: 22,
  GachaType_Standard: 1,
  GachaType_Newbie: 2
})

const POOL_NAME = {
  11: '角色活动跃迁',
  12: '光锥活动跃迁',
  21: '联动角色跃迁',
  22: '联动光锥跃迁',
  1: '常驻跃迁',
  2: '新手跃迁'
}

/** genshin srJson 后缀（对应 genshin gachaLog srPool） */
const SR_POOL_TYPES = Object.freeze({ 11: 11, 12: 12, 21: 21, 22: 22, 1: 1, 2: 2 })

const DEFAULT_REQUEST_TIMEOUT = 30000
const DEFAULT_MAX_PAGES = 50
const DEFAULT_PAGE_DELAY = 0
const DEFAULT_POOL_DELAY = 300

export class StarRailGachaService {
  constructor (options = {}) {
    this.fetch = options.fetch || globalThis.fetch
    this.maxPages = Number(options.maxPages ?? DEFAULT_MAX_PAGES)
    this.pageDelayMs = Number(options.pageDelayMs ?? DEFAULT_PAGE_DELAY)
    this.poolDelayMs = Number(options.poolDelayMs ?? DEFAULT_POOL_DELAY)
    this.requestTimeoutMs = Number(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT)
    this.sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  }

  /**
   * 用星铁账号 cookie 同步抽卡记录到本地 srJson
   * @param {object} param
   * @param {string|number} param.qq - QQ
   * @param {string|number} param.uid - 星铁 UID
   * @param {string} param.region - 星铁 region（prod_*）
   * @param {string} param.cookie - 账号 cookie（含 ltuid/ltoken/cookie_token）
   * @returns {Promise<{ok: boolean, uid: string, added: number, pools: Array}>}
   */
  async updateByCookie ({ qq, uid, region, cookie }) {
    if (!qq || !uid || !region || !cookie) {
      throw new Error('星铁 UID、region 和 cookie 均不能为空')
    }

    const jar = new CookieJar(cookie)
    await this.badgeLogin({ uid, region, jar })
    if (!jar.has('e_hkrpg_token')) {
      throw new Error('星铁活动登录未返回 e_hkrpg_token')
    }

    const context = {
      uid: String(uid),
      region: String(region),
      jar,
      deviceId: randomHex32()
    }

    const previous = readSrJson(qq, uid)
    const oldFiveMap = collectFiveStars(previous)
    let added = 0
    const poolResults = []

    const typeEntries = Object.entries(STAR_RAIL_GACHA_TYPES)
    for (const [index, [, type]] of typeEntries.entries()) {
      const [poolStat, fiveStarPage] = await Promise.all([
        this.requestGacha('pool_stat', context, { gacha_type: type }).catch(() => null),
        this.fetchFiveStars(context, type)
      ])
      const fiveStars = fiveStarPage.records
      const oldIds = new Set((oldFiveMap[type] || []).map(recordKey))
      const addedInPool = fiveStars.filter(item => !oldIds.has(recordKey(item))).length
      added += addedInPool

      const cards = Array.isArray(poolStat?.cards) ? poolStat.cards.map(normalizeCard) : []
      const totalDraws = cards.reduce((sum, card) => sum + nonNegativeInt(card.total_count), 0)
      const pity = fiveStarPage.pity != null ? fiveStarPage.pity : undefined

      // 构造 genshin srJson 每池记录（五星 + 占位补抽数）
      const records = buildMiaoPoolRecords({
        fiveStars,
        pity,
        totalDraws,
        uid,
        type,
        prevRecords: oldFiveMap[type] || []
      })
      writeSrJson(qq, uid, type, records)

      poolResults.push({
        type,
        name: POOL_NAME[type] || String(type),
        added: addedInPool,
        total: fiveStars.length,
        totalDraws,
        pity: pity != null ? pity : currentPity(records)
      })

      if (this.poolDelayMs > 0 && index < typeEntries.length - 1) {
        await this.sleep(this.poolDelayMs)
      }
    }
    writeSrJsonMetadata(qq, uid, region)

    return {
      ok: true,
      game: 'sr',
      source: 'cookie',
      uid: String(uid),
      added,
      pools: poolResults
    }
  }

  /** badge 登录：拿 e_hkrpg_token（Set-Cookie） */
  async badgeLogin ({ uid, region, jar }) {
    await this.requestJson(BADGE_LOGIN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        Cookie: jar.header(),
        Origin: 'https://act.mihoyo.com',
        Referer: 'https://act.mihoyo.com/',
        'User-Agent': 'Mozilla/5.0 Axiu-StarRail-Gacha'
      },
      body: JSON.stringify({ uid: String(uid), region: String(region), game_biz: 'hkrpg_cn', lang: 'zh-cn' })
    }, jar)
  }

  /** 分页拉取指定池全部五星 */
  async fetchFiveStars (context, type) {
    const records = []
    let pity = null
    let cursor = null
    const seenCursors = new Set()
    for (let page = 1; page <= this.maxPages; page++) {
      const extra = { gacha_type: type }
      if (cursor) Object.assign(extra, cursor)
      const data = await this.requestGacha('five_star_list', context, extra)
      const list = Array.isArray(data?.list) ? data.list : []
      for (const raw of list) {
        if (!raw?.item) {
          if (pity === null) pity = nonNegativeInt(raw?.gacha_count)
          continue
        }
        records.push(normalizeFiveStar(raw))
      }
      if (!data?.has_more) break

      const versionId = String(data.version_id || '')
      const maxId = String(data.next_max_id || '')
      const key = `${versionId}:${maxId}`
      if (!versionId || !maxId || seenCursors.has(key)) {
        throw new Error(`星铁${POOL_NAME[type] || type}分页游标异常`)
      }
      seenCursors.add(key)
      cursor = { version_id: versionId, max_id: maxId }
      if (this.pageDelayMs > 0) await this.sleep(this.pageDelayMs)
      if (page === this.maxPages) throw new Error(`星铁${POOL_NAME[type] || type}分页超过上限`)
    }
    return { records, pity }
  }

  /** rpg_gacha_record 请求 */
  async requestGacha (endpoint, context, extra = {}) {
    const query = new URLSearchParams({
      badge_region: context.region,
      badge_uid: context.uid,
      game_biz: 'hkrpg_cn',
      region: context.region,
      uid: context.uid,
      ...extra
    })
    return this.requestJson(`${GACHA_API_ROOT}/${endpoint}?${query}`, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        Cookie: context.jar.header(),
        Origin: 'https://act.mihoyo.com',
        Referer: 'https://act.mihoyo.com/sr/event/gt-aio/gacha-records/index.html',
        'User-Agent': 'Mozilla/5.0 Axiu-StarRail-Gacha',
        'x-rpc-device_id': context.deviceId,
        'x-rpc-jump_source': 'wechatmp',
        'x-rpc-platform': '4'
      }
    }, context.jar)
  }

  async requestJson (url, options, jar) {
    const requestOptions = { ...options }
    if (!requestOptions.signal && typeof AbortSignal?.timeout === 'function') {
      requestOptions.signal = AbortSignal.timeout(this.requestTimeoutMs)
    }
    let response
    try {
      response = await this.fetch(url, requestOptions)
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new Error(`星铁抽卡接口请求超时（${this.requestTimeoutMs}ms）`)
      }
      throw error
    }
    jar?.update(response)
    const body = await response.json().catch(() => null)
    if (!response.ok || body?.retcode !== 0) {
      const error = new Error(body?.message || `HTTP ${response.status}`)
      error.retcode = body?.retcode
      error.response = body
      throw error
    }
    return body?.data || {}
  }
}

/** 简易 Cookie 容器（解析 + Set-Cookie 更新） */
class CookieJar {
  constructor (cookie = '') {
    this.values = new Map()
    for (const part of String(cookie).split(';')) {
      const index = part.indexOf('=')
      if (index > 0) this.values.set(part.slice(0, index).trim(), part.slice(index + 1).trim())
    }
  }

  has (key) { return this.values.has(key) }
  header () { return [...this.values].map(([key, value]) => `${key}=${value}`).join('; ') }

  update (response) {
    const setCookies = typeof response?.headers?.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response?.headers?.get?.('set-cookie')].filter(Boolean)
    for (const value of setCookies) {
      const pair = String(value).split(';', 1)[0]
      const index = pair.indexOf('=')
      if (index > 0) this.values.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
    }
  }
}

// ==================== 数据归一化 ====================

function normalizeFiveStar (item = {}) {
  return {
    id: String(item.id || ''),
    uuid: String(item.uuid || ''),
    item: item.item || null,
    is_up: Boolean(item.is_up),
    got_item: item.got_item || null,
    gacha_count: nonNegativeInt(item.gacha_count)
  }
}

function normalizeCard (card = {}) {
  return {
    ...card,
    gacha_id: String(card.gacha_id || ''),
    total_count: nonNegativeInt(card.total_count),
    up_count: nonNegativeInt(card.up_count)
  }
}

function recordKey (item = {}) {
  return String(item.id || item.uuid || '')
}

function nonNegativeInt (value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : 0
}

function randomHex32 () {
  let result = ''
  const chars = '0123456789abcdef'
  for (let i = 0; i < 32; i++) result += chars[Math.floor(Math.random() * 16)]
  return result
}

/** 上次 srJson 中各池五星 id 集合 */
function collectFiveStars (existing) {
  const map = {}
  if (!existing) return map
  for (const [type, records] of Object.entries(existing)) {
    map[String(type)] = Array.isArray(records)
      ? records.filter(r => r?.rank_type === '5').map(r => r)
      : []
  }
  return map
}

// ==================== srJson 读写（genshin gcLog 兼容格式） ====================

function srJsonDir (qq, uid) {
  return path.join(process.cwd(), 'data', 'srJson', String(qq), String(uid))
}

/** 读取已有 srJson（返回 {池type: 记录数组}） */
export function readSrJson (qq, uid) {
  const dir = srJsonDir(qq, uid)
  const result = {}
  if (!fs.existsSync(dir)) return null
  for (const file of fs.readdirSync(dir)) {
    const match = file.match(/^(\d+)\.json$/)
    if (!match) continue
    const type = match[1]
    try {
      const records = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      if (Array.isArray(records)) result[type] = records
    } catch {}
  }
  return result
}

/** 写入单池 srJson */
function writeSrJson (qq, uid, type, records) {
  const dir = srJsonDir(qq, uid)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${type}.json`), JSON.stringify(records, null, 2), 'utf8')
}

/** 写入一个哨兵元信息文件（标记来源），供排查 */
function writeSrJsonMetadata (qq, uid, region) {
  const dir = srJsonDir(qq, uid)
  fs.mkdirSync(dir, { recursive: true })
  try {
    fs.writeFileSync(path.join(dir, '_meta.json'), JSON.stringify({
      source: 'mihoyo_star_rail_gacha_miniapp',
      region,
      updatedAt: new Date().toISOString()
    }, null, 2), 'utf8')
  } catch {}
}

// ==================== 星铁五星 + 占位 → genshin srJson 记录 ====================

/**
 * 构造 miao 兼容的星铁抽卡记录（每池）
 * 官方接口只有五星列表+垫抽+总抽数，无每抽明细：
 *   - 已保存的五星在前（保持历史），远端五星去重后追加
 *   - 当前垫抽 = 距离最近一次五星的抽数（five_star_list 的 gacha_count 或统计口径）
 * 记录字段对齐 genshin GachaLog 渲染所需（id/uid/name/item_type/rank_type/gacha_type/time）
 * @param {object} param
 * @param {Array} param.fiveStars - 远端五星（含 gacha_count）
 * @param {number} [param.pity] - 当前垫抽
 * @param {number} [param.totalDraws] - 池总抽数
 * @param {string|number} param.uid - 星铁 UID
 * @param {number} param.type - gacha_type
 * @param {Array} [param.prevRecords] - 已保存的该池记录（含占位）
 * @returns {Array} 记录数组（五星真实 + 占位补抽数）
 */
/** 历史 srJson 五星（平铺格式：name/item_type 直接在记录上，无 item 对象）归一化为统一结构 */
function normalizeHistoricalStar (r) {
  return {
    id: String(r?.id || r?.uuid || ''),
    uuid: String(r?.uuid || ''),
    item: r?.item || { name: r?.name, item_type: r?.item_type },
    is_up: Boolean(r?.is_up),
    got_item: r?.got_item || null,
    gacha_count: nonNegativeInt(r?.gacha_count),
    time: String(r?.time || '')
  }
}

/** 判断是否为角色（兼容官方 ItemType_Avatar 与已转换的「角色」） */
function isAvatarItem (item) {
  return item?.item_type === 'ItemType_Avatar' || item?.item_type === '角色'
}

/** 五星时间：优先显式 time，否则 id 前 10 位 Unix 时间戳，最后兜底 */
function fiveStarTime (record) {
  const explicit = String(record?.time || record?.legacy_time || '')
  if (explicit) return explicit
  const seconds = String(record?.id || '').slice(0, 10)
  if (/^\d{10}$/.test(seconds)) {
    return new Date(Number(seconds) * 1000).toISOString().replace('T', ' ').slice(0, 19)
  }
  return '1970-01-01 00:00:00'
}

/** 数字/字符串混合降序（官方 id 数字随时间递增，大 = 新） */
function compareNumericTextDesc (a, b) {
  const aNum = /^\d+$/.test(a)
  const bNum = /^\d+$/.test(b)
  if (aNum && bNum) return Number(b) - Number(a)
  return String(b).localeCompare(String(a))
}

/**
 * 构造 miao 兼容的星铁抽卡记录（每池）——对齐荷花重制版 buildMiaoPoolRecords
 * 官方接口只有五星列表+垫抽+总抽数，无每抽明细：
 *   - 五星合并：以接口返回为权威（覆盖历史 gacha_count），按 id 降序 = 新在前
 *   - 开头补当前垫抽（pity），每条五星后补 (gacha_count-1) 占位（与前一条五星的间隔）
 *   - 末尾以 totalDraws 补齐总抽数
 * 记录字段对齐 genshin GachaLog 渲染所需（id/uid/name/item_type/rank_type/gacha_type/time）
 * @param {object} param
 * @param {Array} param.fiveStars - 远端五星（含 gacha_count）
 * @param {number} [param.pity] - 当前垫抽
 * @param {number} [param.totalDraws] - 池总抽数
 * @param {string|number} param.uid - 星铁 UID
 * @param {number} param.type - gacha_type
 * @param {Array} [param.prevRecords] - 已保存的该池记录（含占位）
 * @returns {Array} 记录数组（五星真实 + 占位补抽数）
 */
export function buildMiaoPoolRecords ({ fiveStars = [], pity, totalDraws, uid, type, prevRecords = [] } = {}) {
  const numericType = Number(type)
  const output = []

  // 合并历史 + 远端五星：以接口为权威（远端记录覆盖历史同名条目，保 gacha_count 正确）
  const merged = new Map()
  for (const r of Array.isArray(prevRecords) ? prevRecords : []) {
    if (r?.rank_type === '5' && r?.name && r.name !== '占位记录') {
      const norm = normalizeHistoricalStar(r)
      const key = recordKey(norm)
      if (key) merged.set(key, norm)
    }
  }
  for (const raw of fiveStars) {
    const norm = normalizeFiveStar(raw)
    const key = recordKey(norm)
    if (!key) continue
    merged.set(key, norm) // 接口权威覆盖
  }
  // 新在前（id 数值大 = 更新；非数字 uuid 保持字符串降序）
  const all = [...merged.values()].sort((a, b) => compareNumericTextDesc(recordKey(a), recordKey(b)))

  let seq = 0
  const pushFiller = (time) => {
    seq += 1
    output.push({
      id: `lotus-${numericType}-${seq}`, uid: String(uid), name: '占位记录',
      item_type: '光锥', rank_type: '3', gacha_type: String(numericType), time: time || fallbackTime
    })
  }
  const pushFillers = (count, time) => {
    for (let i = 0; i < Math.max(0, count); i++) pushFiller(time || fallbackTime)
  }

  const fallbackTime = new Date().toISOString().replace('T', ' ').slice(0, 19)

  // 开头：当前垫抽（距最近一次五星的抽数）
  pushFillers(nonNegativeInt(pity), fiveStarTime(all[0]))

  // 五星 + 该五星后与前一条五星的间隔占位（gacha_count-1）
  for (const star of all) {
    const time = fiveStarTime(star)
    output.push({
      id: String(star.id || star.uuid || `lotus-five-${numericType}-${seq}`),
      uid: String(uid),
      name: String(star.item?.name || '未知'),
      item_type: isAvatarItem(star.item) ? '角色' : '光锥',
      rank_type: '5',
      gacha_type: String(numericType),
      time,
      // 持久化 gacha_count（供下次更新从 srJson 重建间隔）
      gacha_count: nonNegativeInt(star.gacha_count)
    })
    pushFillers(Math.max(0, nonNegativeInt(star.gacha_count) - 1), time)
  }

  // 末尾：totalDraws 补齐（保证序列总条数 = 池总抽数）
  const accounted = output.length
  pushFillers(Math.max(0, nonNegativeInt(totalDraws) - accounted), fiveStarTime(all.at(-1)))
  return output
}

/** 未提供 pity 时，从最后一条占位/记录推断当前垫抽 */
function currentPity (records) {
  if (!Array.isArray(records) || !records.length) return 0
  let pity = 0
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]
    if (r?.rank_type === '5') break
    pity++
  }
  return pity
}