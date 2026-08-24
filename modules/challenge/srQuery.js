/**
 * 星铁终局挑战查询 — 业务逻辑模块
 *
 * 移植自 StarRail-plugin，接入 Axiu-Plugin 过码链路
 */

import MysSrApi from '../../model/mys/mysSrApi.js'
import { LOG_PREFIX } from '../../components/constants.js'

export const TYPE_NAMES = ['末日幻影', '虚构叙事', '忘却之庭', '异相仲裁']

export const CHALLENGE_API_KEYS = [
  'srChallengeBoss', 'srChallengeStory', 'srChallenge', 'srChallengePeak'
]

export const CHALLENGE_API_SIMPLE_KEYS = [
  'srChallengeBossSimple', 'srChallengeStorySimple', 'srChallengeSimple', 'srChallengePeakSimple'
]

/**
 * 查询挑战数据
 * @param {object} ctx — plugin 实例（this）
 * @param {number} challengeType — 0=末日, 1=虚构, 2=忘却, 3=仲裁
 * @param {{uid, ck}} auth
 */
export async function queryChallenge (ctx, challengeType, auth) {
  ctx.e.isSr = true
  ctx.isSr = true
  const simple = ctx.e.msg.match('简易')
  const last = ctx.e.msg.match('上期')
  const recent = ctx.e.msg.match('往期')

  const uid = auth.uid
  const ck = auth.ck

  let scheduleType = '1'
  if (last) scheduleType = '2'
  if ((recent || last) && challengeType === 3) scheduleType = '3'

  const api = new MysSrApi(uid, ck)

  let deviceFp = await api.getData('getFp')
  if (!deviceFp?.data?.device_fp) return null
  deviceFp = deviceFp?.data?.device_fp

  let challengeData, res, simpleRes

  if (!simple) {
    const requestType = CHALLENGE_API_KEYS[challengeType]
    res = await api.getData(requestType, { deviceFp, schedule_type: scheduleType })
    res = await api.checkCode(ctx.e, res, requestType, { deviceFp, schedule_type: scheduleType })
  }

  if (simple || res?.retcode !== 0) {
    const simpleRequestType = CHALLENGE_API_SIMPLE_KEYS[challengeType]
    simpleRes = await api.getData(simpleRequestType, { deviceFp, schedule_type: scheduleType })
    simpleRes = await api.checkCode(ctx.e, simpleRes, simpleRequestType, { deviceFp, schedule_type: scheduleType })
    if (simpleRes?.retcode !== 0) return null
  }

  if (!simple && res?.retcode === 0) {
    challengeData = res
  } else if (simple && simpleRes?.retcode === 0) {
    challengeData = simpleRes
  } else {
    challengeData = simpleRes
    logger.warn(`${LOG_PREFIX} 星铁${TYPE_NAMES[challengeType]}详细信息出现验证码，仅显示最后一层`)
  }

  const data = { ...challengeData.data }

  if (data.groups && data.groups.length > 1) {
    const activeGroup = scheduleType === '1'
      ? data.groups.find(g => g.status === 'New')
      : data.groups.find(g => g.status === 'End')
    if (activeGroup) data.groups = [activeGroup]
  }

  if (recent && challengeType === 3) {
    return { data, uid, challengeType, type: scheduleType }
  }

  data.currentType = getCurrentChallengeType()

  // 时间格式化
  if ([0, 1].includes(challengeType)) {
    data.beginTime = timeFormat(data.groups[0].begin_time)
    data.endTime = timeFormat(data.groups[0].end_time)
  } else if (challengeType === 2) {
    data.beginTime = timeFormat(data.begin_time)
    data.endTime = timeFormat(data.end_time)
  } else {
    data.peak_records = last
      ? data.challenge_peak_records[1]
      : data.challenge_peak_records[0]
    data.beginTime = timeFormat(data.peak_records.group.begin_time)
    data.endTime = timeFormat(data.peak_records.group.end_time)
  }

  // 楼层数据格式化
  if (challengeType !== 3) {
    data.all_floor_detail = data.all_floor_detail.map(floor => ({
      ...floor,
      node_1: { ...floor.node_1, ...(floor.node_1.challenge_time && { challengeTime: timeFormat(floor.node_1.challenge_time, true) }) },
      ...(floor.node_2 && { node_2: { ...floor.node_2, ...(floor.node_2.challenge_time && { challengeTime: timeFormat(floor.node_2.challenge_time, true) }) } }),
      ...(floor.node_3 && { node_3: { ...floor.node_3, ...(floor.node_3.challenge_time && { challengeTime: timeFormat(floor.node_3.challenge_time, true) }) } })
    }))
  } else {
    if (data.peak_records.boss_record) {
      data.peak_records.boss_record.challengeTime = timeFormat(data.peak_records.boss_record.challenge_time, true)
    }
    data.peak_records.mob_records = data.peak_records.mob_records.map(record => ({
      ...record,
      ...(record.challenge_time && { challengeTime: timeFormat(record.challenge_time, true) })
    }))
  }

  // 末日/虚构：计算两边节点总分
  if ([0, 1].includes(challengeType)) {
    data.all_floor_detail = data.all_floor_detail.map(floor => {
      if (floor.node_1.score != null) {
        let totalScore = parseInt(floor.node_1.score)
        if (floor.node_2 && floor.node_2.score != null) totalScore += parseInt(floor.node_2.score)
        if (floor.node_3 && floor.is_tierce) totalScore += parseInt(floor.node_3.score)
        return { ...floor, score: totalScore.toString() }
      }
      return floor
    })
  }

  ctx._reportRanking(data, uid, challengeType, scheduleType, !simple && res?.retcode === 0)

  return { data, uid, challengeType, type: scheduleType }
}

/** 仲裁往期格式化 */
export function recentPeak (record) {
  const data = { ...record }
  data.beginTime = timeFormat(data.group.begin_time)
  data.endTime = timeFormat(data.group.end_time)
  if (data.boss_record) {
    data.boss_record.challengeTime = timeFormat(data.boss_record.challenge_time, true)
  }
  data.mob_records = data.mob_records.map(r => ({
    ...r,
    ...(r.challenge_time && { challengeTime: timeFormat(r.challenge_time, true) })
  }))
  return data
}

/** 当前挑战类型：0=末日, 1=虚构, 2=混沌 */
export function getCurrentChallengeType () {
  const firstTime = new Date('2024-06-24T04:00:00')
  const diff = Date.now() - firstTime.getTime()
  if (diff < 0) return 0
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 14)) % 3
}

/** 时间格式化 */
export function timeFormat (timeObj, includeTime) {
  if (!timeObj) return ''
  const { year, month, day, hour, minute } = timeObj
  const pad = (n) => String(n).padStart(2, '0')
  const date = `${year}.${pad(month)}.${pad(day)}`
  if (includeTime) return `${date} ${pad(hour || 0)}:${pad(minute || 0)}`
  return date
}
