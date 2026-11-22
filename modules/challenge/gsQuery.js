/**
 * 原神终局挑战查询 — 完整自实现（无武器圣遗物）
 *
 * 像 srQuery.js 一样，在 Axiu-Plugin 内一次 API 调用完成：
 *   获取 auth → 调 API → 上报排行 → 数据变换 → render HTML → reply → return true
 *
 * 保留角色头像/名称显示，去掉了武器/圣遗物展示。
 * 角色头像资源引用自 miao-plugin。
 */

import GenshinMysApi from '../../../genshin/model/mys/mysApi.js'
import GsChallengeRank from '../../model/gsChallengeRank.js'
import { render } from '../../components/render.js'
import { LOG_PREFIX } from '../../components/constants.js'
import { getPluginConfig } from '../../components/config.js'
import MiaoCharacter from '../../../miao-plugin/models/Character.js'
import path from 'node:path'
import fs from 'node:fs'

// ==================== 工具 ====================

/** 阿拉伯数字 → 罗马数字（I-XXX） */
function intToRoman (num) {
  if (num < 1 || num > 3999) return String(num)
  const thousands = ['', 'M', 'MM', 'MMM']
  const hundreds = ['', 'C', 'CC', 'CCC', 'CD', 'D', 'DC', 'DCC', 'DCCC', 'CM']
  const tens = ['', 'X', 'XX', 'XXX', 'XL', 'L', 'LX', 'LXX', 'LXXX', 'XC']
  const ones = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX']
  return thousands[Math.floor(num / 1000)] +
         hundreds[Math.floor((num % 1000) / 100)] +
         tens[Math.floor((num % 100) / 10)] +
         ones[num % 10]
}

