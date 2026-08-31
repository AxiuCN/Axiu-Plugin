/**
 * 星铁终局挑战排行 — 业务逻辑模块
 */

import SrChallengeRank from '../../model/srChallengeRank.js'
import { getPluginConfig } from '../../components/config.js'
import { render } from '../../components/render.js'

/** 关键词 → challengeType */
function resolveSrAlias (text) {
  if (/末日/.test(text)) return 0
  if (/虚构|叙事/.test(text)) return 1
  if (/忘却|混沌/.test(text)) return 2
  if (/仲裁|异相|异乡/.test(text)) return 3
  return -1
}

/** 构造排行多列展示数据 */
function buildSrCols (extra, challengeType) {
  switch (challengeType) {
    case 0: // 末日: 难度 | ★ | 分
      return [
        { v: extra.max_floor || '-', l: '难度' },
        { v: extra.star_num != null ? extra.star_num : '-', l: '★' },
        { v: extra.total_score ?? '-', l: '分' }
      ]
    case 1: // 虚构: 层 | ★ | 分 | 轮
      return [
        { v: extra.max_floor || '-', l: '层' },
        { v: extra.star_num != null ? extra.star_num : '-', l: '★' },
        { v: extra.total_score ?? '-', l: '分' },
        { v: extra.round_num ?? '-', l: '轮' }
      ]
    case 2: // 忘却: 层 | ★ | 轮
      return [
        { v: extra.max_floor || '-', l: '层' },
        { v: extra.star_num != null ? extra.star_num : '-', l: '★' },
        { v: extra.round_num ?? '-', l: '轮' }
      ]
    case 3: // 仲裁: 模式 | 王棋 | 骑士 | 轮
      return [
        { v: extra.hard_mode ? '绝境' : '普通', l: '' },
        { v: extra.boss_stars ?? '-', l: '王棋' },
        { v: extra.mob_stars ?? '-', l: '骑士' },
        { v: extra.round_num != null ? `${extra.round_num}(${extra.round_label || '轮'})` : '-', l: '轮' }
      ]
    default: return []
  }
}

const SR_TYPE_KEYWORDS = ['末日', '末日幻影', '虚构', '虚构叙事', '叙事', '忘却', '忘却之庭', '混沌', '混沌回忆', '仲裁', '异相仲裁', '异相', '异乡']

/**
 * 星铁排行 handler
 */
export async function handleSrRank (ctx, e) {
  if (!e.isGroup) {
    await e.reply('排行功能仅限群聊使用')
    return true
  }
  if (!ctx._isRankEnabled()) {
    await e.reply('挑战排行功能已关闭，请联系管理员开启')
    return true
  }

  const challengeType = resolveSrAlias(e.msg)
  if (challengeType < 0) return true

  let rest = e.msg
  for (const kw of SR_TYPE_KEYWORDS) rest = rest.replace(kw, '')
  rest = rest.replace(/^(#?星铁|[*＊])/, '').replace(/^(排名|排行)/, '').trim()
  const dimension = SrChallengeRank.resolveDimensionAlias(rest) || SrChallengeRank.getDefaultDimension(challengeType)

  const groupCfg = await SrChallengeRank.getGroupCfg(e.group_id)
  if (groupCfg.status === 0) {
    await e.reply('本群挑战排行已关闭')
    return true
  }

  const cfg = getPluginConfig()
  const topN = cfg?.srChallengeRank?.rankNumber || 20
  const typeName = SrChallengeRank.getTypeName(challengeType)
  const scheduleId = await SrChallengeRank.getCurrentScheduleId(challengeType, e.group_id)
  if (!scheduleId) {
    await e.reply(`本群暂无${typeName}排行数据，请先发送挑战查询命令（如 *${['末日', '虚构', '忘却', '仲裁'][challengeType]}）上报数据`)
    return true
  }

  const dims = SrChallengeRank.getDimensions(challengeType)
  const dimDef = dims.find(d => d.key === dimension)
  const dimLabel = dimDef?.label || (dimension === '__' ? (() => {
    switch (challengeType) { case 0: return '分数'; case 1: return '星数'; case 2: return '星数'; case 3: return '王棋星数'; default: return '综合' }
  })() : dimension)

  const list = await SrChallengeRank.getRank(e.group_id, challengeType, dimension, scheduleId, topN)
  if (!list.length) {
    await e.reply(`本群暂无${typeName}排行数据，请先发送挑战查询命令（如 *${['末日', '虚构', '忘却', '仲裁'][challengeType]}）上报数据`)
    return true
  }

  const selfRank = e.uid
    ? await SrChallengeRank.getRankForUid(e.uid, e.group_id, challengeType, dimension, scheduleId)
    : null
  const totalCount = await SrChallengeRank.getRankCount(e.group_id, challengeType, dimension, scheduleId)

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

  for (const item of list) { item.cols = buildSrCols(item.extra, challengeType) }
  if (selfRank) { selfRank.cols = buildSrCols(selfRank.extra, challengeType) }

  const seasonMeta = await SrChallengeRank.getSeasonMeta(challengeType, e.group_id)

  const renderData = {
    title: `${typeName}·${dimLabel}排行`,
    challengeType, dimension, dimLabel, list, selfRank, totalCount,
    groupId: e.group_id, topN,
    beginTime: seasonMeta?.beginTime || '',
    endTime: seasonMeta?.endTime || '',
    periodNumber: seasonMeta?.periodNumber || null,
    scheduleName: seasonMeta?.scheduleName || ''
  }
  const img = await render('challenge/SR', 'rank', renderData)
  if (img) await e.reply(img)
  return true
}

/** 星铁排行重置 handler */
export async function handleSrRankReset (ctx, e) {
  const challengeType = resolveSrAlias(e.msg)
  if (challengeType < 0) return true
  const typeName = SrChallengeRank.getTypeName(challengeType)
  await SrChallengeRank.resetRank(e.group_id, challengeType)
  await e.reply(`已重置${typeName}排行数据（全局）`)
  return true
}

/** 星铁排行刷新（重排）handler — 数据错误时用 uid 元数据重建 ZSET */
export async function handleSrRankRebuild (ctx, e) {
  const challengeType = resolveSrAlias(e.msg)
  const onlyType = challengeType >= 0 ? challengeType : null
  await e.reply(`正在重排星铁${onlyType != null ? SrChallengeRank.getTypeName(onlyType) : '全部'}排行数据，可能需要一段时间...`)
  const result = await SrChallengeRank.rebuildAll(onlyType)
  const st = result.types
  let msg = `重排完成：处理 ${result.total} 个 UID 记录`
  for (const ct of [0, 1, 2, 3]) {
    if (st[ct]?.schedules > 0 || st[ct]?.uids > 0) {
      msg += `\n${SrChallengeRank.getTypeName(ct)}: ${st[ct].uids} 个UID / ${st[ct].schedules} 期记录`
    }
  }
  await e.reply(msg)
  return true
}
