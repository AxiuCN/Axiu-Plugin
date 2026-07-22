/**
 * 原神终局挑战查询 — 完整自实现（无角色武器圣遗物）
 *
 * 像 srQuery.js 一样，在 Axiu-Plugin 内一次 API 调用完成：
 *   获取 auth → 调 API → 上报排行 → 数据变换 → render HTML → reply → return true
 *
 * 去掉了角色/武器/圣遗物展示，保留：深渊Floor/Level、剧诗勋章/Buff/神秘收获、危战怪物信息
 */

import GenshinMysApi from '../../../genshin/model/mys/mysApi.js'
import GsChallengeRank from '../../model/gsChallengeRank.js'
import { render } from '../../components/render.js'
import { LOG_PREFIX } from '../../components/constants.js'
import { getPluginConfig } from '../../components/config.js'

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

// ==================== 数据变换 ====================

/**
 * 深境螺旋 API → 模板数据
 */
function buildAbyssData (raw) {
  const abyss = { schedule: '', total: 0, floors: [] }

  if (raw.start_time) abyss.schedule = fmtMonth(raw.start_time)
  abyss.total = raw.total_battle_times || 0

  const rawFloors = raw.floors || []
  for (const f of rawFloors) {
    const levels = (f.levels || []).map(l => ({
      star: l.star || 0,
      battles: (l.battles || []).map(b => ({ time: fmtTime(b.timestamp) }))
    }))
    abyss.floors.push({ index: f.index || 0, star: f.star || 0, levels })
  }

  return { uid: '', abyss }
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
    }
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

    // 数据变换 + 渲染
    const data = buildAbyssData(rawData)
    data.uid = auth.uid
    data.periodText = periodText

    const img = await render('challenge/GS', 'abyss', data)
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
    const mys = new GenshinMysApi(auth.uid, auth.ck, 'gs')
    const res = await mys.getData('role_combat', { need_detail: true })

    if (!res || res.retcode !== 0) {
      await e.reply(`暂未获得${periodText}幻想真境剧诗数据`)
      return true
    }

    // role_combat / hard_challenge 返回数组 [当前期, 上期]
    let rawData = res.data
    if (Array.isArray(rawData)) {
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

    // 数据变换 + 渲染
    const data = buildRoleData(rawData)
    data.uid = auth.uid
    data.periodText = periodText

    const img = await render('challenge/GS', 'role', data)
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

    // hard_challenge 返回数组 [当前期, 上期]
    let rawData = res.data
    if (Array.isArray(rawData)) {
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

    // 上报排行（单人和多人均上报）
    const scheduleId = GsChallengeRank.getScheduleId(rawData, 2)
    if (hasSingle) {
      GsChallengeRank.report(auth.uid, e.at || e.user_id, e.group_id, 2, rawData, scheduleId)
        .catch(err => logger?.error(`${LOG_PREFIX}[原神] 危战单人上报失败:`, err?.message))
    }
    if (hasMp) {
      GsChallengeRank.report(auth.uid, e.at || e.user_id, e.group_id, 3, rawData, scheduleId)
        .catch(err => logger?.error(`${LOG_PREFIX}[原神] 危战多人上报失败:`, err?.message))
    }

    // 数据变换 + 渲染
    const data = buildHardData(rawData, mode)
    data.uid = auth.uid
    data.periodText = periodText

    const img = await render('challenge/GS', 'hard', data)
    if (img) await e.reply(img)
  } catch (err) {
    logger?.error(`${LOG_PREFIX}[原神] 幽境危战查询异常:`, err?.message)
    await e.reply('幽境危战数据获取失败')
  }

  return true
}