/** 时间戳(秒) → "M月" */
function fmtMonth (ts) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  if (isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}月`
}

// ==================== 配置检查 ====================

function isGsEnabled () {
  try { return getPluginConfig()?.gsAbyss?.enabled !== false } catch { return true }
}

/** 排行榜总开关：`gsAbyssRank.enabled=false` = 整条上报链路关闭（配置注释承诺「关闭后不上报」） */
function isGsRankEnabled () {
  try { return getPluginConfig()?.gsAbyssRank?.enabled !== false } catch { return true }
}

/**
 * 排行上报守卫：总开关开启，且仅群聊且群开关开启（status=1）时上报
 * 私聊查询不上报；群开关关闭 = 退出参与排行（不再静默采数）
 * @returns {Promise<void>}
 */
export async function reportGsIfEnabled (e, uid, challengeType, rawData, scheduleId, isCurrent, label) {
  if (!isGsRankEnabled()) return
  if (!e?.isGroup) return
  try {
    const cfg = (await GsChallengeRank.getGroupCfg(e.group_id)) || { status: 1 }
    if (cfg?.status === 0) return
  } catch { /* 群配置读取失败时默认上报 */ }
  await GsChallengeRank.report(uid, e.at || e.user_id, e.group_id, challengeType, rawData, scheduleId, isCurrent)
    .catch(err => logger?.error(`${LOG_PREFIX}[原神] ${label}上报失败:`, err?.message))
}

// ==================== Auth 获取 ====================

/**
 * 获取原神 uid + cookie
 * @returns {Promise<{uid:string, cookie:string}|null>}
 */
async function getGsUserAuth (e) {
  let uid = e.uid
  if (!uid || !/^[1-9]\d{8}$/.test(uid)) {
    const msgMatch = e.msg.match(/\d{9,10}/)
    if (msgMatch) uid = msgMatch[0]
  }
  if (!uid) {
    try {
      const MysInfo = (await import('../../../genshin/model/mys/mysInfo.js')).default
      const info = await MysInfo.getUid(e, true)
      if (info) uid = info
    } catch {}
  }
  if (!uid) {
    await e.reply('未绑定原神UID，请先绑定账号后重试')
    return null
  }

  try {
    const MysInfo = (await import('../../../genshin/model/mys/mysInfo.js')).default
    const result = await MysInfo.checkUidBing(uid, 'gs')
    if (result?.ck) return { uid, ck: result.ck }
  } catch {}
  await e.reply('尚未绑定Cookie，请发送 #扫码登录 绑定账号后重试')
  return null
}

// ==================== 角色头像映射（miao-plugin 本地图片） ====================
const MIAO_RESOURCE = path.resolve('plugins/miao-plugin/resources')

/**
 * 从 miao-plugin 本地读取角色图片并转为 base64 data URI
 * @param {string} relPath - char.face 或 char.gacha 返回的相对路径
 * @returns {string} data URI 或空字符串（兜底时用 Enka CDN）
 */
function readCharImg (relPath) {
  if (!relPath) return ''
  try {
    const buf = fs.readFileSync(path.join(MIAO_RESOURCE, relPath))
    return `data:image/webp;base64,${buf.toString('base64')}`
  } catch {
    return ''
  }
}

/** 元素图标文件名（剧诗角色卡左上角），资源在 resources/challenge/GS/images */
const ELEM_ICON = {
  anemo: 'elemicon-anemo.png',
  geo: 'elemicon-geo.png',
  electro: 'elemicon-electro.png',
  dendro: 'elemicon-dendro.png',
  hydro: 'elemicon-hydro.png',
  pyro: 'elemicon-pyro.png',
  cryo: 'elemicon-cryo.png'
}

/**
 * 根据 avatar_id 列表构建 avatars 映射
 * @param {number[]} ids - 角色 ID 数组
 * @param {object} infoMap - { [id]: { level?, cons? } } 从 API 数据中提取的等级/命座
 * @returns {object} { [id]: { id, name, abbr, face, gacha, star, elem, level, cons } }
 */
function buildAvatarsMap (ids, infoMap = {}) {
  // 官方稀有度底图（gt-avatar 的 star-bg）：4★ / 5★
const STAR_BG = {
  4: 'roleStarBg4.7a6c5841.png',
  5: 'roleStarBg5.1ff411a0.png'
}

const ret = {}
  if (!ids || !ids.length) return ret
  const seen = new Set()
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    try {
      const char = MiaoCharacter.get(id)
      if (!char) continue
      const info = infoMap[id] || {}
      const faceRel = char.face
      const gachaRel = char.gacha
      let faceUrl = readCharImg(faceRel)
      let gachaUrl = readCharImg(gachaRel)
      // 兜底 Enka CDN
      if (!faceUrl) {
        faceUrl = `https://enka.network/ui/UI_AvatarIcon_${char.id}.png`
      }
      ret[id] = {
        id: char.id,
        name: char.name,
        abbr: char.abbr,
        face: faceUrl,
        gacha: gachaUrl || faceUrl,
        star: char.star || 4,
        starBg: STAR_BG[char.star || 4] || STAR_BG[4],
        elem: char.elem || 'anemo',
        elemIcon: ELEM_ICON[char.elem] || '',
        level: info.level || 0,
        cons: info.cons || 0
      }
    } catch (e) {
      // 角色未识别，跳过
    }
  }
  return ret
}

// ==================== 数据变换 ====================

/** 深境螺旋：挑战回顾右栏的五项统计，顺序与标题对齐米游社 */
const ABYSS_STAT_DEFS = [
  ['defeat_rank', '最多击破数'],
  ['take_damage_rank', '承受最多伤害'],
  ['normal_skill_rank', '元素战技施放数'],
  ['damage_rank', '最强一击'],
  ['energy_skill_rank', '元素爆发次数']
]

/** 楼层中文数字（深境螺旋第 X 层） */
const FLOOR_CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五']

