/**
 * 原神终局挑战排行 — 业务逻辑模块
 *
 * 供 apps/challenge.js 引用，避免入口文件过大
 */

import GsChallengeRank from '../../model/gsChallengeRank.js'
import { getPluginConfig } from '../../components/config.js'
import { render } from '../../components/render.js'

/** 真境幻想剧诗模式名称 */
export const MODE_NAMES = { 1: '轻简', 2: '普通', 3: '困难', 4: '卓越', 5: '月谕' }

/** 幽境危战难度名称 */
export const DIFF_NAMES = { 1: '普通', 2: '进阶', 3: '困难', 4: '险恶', 5: '无畏', 6: '绝境' }

/** 幽境危战徽章名称 */
export const BADGE_NAMES = { 1: '普通', 2: '进阶', 3: '困难', 4: '险恶', 5: '无畏', 6: '绝境', 7: '虹彩' }

/** 关键词 → challengeType */
export function resolveGsType (text) {
  if (/深境|深渊/.test(text)) return 0
  if (/幻想|剧诗/.test(text)) return 1
  if (/幽境|危战/.test(text)) return 2
  return -1
}

/** 构造排行多列展示数据 */
export function buildGsCols (extra, challengeType) {
  switch (challengeType) {
    case 0: // 深境螺旋: 层 | ★ | 战斗
      return [
        { v: extra.max_floor || '-', l: '层' },
        { v: extra.max_floor_star ?? extra.total_star ?? '-', l: '★' },
        { v: extra.battle_num ?? '-', l: '战斗' }
      ]
    case 1: // 真境幻想剧诗: 模式 | 幕 | 用时 | 借出
      return [
        { v: MODE_NAMES[extra.mode_id] || extra.mode_id || '-', l: '模式' },
        { v: extra.round_count ?? '-', l: '幕' },
        { v: extra.total_time != null
          ? `${Math.floor(extra.total_time / 60)}'${String(extra.total_time % 60).padStart(2, '0')}"`
          : '-', l: '用时' },
        { v: extra.borrow_num ?? '-', l: '借出' }
      ]
    case 2: // 幽境危战: 难度 | 用时 | 徽章
      return [
        { v: DIFF_NAMES[extra.difficulty] || extra.difficulty || '-', l: '难度' },
        { v: extra.time_second != null
          ? `${Math.floor(extra.time_second / 60)}'${String(extra.time_second % 60).padStart(2, '0')}"`
          : '-', l: '用时' },
        { v: BADGE_NAMES[extra.badge] || '-', l: '徽章' }
      ]
    default: return []
  }
}

const TYPE_KEYWORDS = ['深境', '深渊', '深境螺旋', '幻想', '剧诗', '幻想真境剧诗', '幽境', '危战', '幽境危战']

/**
 * Genshin 终局挑战排行 handler
 * @this {plugin} — bound to the plugin instance
 */
export async function handleGsRank (e) {
  if (!e.isGroup) {
    await e.reply('排行功能仅限群聊使用')
    return true
  }
  if (!this._isGsRankEnabled()) {
    await e.reply('深渊排行功能已关闭，请联系管理员开启')
    return true
  }

  const challengeType = resolveGsType(e.msg)
  if (challengeType < 0) return true

  // 解析维度
  let rest = e.msg
  for (const kw of TYPE_KEYWORDS) rest = rest.replace(kw, '')
  rest = rest.replace(/^(#?原神)/, '').replace(/^(排名|排行)/, '').trim()
  const dimension = GsChallengeRank.resolveDimensionAlias(rest) || GsChallengeRank.getDefaultDimension(challengeType)

  // 群配置
  const groupCfg = await GsChallengeRank.getGroupCfg(e.group_id)
  if (groupCfg.status === 0) {
    await e.reply('本群深渊排行已关闭')
    return true
  }

  const cfg = getPluginConfig()
  const topN = cfg?.gsAbyssRank?.rankNumber || 20
  const typeName = GsChallengeRank.getTypeName(challengeType)
  const scheduleId = await GsChallengeRank.getCurrentScheduleId(challengeType, e.group_id)
  if (!scheduleId) {
    const hints = ['深渊', '剧诗', '幽境']
    await e.reply(`本群暂无${typeName}排行数据，请先发送 #${hints[challengeType]} 上报数据`)
    return true
  }

  const dims = GsChallengeRank.getDimensions(challengeType)
  const dimDef = dims.find(d => d.key === dimension)
  const dimLabel = dimDef?.label || (dimension === '__' ? (() => {
    switch (challengeType) { case 0: return '星数'; case 1: return '模式'; case 2: return '难度'; default: return '综合' }
  })() : dimension)

  const list = await GsChallengeRank.getRank(e.group_id, challengeType, dimension, scheduleId, topN)
  if (!list.length) {
    const hints = ['深渊', '剧诗', '幽境']
    await e.reply(`本群暂无${typeName}排行数据，请先发送 #${hints[challengeType]} 上报数据`)
    return true
  }

  const selfRank = e.uid
    ? await GsChallengeRank.getRankForUid(e.uid, e.group_id, challengeType, dimension, scheduleId)
    : null
  const totalCount = await GsChallengeRank.getRankCount(e.group_id, challengeType, dimension, scheduleId)

  // QQ 身份信息
  const pickMember = (qq) => {
    if (!qq) return null
    try { return e.group.pickMember(qq) } catch { return null }
  }

  await Promise.all(list.map(async (item) => {
    const member = pickMember(item.qq)
    if (member) {
      try {
        item.qqFace = await member.getAvatarUrl?.().catch(() => null) || `https://q.qlogo.cn/g?b=qq&nk=${item.qq}&s=100`
        const info = await member.getInfo?.().catch(() => null)
        item.nickname = info?.card || info?.nickname || ''
      } catch { item.qqFace = `https://q.qlogo.cn/g?b=qq&nk=${item.qq}&s=100` }
    }
  }))

  if (selfRank) {
    const member = pickMember(selfRank.qq)
    if (member) {
      try {
        selfRank.qqFace = await member.getAvatarUrl?.().catch(() => null) || `https://q.qlogo.cn/g?b=qq&nk=${selfRank.qq}&s=100`
        const info = await member.getInfo?.().catch(() => null)
        selfRank.nickname = info?.card || info?.nickname || ''
      } catch { selfRank.qqFace = `https://q.qlogo.cn/g?b=qq&nk=${selfRank.qq}&s=100` }
    }
  }

  for (const item of list) { item.cols = buildGsCols(item.extra, challengeType) }
  if (selfRank) { selfRank.cols = buildGsCols(selfRank.extra, challengeType) }

  const seasonMeta = await GsChallengeRank.getSeasonMeta(challengeType, e.group_id)

  const renderData = {
    title: `${typeName}·${dimLabel}排行`,
    challengeType,
    dimension,
    list,
    selfRank,
    totalCount,
    groupId: e.group_id,
    topN,
    beginTime: seasonMeta?.beginTime || '',
    endTime: seasonMeta?.endTime || '',
    periodNumber: seasonMeta?.periodNumber || null
  }
  const img = await render('challenge/GS', 'rank', renderData)
  if (img) await e.reply(img)
  return true
}

/** Genshin 排行重置 handler */
export async function handleGsRankReset (e) {
  const challengeType = resolveGsType(e.msg)
  if (challengeType < 0) return true
  const typeName = GsChallengeRank.getTypeName(challengeType)
  await GsChallengeRank.resetRank(e.group_id, challengeType)
  await e.reply(`已重置本群${typeName}排行数据`)
  return true
}
