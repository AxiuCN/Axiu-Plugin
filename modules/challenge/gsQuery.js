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
import { setNotifyGroup } from '../../apps/ckAutoRefresh.js'
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

/** 时间戳(秒) → "MM-DD HH:mm:ss" */
function fmtTime (ts) {
  if (!ts) return '--'
  const d = new Date(ts * 1000)
  if (isNaN(d.getTime())) return '--'
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
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

/**
 * 根据 avatar_id 列表构建 avatars 映射
 * @param {number[]} ids - 角色 ID 数组
 * @param {object} infoMap - { [id]: { level?, cons? } } 从 API 数据中提取的等级/命座
 * @returns {object} { [id]: { id, name, abbr, face, gacha, star, elem, level, cons } }
 */
function buildAvatarsMap (ids, infoMap = {}) {
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
        elem: char.elem || 'anemo',
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

/**
 * 深境螺旋 API → 模板数据（匹配 miao-plugin Abyss 模型格式）
 * 保留: 角色统计(最强一击/最高承伤等)、楼层队伍卡、各间头像、楼层星数、用时
 * 去掉: 武器、圣遗物
 */
function buildAbyssData (raw) {
  // 统计段（stat 顶级变量）
  const stat = []
  const addMsg = (title, ds) => {
    if (!ds || !ds.avatar_id) return
    const char = MiaoCharacter.get(ds.avatar_id)
    if (!char) { stat.push({ title, id: ds.avatar_id, value: `${(ds.value / 10000).toFixed(1)} W` }); return }
    stat.push({ title, id: char.id, value: `${(ds.value / 10000).toFixed(1)} W` })
  }
  addMsg('最强一击', raw.damage_rank?.[0])
  addMsg('最高承伤', raw.take_damage_rank?.[0])
  for (const [key, title] of Object.entries({ defeat_rank: '最多击破', normal_skill_rank: '元素战技', energy_skill_rank: '元素爆发' })) {
    const entry = raw[key]?.[0]
    if (entry) stat.push({ title, id: entry.avatar_id || 0, value: `${entry.value} 次` })
    else stat.push({})
  }

  // abyss 对象（匹配 Abyss 模型）
  const floors = {}
  for (const f of raw.floors || []) {
    const levels = {}
    for (const l of f.levels || []) {
      const ds = { star: l.star || 0 }
      for (const b of l.battles || []) {
        const key = b.index === 1 ? 'up' : 'down'
        const time = new Date((b.timestamp || 0) * 1000)
        const pad = (n) => String(n).padStart(2, '0')
        ds[key] = {
          timestamp: b.timestamp || 0,
          time: time.getTime() ? `${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}` : '--',
          avatars: (b.avatars || []).map(a => a.id)
        }
      }
      levels[l.index] = ds
    }
    const lastIdx = Math.max(...Object.keys(levels).map(Number))
    floors[f.index] = {
      star: f.star || 0,
      index: f.index || 0,
      display: levels[lastIdx] || {},
      levels
    }
  }

  const st = new Date((raw.start_time || 0) * 1000)
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')

  return {
    uid: '',
    stat,
    abyss: {
      floors,
      schedule: st.getTime() ? `${st.getMonth() + 1}月` : '',
      total: raw.total_battle_times || 0,
      maxFloor: raw.max_floor || '',
      time: `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
      stat: {
        dmg: raw.damage_rank?.[0] ? { id: raw.damage_rank[0].avatar_id, value: raw.damage_rank[0].value } : {},
        takeDmg: raw.take_damage_rank?.[0] ? { id: raw.take_damage_rank[0].avatar_id, value: raw.take_damage_rank[0].value } : {},
        defeat: raw.defeat_rank?.[0] ? { id: raw.defeat_rank[0].avatar_id, value: raw.defeat_rank[0].value } : {},
        e: raw.normal_skill_rank?.[0] ? { id: raw.normal_skill_rank[0].avatar_id, value: raw.normal_skill_rank[0].value } : {},
        q: raw.energy_skill_rank?.[0] ? { id: raw.energy_skill_rank[0].avatar_id, value: raw.energy_skill_rank[0].value } : {}
      }
    }
  }
}

/**
 * 幻想真境剧诗 API → 模板数据
 */
function buildRoleData (raw) {
  const stat = raw.stat || {}
  const detail = raw.detail || {}

  // splendour buff summary
  function splSummary (level) {
    return {
      total_level: level || 0,
      hp_increase: (level || 0) * 800,
      atk_increase: (level || 0) * 50,
      def_increase: (level || 0) * 50,
      em_increase: (level || 0) * 20
    }
  }

  const rounds = (detail.rounds_data || []).map(r => ({
    is_get_medal: !!r.is_get_medal,
    title: r.is_tarot
      ? `圣牌挑战 ${intToRoman(r.tarot_serial_no || 1)}`
      : `第 ${r.round_id || 1} 幕`,
    finish_time: fmtTime(r.finish_time),
    enemies: (r.enemies || []).map(e => ({ icon: e.icon || '' })),
    avatars: (r.avatars || []).map(a => ({
      avatar_id: a.avatar_id,
      level: a.level || 0,
      avatar_type: a.avatar_type || 1  // 1=自己 2=试用 3=助演
    })),
    splendour_buff: {
      summary: splSummary(r.splendour_buff?.summary?.total_level || raw.splendour_buff?.summary?.total_level),
      buffs: (r.splendour_buff?.buffs || []).map(b => ({ icon: b.icon || '', level: b.level || 0 }))
    },
    choice_cards: (r.choice_cards || []).map(c => ({ icon: c.icon || '' }))
  }))

  const month = raw.schedule?.start_date_time?.month || raw.schedule?.month || new Date().getMonth() + 1

  return {
    uid: '',
    role: {
      month,
      stat: {
        difficulty_id: stat.difficulty_id || 0,
        total_use_time: stat.total_use_time || detail.fight_statisic?.total_use_time || 0,
        coin_num: stat.coin_num || 0,
        avatar_bonus_num: stat.avatar_bonus_num || 0,
        rent_cnt: stat.rent_cnt || 0,
        get_medal_round_list: stat.get_medal_round_list || []
      },
      rounds
    }
  }
}

/**
 * 幽境危战 API → 模板数据
 * @param {object} raw - 从 API 提取的当前期数据（raw = res.data 或 res.data[0]）
 * @param {string} mode - 'single' | 'mp' | 'best'
 */
function buildHardData (raw, mode) {
  // 选模式
  let modeData
  const hasSingle = raw.single?.has_data
  const hasMp = raw.mp?.has_data

  if (mode === 'single') {
    modeData = raw.single || {}
  } else if (mode === 'mp') {
    modeData = raw.mp || {}
  } else {
    // best: 比较 single 和 mp
    const calc = (d) => (d?.has_data ? (d.best?.difficulty || 0) * 1000 - (d.best?.second || 0) : 0)
    modeData = calc(raw.single) >= calc(raw.mp) ? (raw.single || {}) : (raw.mp || {})
  }

  const best = modeData.best || modeData || {}
  const challs = (best.challenge || modeData.challenge || []).map(c => ({
    name: c.name || '',
    second: c.second || 0,
    monster: {
      icon: c.monster?.icon || '',
      level: c.monster?.level || 0,
      desc: (c.monster?.desc || []).filter(d => d !== '').map(d =>
        d.replace(/<color=([^>]+)>/g, '<span style="color:$1">').replace(/<\/color>/g, '</span>')
      )
    },
    // 阵容角色
    avatars: (c.teams || []).map(t => ({
      avatar_id: t.avatar_id,
      name: t.name || '',
      level: t.level || 0,
      rarity: t.rarity || 4,
      cons: t.rank || 0   // 命座
    })),
    // 最强一击/最高总伤害
    best_avatars: (c.best_avatar || []).map(ba => ({
      avatar_id: ba.avatar_id,
      dps: ba.dps || 0
    }))
  }))

  const sched = raw.schedule || {}
  return {
    uid: '',
    hard: {
      start_time: fmtTime(sched.start_time),
      end_time: fmtTime(sched.end_time),
      best: {
        difficulty: best.difficulty || 0,
        second: best.second || 0
      },
      challs
    }
  }
}

// ==================== 主查询函数 ====================

/**
 * 深境螺旋查询
 */
export async function gsSpiralAbyssQuery (e) {
  if (!isGsEnabled()) return false

  const auth = await getGsUserAuth(e)
  if (!auth) return true
  if (e.isGroup) setNotifyGroup(auth.uid, e.group_id)

  await e.reply('正在获取深境螺旋数据，请稍后……')

  const isLast = e.msg.includes('上期')
  const scheduleType = isLast ? '2' : '1'
  const periodText = isLast ? '上期' : '本期'

  try {
    const mys = new GenshinMysApi(auth.uid, auth.ck, 'gs')
    const res = await mys.getData('spiralAbyss', { schedule_type: scheduleType })

    if (!res || res.retcode !== 0) {
      await e.reply(`暂未获得${periodText}深境螺旋数据`)
      return true
    }

    const rawData = res.data
    if (!rawData?.floors?.length) {
      await e.reply(`暂未获得${periodText}深境螺旋挑战数据`)
      return true
    }

    // 上报排行
    const scheduleId = GsChallengeRank.getScheduleId(rawData, 0)
    GsChallengeRank.report(auth.uid, e.at || e.user_id, e.group_id, 0, rawData, scheduleId)
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
    const { abyss, stat } = buildAbyssData(rawData)
    const img = await render('challenge/GS', 'abyss', { uid: auth.uid, abyss, stat, avatars })
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
  if (e.isGroup) setNotifyGroup(auth.uid, e.group_id)

  await e.reply('正在获取幻想真境剧诗数据，请稍后……')

  const isLast = e.msg.includes('上期')
  const periodText = isLast ? '上期' : '本期'

  try {
    const mys = new GenshinMysApi(auth.uid, auth.ck, 'gs')
    const res = await mys.getData('role_combat', { need_detail: true })

    if (!res || res.retcode !== 0) {
      await e.reply(`暂未获得${periodText}幻想真境剧诗数据`)
      return true
    }

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

    // 上报排行
    const scheduleId = GsChallengeRank.getScheduleId(rawData, 1)
    GsChallengeRank.report(auth.uid, e.at || e.user_id, e.group_id, 1, rawData, scheduleId)
      .catch(err => logger?.error(`${LOG_PREFIX}[原神] 剧诗上报失败:`, err?.message))

    // 收集角色 ID
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
    const avatars = buildAvatarsMap([...avatarIds], charLevels)

    // 数据变换 + 渲染
    const data = buildRoleData(rawData)
    data.uid = auth.uid
    data.periodText = periodText

    const img = await render('challenge/GS', 'role', { ...data, avatars })
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
  if (e.isGroup) setNotifyGroup(auth.uid, e.group_id)

  await e.reply('正在获取幽境危战数据，请稍后……')

  const isLast = e.msg.includes('上期')
  const periodText = isLast ? '上期' : '本期'
  const isSingle = /单人|单挑/.test(e.msg)
  const isMp = /组队|多人|合作/.test(e.msg)
  let mode = 'best'
  if (isSingle) mode = 'single'
  else if (isMp) mode = 'mp'

  try {
    const mys = new GenshinMysApi(auth.uid, auth.ck, 'gs')
    const res = await mys.getData('hard_challenge', {})

    if (!res || res.retcode !== 0) {
      await e.reply(`暂未获得${periodText}幽境危战数据`)
      return true
    }

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

    // 上报排行（单人和多人均上报，串行避免 Redis 竞态覆盖）
    const scheduleId = GsChallengeRank.getScheduleId(rawData, 2)
    if (hasSingle) {
      await GsChallengeRank.report(auth.uid, e.at || e.user_id, e.group_id, 2, rawData, scheduleId)
        .catch(err => logger?.error(`${LOG_PREFIX}[原神] 危战单人上报失败:`, err?.message))
    }
    if (hasMp) {
      await GsChallengeRank.report(auth.uid, e.at || e.user_id, e.group_id, 3, rawData, scheduleId)
        .catch(err => logger?.error(`${LOG_PREFIX}[原神] 危战多人上报失败:`, err?.message))
    }

    // 收集角色 ID（从 single 和 mp 两边均收集，避免 best 模式漏掉）
    const avatarIds = new Set()
    const charLevels = {}
    for (const modeKey of ['single', 'mp']) {
      const md = rawData[modeKey]
      if (!md?.has_data) continue
      // 与 buildHardData 保持一致的访问路径：best.challenge → challenge 兜底
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
    const avatars = buildAvatarsMap([...avatarIds], charLevels)

    // 数据变换 + 渲染
    const data = buildHardData(rawData, mode)
    data.uid = auth.uid

    const img = await render('challenge/GS', 'hard', { ...data, avatars })
    if (img) await e.reply(img)
  } catch (err) {
    logger?.error(`${LOG_PREFIX}[原神] 幽境危战查询异常:`, err?.message)
    await e.reply('幽境危战数据获取失败')
  }

  return true
}