/** 时间戳(秒) → "YYYY.MM.DD HH:mm:ss"，无效时间返回 '-' */
function fmtDatetime (ts) {
  if (!ts) return '-'
  const d = new Date(ts * 1000)
  if (isNaN(d.getTime())) return '-'
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 时间戳(秒) → "YYYY.MM.DD"，无效时间返回 '' */
function fmtDay (ts) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  if (isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`
}

/**
 * 深境螺旋 API → 模板数据（版式对齐米游社「深境螺旋战绩」）
 * 结构：挑战回顾（最深抵达/战斗次数/获取星数/出战次数 + 五项统计）+ 全部楼层卡（高层→低层）
 * 不展示武器、圣遗物
 * @param {object} raw - spiralAbyss 接口 data
 * @param {object} avatars - buildAvatarsMap 的结果，用于取头像与稀有度
 */
function buildAbyssData (raw, avatars = {}) {
  // 五项统计：数字保持接口原值（米游社同样不折算万）
  const stats = ABYSS_STAT_DEFS.map(([key, title]) => {
    const ds = raw[key]?.[0]
    const id = ds?.avatar_id || 0
    return {
      title,
      id,
      icon: avatars[id]?.face || ds?.avatar_icon || '',
      value: ds?.value ?? '-'
    }
  })

  // 出战次数：接口直接给 reveal_rank（含 value 与 rarity），最多显示 4 个
  const reveal = (raw.reveal_rank || []).slice(0, 4).map((it) => ({
    id: it.avatar_id,
    star: it.rarity || avatars[it.avatar_id]?.star || 5,
    value: it.value ?? '-'
  }))

  // 楼层卡：全部有记录的楼层，展示顺序由高层到低层（间内仍按第 1/2/3 间升序）
  const floors = [...(raw.floors || [])]
    .sort((a, b) => b.index - a.index)
    .map((floor) => {
      const rooms = (floor.levels || []).map((l) => {
        const battles = l.battles || []
        const pick = (n) => battles.find(b => b.index === n)?.avatars?.map(a => a.id) || []
        const star = l.star || 0
        return {
          index: l.index,
          star,
          max_star: 3,
          // 三颗星逐个标记亮/暗，模板不做算术
          starList: [0, 1, 2].map(i => i < star),
          time: fmtDatetime(battles[0]?.timestamp),
          up: pick(1),
          down: pick(2)
        }
      })
      return {
        index: floor.index,
        cn: FLOOR_CN[floor.index] || String(floor.index),
        star: floor.star || 0,
        max_star: 9,
        // 楼层底图按 1-8 / 9-11 / 12+ 三套（同官方）
        bgClass: floor.index <= 8 ? 'bg-1' : (floor.index <= 11 ? 'bg-2' : 'bg-3'),
        rooms
      }
    })

  const start = new Date((raw.start_time || 0) * 1000)
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')

  return {
    uid: '',
    abyss: {
      period: raw.start_time && raw.end_time ? `${fmtDay(raw.start_time)}-${fmtDay(raw.end_time)}` : '',
      schedule: start.getTime() ? `${start.getMonth() + 1}月` : '',
      total: raw.total_battle_times || 0,
      maxFloor: raw.max_floor || '',
      total_star: raw.total_star || 0,
      reveal,
      stats,
      floors,
      time: `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    }
  }
}

/** 剧诗难度名（difficulty_id → 文案，同官方 DIFFICULTY_ID_NAME） */
const ROLE_DIFFICULTY = { 1: '简单', 2: '普通', 3: '困难', 4: '卓越', 5: '月谕' }

/** 剧诗档期时间对象 {year, month, day} → "YYYY.MM.DD"，缺字段返回 '' */
function scheduleDay (t) {
  if (!t || !t.year || !t.month) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${t.year}.${pad(t.month)}.${pad(t.day || 1)}`
}

/**
 * 幻想真境剧诗 API → 模板数据（版式对齐米游社「演出回顾」）
 * 结构：演出回顾（最佳记录 / 星章 / 幻剧之花 / 声援 / 支援）+ 战斗统计 + 逐幕详情
 */
function buildRoleData (raw) {
  const stat = raw.stat || {}
  const detail = raw.detail || {}
  const detailStat = detail.detail_stat || {}
  const fightStat = detail.fight_statisic || {}
  const roundsData = detail.rounds_data || []

  const rounds = roundsData.map((r) => ({
    medal: !!r.is_get_medal,
    title: r.is_tarot ? `圣牌挑战 ${intToRoman(r.tarot_serial_no || 1)}` : `第 ${r.round_id || 1} 幕`,
    time: fmtDatetime(r.finish_time),
    // 敌人接口只给图标，没有名称
    enemies: (r.enemies || []).map(e => e.icon).filter(Boolean),
    team: (r.avatars || []).map((a) => {
      const type = a.avatar_type || 1 // 1=自己 2=试用 3=助演
      return {
        id: a.avatar_id,
        level: a.level || 0,
        type,
        // 接口会带角色卡立绘（米游社出图就是用它），缺失时模板回落 face
        image: a.image || '',
        tag: type === 2 ? '试用' : (type === 3 ? '助演' : '')
      }
    }),
    buffLevel: r.splendour_buff?.summary?.total_level || raw.splendour_buff?.summary?.total_level || 0,
    buffs: (r.splendour_buff?.buffs || []).map(b => ({ icon: b.icon || '', level: b.level || 0 })),
    choices: (r.choice_cards || []).map(c => ({ icon: c.icon || '' })).filter(c => c.icon)
  }))

  // 战斗统计（接口开关打开才展示），数值保留原值
  const fightStats = []
  const pushFight = (title, ds) => {
    if (!ds || !ds.avatar_id) return
    fightStats.push({ title, id: ds.avatar_id, value: ds.value ?? '-' })
  }
  if (fightStat.is_show_battle_stats) {
    pushFight('最高伤害输出', fightStat.max_damage_avatar)
    pushFight('击败最多敌人', fightStat.max_defeat_avatar)
    pushFight('最高承受伤害', fightStat.max_take_damage_avatar)
  }

  // 演出总时长：秒 → "X分钟Y秒"（同官方）
  const useTime = Number(fightStat.total_use_time) || 0
  const totalUseTime = useTime > 0 ? `${Math.floor(useTime / 60)}分钟${useTime % 60}秒` : ''

  const start = scheduleDay(raw.schedule?.start_date_time)
  const end = scheduleDay(raw.schedule?.end_date_time)
  const maxRound = stat.max_round_id || 0
  const tarot = stat.tarot_finished_cnt || 0
  const difficultyId = Number(stat.difficulty_id || detailStat.difficulty_id || 0)
  // 星章进度：接口给了 medal_num 就用它，否则按「已获星章的幕数 / 总幕数」算
  const medalGot = Number.isFinite(Number(detailStat.medal_num))
    ? Number(detailStat.medal_num)
    : roundsData.filter(r => r.is_get_medal).length
  const medalTotal = Number(detailStat.medal_total) || roundsData.length

  return {
    uid: '',
    role: {
      // 档期起止接口都返回，不再用「N月」兜底
      period: start && end ? `${start}-${end}` : '',
      difficulty: ROLE_DIFFICULTY[difficultyId] ? `${ROLE_DIFFICULTY[difficultyId]}模式` : '',
      difficultyId,
      heraldry: Math.min(Math.max(Number(stat.heraldry ?? detailStat.heraldry) || 0, 0), 6),
      medalStat: medalTotal > 0 ? `${medalGot}/${medalTotal}` : '',
      totalUseTime,
      best: {
        round: maxRound,
        tarot,
        total: maxRound + tarot
      },
      stat: {
        coin: stat.coin_num || 0,
        bonus: stat.avatar_bonus_num || 0,
        rent: stat.rent_cnt || 0,
        // 本次消耗幻剧之花（战斗统计卡最后一行）
        totalCoin: stat.total_coin_consumed?.value ?? stat.coin_num ?? '-'
      },
      medals: (stat.get_medal_round_list || []).slice(0, 10).map(v => v === 1),
      // 第 11 颗起是圣牌星章，与各幕星章之间画一条分隔线
      tarotMedals: (stat.get_medal_round_list || []).slice(10).map(v => v === 1),
      fightStats,
      fastest: (fightStat.shortest_avatar_list || []).map(a => a.avatar_id).filter(Boolean),
      rounds
    }
  }
}

/** 危战难度名（difficulty_id → 文案） */
const HARD_DIFFICULTY = { 1: '普通', 2: '进阶', 3: '困难', 4: '险恶', 5: '无畏', 6: '绝境' }

/**
 * 幽境危战 API → 模板数据（版式对齐米游社「幽境危战」页）
 * @param {object} raw - 从 API 提取的当前期数据（raw = res.data 或 res.data[0]）
 * @param {string} mode - 'single' | 'mp' | 'best'
 */
function buildHardData (raw, mode) {
  const hasSingle = raw.single?.has_data
  const hasMp = raw.mp?.has_data
  const calc = (d) => (d?.has_data ? (d.best?.difficulty || 0) * 1000 - (d.best?.second || 0) : 0)

  // 选模式：单/多人；best 取成绩更好的一侧
  let mdKey = 'single'
  if (mode === 'mp') mdKey = 'mp'
  else if (mode === 'best') mdKey = calc(raw.mp) > calc(raw.single) ? 'mp' : 'single'
  const md = raw[mdKey] || {}

  const best = md.best || {}
  const challenge = best.challenge || md.challenge || []
  const bosses = challenge.map((c) => {
    const bas = c.best_avatar || []
    // 接口用 type 区分：1=最强一击，2=最高总伤害；缺 type 时按顺序兜底
    const byType = (t) => {
      const hit = bas.find(b => Number(b.type) === t)
      return hit ? { id: hit.avatar_id, dps: hit.dps ?? 0 } : null
    }
    return {
      name: c.name || '',
      second: c.second || 0,
      monster: { icon: c.monster?.icon || '', level: c.monster?.level || 0 },
      team: (c.teams || []).map(t => ({ id: t.avatar_id, level: t.level || 0, cons: t.rank || 0 })),
      topHit: byType(1) || (bas[0] ? { id: bas[0].avatar_id, dps: bas[0].dps ?? 0 } : null),
      topTotal: byType(2) || (bas[1] ? { id: bas[1].avatar_id, dps: bas[1].dps ?? 0 } : null)
    }
  })

  const sched = raw.schedule || {}
  const difficulty = best.difficulty || 0
  const second = best.second || 0
  // 难度徽章：6 档 180 秒内用 vi_plus，其余按档位取
  let medal = ''
  // 官方勋章：difficulty → medal_i..vi，六档 180 秒内用 vi_plus
  const MEDAL_FILE = {
    1: 'medal_i.af3dcf06.png',
    2: 'medal_ii.9b87164a.png',
    3: 'medal_iii.733d64af.png',
    4: 'medal_iv.3b112633.png',
    5: 'medal_v.0cd07c5d.png',
    6: 'medal_vi.cba7750d.png',
    '6_1': 'medal_vi_plus.2f4f73d2.png'
  }
  if (difficulty === 6) medal = second > 0 && second <= 180 ? MEDAL_FILE['6_1'] : MEDAL_FILE[6]
  else if (difficulty >= 1 && difficulty <= 5) medal = MEDAL_FILE[difficulty]

  // 赋光之人：官方取自当前期条目的 blings[]（is_plus=true 的为赋光）；
  // 部分接口版本不带 blings，回落到顶层 avatars[].is_plus
  // 官方把 blings 分成两段渲染：
  //   hard_challenge_plus    「为以下角色赋予了「恒昼辉光」」→ is_plus === true
  //   hard_challenge_no_plus 「为以下角色赋予了「辉光」」    → is_plus === false
  const plusIds = []
  const noPlusIds = []
  for (const b of (raw.blings || [])) {
    if (!b?.avatar_id) continue
    if (b.is_plus) plusIds.push(b.avatar_id)
    else noPlusIds.push(b.avatar_id)
  }
  // 部分接口版本不带 blings，回落到顶层 avatars[].is_plus
  if (!plusIds.length && !noPlusIds.length) {
    for (const a of (raw.avatars || md.avatars || [])) {
      if (!a?.avatar_id) continue
      if (a.is_plus) plusIds.push(a.avatar_id)
      else noPlusIds.push(a.avatar_id)
    }
  }
  const plus = [...new Set(plusIds)]
  const noPlus = [...new Set(noPlusIds)]

  return {
    uid: '',
    hard: {
      period: sched.start_time && sched.end_time ? `${fmtDay(sched.start_time)}-${fmtDay(sched.end_time)}` : '',
      mode: mdKey,
      modeLabel: mdKey === 'mp' ? '多人模式' : '单人模式',
      difficulty,
      difficultyName: HARD_DIFFICULTY[difficulty] || '',
      second,
      medal,
      plus,
      noPlus,
      bosses
    }
  }
}

// ==================== 过码处理 ====================

/**
 * 校验 API 返回码，遇到验证码时委托 mys.req.err handler 过码
 * 参考 miao-plugin MysApi.getData() → mysInfo.checkCode() 链路
 * @returns {Promise<object|false>} 处理后的 res，false 表示已回复错误消息
 */
async function checkGsCode (e, res, type, mys, data = {}) {
  if (!res) {
    await e.reply('米游社接口请求失败，暂时无法查询')
    return false
  }

  res.retcode = Number(res.retcode)

  switch (res.retcode) {
    case 0:
      break
    case 10102:
      if (res.message === 'Data is not public for the user') {
        await e.reply('米游社数据未公开，请前往米游社/原神设置中公开数据')
      } else {
        await e.reply('请先去米游社绑定角色')
      }
      break
    case 10041:
    case 5003:
      await e.reply('米游社账号异常，暂时无法查询')
      break
    case 1034:
    case 10035: {
      const handler = e.runtime?.handler || {}
      if (handler.has('mys.req.err')) {
        logger.mark(`[Axiu-Plugin][原神] 遇到验证码，调用过码 handler`)
        res = await handler.call('mys.req.err', e, { mysApi: mys, type, res, data }) || res
      }
      if (!res || res?.retcode === 1034 || res?.retcode === 10035) {
        await e.reply('米游社查询遇到验证码，请稍后再试')
      }
      break
    }
    default:
      if (/(登录|login)/i.test(res.message)) {
        await e.reply('米游社cookie已失效，请发送 #扫码登录 重新绑定')
      } else {
        await e.reply(`米游社接口报错，暂时无法查询：${res.message || 'error'}`)
      }
      break
  }

  if (res && res.retcode !== 0) {
    logger.mark(`[Axiu-Plugin][原神] 接口报错 — ${JSON.stringify(res)}，UID：${mys.uid}`)
  }
  return res
}

// ==================== 主查询函数 ====================

/**
 * 深境螺旋查询
 */
export async function gsSpiralAbyssQuery (e) {
  if (!isGsEnabled()) return false

  const auth = await getGsUserAuth(e)
  if (!auth) return true

  await e.reply('正在获取深境螺旋数据，请稍后……')

  const isLast = e.msg.includes('上期')
  const scheduleType = isLast ? '2' : '1'
  const periodText = isLast ? '上期' : '本期'

  try {
    const mys = new GenshinMysApi(auth.uid, auth.ck, { game: 'gs', log: false })
    let res = await mys.getData('spiralAbyss', { schedule_type: scheduleType })
    res = await checkGsCode(e, res, 'spiralAbyss', mys, { schedule_type: scheduleType })
    if (!res || res.retcode !== 0) return true

    const rawData = res.data
    if (!rawData?.floors?.length) {
      await e.reply(`暂未获得${periodText}深境螺旋挑战数据`)
      return true
    }

    // 上报排行（仅群聊且群开关开启时上报；上期查询不更新 current 指针，避免覆盖本期）
    const scheduleId = GsChallengeRank.getScheduleId(rawData, 0)
    await reportGsIfEnabled(e, auth.uid, 0, rawData, scheduleId, !isLast, '深渊')
      .catch(err => logger?.error(`${LOG_PREFIX}[原神] 深渊上报失败:`, err?.message))

    // 收集所有角色 ID（排行统计 + 各间出战）
    const avatarIds = new Set()
    for (const key of ['damage_rank', 'defeat_rank', 'take_damage_rank', 'normal_skill_rank', 'energy_skill_rank']) {
      if (rawData[key]?.[0]?.avatar_id) avatarIds.add(rawData[key][0].avatar_id)
    }
    for (const f of rawData.floors || []) {
      for (const l of f.levels || []) {
        for (const b of l.battles || []) {
          for (const a of b.avatars || []) {
            if (a.id) avatarIds.add(a.id)
          }
        }
      }
    }
    const charLevels = {}
    for (const f of rawData.floors || []) {
      for (const l of f.levels || []) {
        for (const b of l.battles || []) {
          for (const a of b.avatars || []) {
            if (a.id && a.level) charLevels[a.id] = { level: a.level }
          }
        }
      }
    }
    const avatars = buildAvatarsMap([...avatarIds], charLevels)

    // 数据变换 + 渲染
    const { abyss } = buildAbyssData(rawData, avatars)
    const nickname = e.sender?.card || e.sender?.nickname || ''
    const img = await render('challenge/GS', 'abyss', { uid: auth.uid, nickname, abyss, avatars })
    if (img) await e.reply(img)
  } catch (err) {
    logger?.error(`${LOG_PREFIX}[原神] 深境螺旋查询异常:`, err?.message)
    await e.reply('深境螺旋数据获取失败')
  }

  return true
}

/**
 * 幻想真境剧诗查询
 */
export async function gsRoleCombatQuery (e) {
  if (!isGsEnabled()) return false

  const auth = await getGsUserAuth(e)
  if (!auth) return true

  await e.reply('正在获取幻想真境剧诗数据，请稍后……')

  const isLast = e.msg.includes('上期')
  const periodText = isLast ? '上期' : '本期'

  try {
    const mys = new GenshinMysApi(auth.uid, auth.ck, { game: 'gs', log: false })
    let res = await mys.getData('role_combat', { need_detail: true })
    res = await checkGsCode(e, res, 'role_combat', mys, { need_detail: true })
    if (!res || res.retcode !== 0) return true

    // role_combat 返回 { data: [{current}, {previous}] } 结构
    let rawData = res.data
    if (rawData && Array.isArray(rawData.data)) {
      rawData = isLast ? rawData.data[1] : rawData.data[0]
    } else if (Array.isArray(rawData)) {
      rawData = isLast ? rawData[1] : rawData[0]
    }
    if (!rawData || !rawData.has_detail_data) {
      await e.reply(`暂未获得${periodText}幻想真境剧诗挑战数据`)
      return true
    }

    // 上报排行（仅群聊且群开关开启时上报；上期查询不更新 current 指针，避免覆盖本期）
    const scheduleId = GsChallengeRank.getScheduleId(rawData, 1)
    await reportGsIfEnabled(e, auth.uid, 1, rawData, scheduleId, !isLast, '剧诗')
      .catch(err => logger?.error(`${LOG_PREFIX}[原神] 剧诗上报失败:`, err?.message))

    // 收集角色 ID（含 fight_statisic 中的统计角色）
    const avatarIds = new Set()
    const charLevels = {}
    for (const r of rawData.detail?.rounds_data || []) {
      for (const a of r.avatars || []) {
        if (a.avatar_id) {
          avatarIds.add(a.avatar_id)
          charLevels[a.avatar_id] = { level: a.level || 0, cons: 0 }
        }
      }
    }
    const fs = rawData.detail?.fight_statisic || {}
    for (const key of ['max_damage_avatar', 'max_defeat_avatar', 'max_take_damage_avatar']) {
      const aid = fs[key]?.avatar_id
      if (aid) { avatarIds.add(aid); if (!charLevels[aid]) charLevels[aid] = { level: 0, cons: 0 } }
    }
    for (const a of (fs.shortest_avatar_list || [])) {
      const aid = a.avatar_id
      if (aid) { avatarIds.add(aid); if (!charLevels[aid]) charLevels[aid] = { level: 0, cons: 0 } }
    }
    const avatars = buildAvatarsMap([...avatarIds], charLevels)

    // 数据变换 + 渲染
    const nickname = e.sender?.card || e.sender?.nickname || ''
    const img = await render('challenge/GS', 'role', { ...buildRoleData(rawData), uid: auth.uid, nickname, avatars })
    if (img) await e.reply(img)
  } catch (err) {
    logger?.error(`${LOG_PREFIX}[原神] 幻想真境剧诗查询异常:`, err?.message)
    await e.reply('幻想真境剧诗数据获取失败')
  }

  return true
}

/**
 * 幽境危战查询
 */
export async function gsHardChallengeQuery (e) {
  if (!isGsEnabled()) return false

  const auth = await getGsUserAuth(e)
  if (!auth) return true

  await e.reply('正在获取幽境危战数据，请稍后……')

  const isLast = e.msg.includes('上期')
  const periodText = isLast ? '上期' : '本期'
  const isSingle = /单人|单挑/.test(e.msg)
  const isMp = /组队|多人|合作/.test(e.msg)
  const isBest = /最佳/.test(e.msg)
  let mode = 'single'
  if (isBest) mode = 'best'
  else if (isSingle) mode = 'single'
  else if (isMp) mode = 'mp'

  try {
    const mys = new GenshinMysApi(auth.uid, auth.ck, { game: 'gs', log: false })
    // 注意：need_detail 由 apiTool 的 hard_challenge url 模板固定携带，这里不要再传
    let res = await mys.getData('hard_challenge', {})
    res = await checkGsCode(e, res, 'hard_challenge', mys, {})
    if (!res || res.retcode !== 0) return true

    // hard_challenge 返回 { data: [{current}, {previous}] } 结构
    let rawData = res.data
    if (rawData && Array.isArray(rawData.data)) {
      rawData = isLast ? rawData.data[1] : rawData.data[0]
    } else if (Array.isArray(rawData)) {
      rawData = isLast ? rawData[1] : rawData[0]
    }
    if (!rawData) {
      await e.reply(`暂未获得${periodText}幽境危战挑战数据`)
      return true
    }

    // 检查是否有数据
    const hasSingle = rawData.single?.has_data
    const hasMp = rawData.mp?.has_data
    if (!hasSingle && !hasMp) {
      await e.reply(`暂未获得${periodText}幽境危战挑战数据`)
      return true
    }

    // 上报排行（单人和多人均上报，串行避免 Redis 竞态覆盖；上期查询不更新 current 指针）
    // 仅群聊且群开关开启时上报（关闭=退出参与，不再静默采数；私聊不上报）
    const scheduleId = GsChallengeRank.getScheduleId(rawData, 2)
    if (hasSingle) {
      await reportGsIfEnabled(e, auth.uid, 2, rawData, scheduleId, !isLast, '危战单人')
        .catch(err => logger?.error(`${LOG_PREFIX}[原神] 危战单人上报失败:`, err?.message))
    }
    if (hasMp) {
      await reportGsIfEnabled(e, auth.uid, 3, rawData, scheduleId, !isLast, '危战多人')
        .catch(err => logger?.error(`${LOG_PREFIX}[原神] 危战多人上报失败:`, err?.message))
    }

    // 收集角色 ID（只从当前 mode 收集，避免单人与多人命座覆盖）
    const avatarIds = new Set()
    const charLevels = {}
    const bestCalc = (d) => (d?.has_data ? (d.best?.difficulty || 0) * 1000 - (d.best?.second || 0) : 0)
    let mdKey = 'single'
    if (mode === 'mp') mdKey = 'mp'
    else if (mode === 'best') mdKey = bestCalc(rawData.mp) > bestCalc(rawData.single) ? 'mp' : 'single'
    const md = rawData[mdKey]
    if (md?.has_data) {
      const challs = md.best?.challenge || md.challenge || []
      for (const c of challs) {
        for (const t of c.teams || []) {
          if (t.avatar_id) {
            avatarIds.add(t.avatar_id)
            charLevels[t.avatar_id] = { level: t.level || 0, cons: t.rank || 0 }
          }
        }
        for (const ba of c.best_avatar || []) {
          if (ba.avatar_id) avatarIds.add(ba.avatar_id)
        }
      }
    }
    // 赋光之人（blings 里 is_plus，缺省回落 avatars）也要有头像
    for (const b of (rawData.blings || [])) {
      if (b?.avatar_id) avatarIds.add(b.avatar_id)
    }
    for (const a of (rawData.avatars || [])) {
      if (a?.is_plus && a.avatar_id) avatarIds.add(a.avatar_id)
    }
    const avatars = buildAvatarsMap([...avatarIds], charLevels)

    // 数据变换 + 渲染
    const nickname = e.sender?.card || e.sender?.nickname || ''
    const img = await render('challenge/GS', 'hard', { ...buildHardData(rawData, mode), uid: auth.uid, nickname, avatars })
    if (img) await e.reply(img)
  } catch (err) {
    logger?.error(`${LOG_PREFIX}[原神] 幽境危战查询异常:`, err?.message)
    await e.reply('幽境危战数据获取失败')
  }

  return true
}
