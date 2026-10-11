/**
 * 终局挑战排行：名次键编码、并列密集名次、首查与最优保护
 * （model/gsChallengeRank.js 原神 / model/srChallengeRank.js 星铁）
 *
 * 口径（2026-10-05 定）：
 * - **名次键**决定名次：深渊 层→星（战斗只展示）、剧诗 模式→幕→星章→用时（借出只展示）、危战 难度→用时；
 *   星铁 末日 难度→分、虚构 层→星→分→轮、忘却 层→星→轮、仲裁 绝境→王棋→骑士→轮（战斗只展示）
 * - **并列**：名次键相同 ⇒ 同分数 ⇒ 同密集名次（1,1,2）；组内按**首查**（该期第一次观测到成绩的时刻）先后
 * - 首查**不展示、不进分数、落定后不刷新**；名次键取本期最优，展示字段取最后一次观测
 */
import fs from 'node:fs'
import path from 'node:path'
import { importMod, installFrameworkStubs, checker, tmpDir } from './_helper.mjs'

// 写前钩子：只暂停「第一次对 uid 键的写入」，用于制造确定的交错（仅交错用例会启用）
let armed = false
let heldOnce = false
let releaseHold = null
const beforeWrite = async (key) => {
  if (!armed || heldOnce || !String(key).includes(':uid:')) return
  heldOnce = true
  await new Promise(resolve => { releaseHold = resolve })
}

// 并发用例共用的时序记录：按发生顺序记下 ZSET 写入与删键，用来断言「谁落在谁之后」。
// 时序一律在**挂起点放行之后**记：即记录的是操作真正落库的时刻，而不是钩子被调用的时刻
let timeline = []
let zaddRecord = false
let zaddHold = false
let zaddHeld = false
let releaseZAdd = null
const beforeZAdd = async (key) => {
  if (zaddHold && !zaddHeld) {
    zaddHeld = true
    await new Promise(resolve => { releaseZAdd = resolve })
  }
  if (zaddRecord || zaddHold) timeline.push(`zadd:${key}`)
}

let delRecord = false
let delHold = false
let delHeld = false
let delHoldPrefix = '' // 只有删除以该前缀开头的键时才挂起（原神/星铁各自指定自己的排行键前缀）
let releaseDel = null
const beforeDel = async (keys) => {
  // 只挂「删除排行键」这一步：uid 元信息修剪里的删键不参与（那一步由 uidLock 管）
  const isRankDel = delHoldPrefix && keys.some(k => k.startsWith(delHoldPrefix))
  if (delHold && !delHeld && isRankDel) {
    delHeld = true
    await new Promise(resolve => { releaseDel = resolve })
  }
  if (delRecord || delHold) for (const k of keys) timeline.push(`del:${k}`)
}

const store = installFrameworkStubs({ beforeWrite, beforeZAdd, beforeDel })

const { default: Gs } = await importMod('model/gsChallengeRank.js')
const { default: Sr } = await importMod('model/srChallengeRank.js')
const { check, finish } = checker()

const KEY = 'Axiu:gsAbyss:rank' // 键格式与 docs/架构.md 记录一致
const SID = '1001'
const compoundKey = (ct) => `${KEY}:${ct}:__:${SID}`
const uidKeyOf = (uid) => `${KEY}:uid:${uid}`
const scoreOf = (ct, uid) => redis.zScore(compoundKey(ct), uid)
const waitUntil = async (fn, timeoutMs = 3000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return true
    await new Promise(r => setTimeout(r, 5))
  }
  return false
}
/** 直接预置 uid 元信息（用于固定 firstTime / 制造缺失首查的老数据） */
const seedSlot = (uid, ct, slot) => {
  store.strings.set(uidKeyOf(uid), JSON.stringify({ qq: '10001', [ct]: { [SID]: slot } }))
}

/** 该类型下**任一** ZSET 是否还有该 uid 的成员（含 `__` 与各维度）——「榜上有该项」的判据 */
const anyZsetMember = async (ct, uid) => {
  for (const k of await redis.keys(`${KEY}:${ct}:*`)) {
    if (await redis.zScore(k, uid) != null) return k
  }
  return null
}

/** 剧诗上报数据 */
const roleData = ({ mode = 4, rounds = 10, medals = 10, useTime = 500, rent = 0 } = {}) => ({
  stat: {
    difficulty_id: mode,
    get_medal_round_list: Array.from({ length: 10 }, (_, i) => (i < medals ? 1 : 0)),
    total_use_time: useTime,
    rent_cnt: rent
  },
  detail: { rounds_data: Array.from({ length: rounds }, () => ({})) },
  start_time: 1770000000
})

const ABYSS_START = Math.floor(Date.parse('2026-08-16T04:00:00+08:00') / 1000)
/** 深渊上报数据：层/星/战斗 */
const abyssData = ({ floor = '12-3', star = 3, battles = 20 } = {}) => ({
  max_floor: floor,
  floors: [{ index: 12, star }],
  total_battle_times: battles,
  total_star: star,
  start_time: ABYSS_START
})
/** 预置首查时间后上报深渊（firstTime 会被冻结成预置值） */
const reportAbyssAt = async (uid, { firstTs, floor = '12-3', star = 3, battles = 20 }) => {
  seedSlot(uid, 0, { scores: {}, extra: {}, firstTime: firstTs, startTs: ABYSS_START, time: Date.now() })
  await Gs.report(uid, '10001', '123', 0, abyssData({ floor, star, battles }), SID)
  return scoreOf(0, uid)
}

/* ---------- 星铁侧（键前缀不同） ---------- */
const SR_KEY = 'Axiu:challenge:rank'
const srCompoundKey = (ct) => `${SR_KEY}:${ct}:__:${SID}`
const srUidKeyOf = (uid) => `${SR_KEY}:uid:${uid}`
const srScoreOf = (ct, uid) => redis.zScore(srCompoundKey(ct), uid)
/** 该类型下**任一** ZSET 是否还有该 uid 的成员（星铁侧，同 anyZsetMember） */
const anySrZsetMember = async (ct, uid) => {
  for (const k of await redis.keys(`${SR_KEY}:${ct}:*`)) {
    if (await redis.zScore(k, uid) != null) return k
  }
  return null
}
const seedSrSlot = (uid, ct, slot) => {
  store.strings.set(srUidKeyOf(uid), JSON.stringify({ qq: '10001', [ct]: { [SID]: slot } }))
}
/** 星铁挑战上报数据（末日/虚构/忘却走 all_floor_detail，仲裁走 peak_records） */
const srData = ({ floor = 12, star = 3, score = 60000, round = 5, battle = 10 } = {}) => ({
  max_floor: floor,
  all_floor_detail: [{ star_num: star, round_num: round, score }],
  battle_num: battle,
  beginTime: { year: 2026, month: 8, day: 1 }
})
const srReportAt = async (uid, ct, opts) => {
  seedSrSlot(uid, ct, { scores: {}, extra: {}, firstTime: opts.firstTs, time: Date.now() })
  await Sr.report(uid, '10001', '123', ct, srData(opts), SID)
  return srScoreOf(ct, uid)
}

console.log('=== 剧诗名次键：模式→幕→星章→用时（借出只展示） ===')
{
  const A = '100000001'
  const B = '100000002'
  await Gs.report(A, '10001', '123', 1, roleData({ useTime: 500, rent: 0 }), SID)
  await Gs.report(B, '10001', '123', 1, roleData({ useTime: 501, rent: 2 }), SID)
  const sa = await scoreOf(1, A)
  const sb = await scoreOf(1, B)
  console.log(`  500秒/借出0 = ${sa}；501秒/借出2 = ${sb}`)
  check('用时少者在前（500 秒 > 501 秒）', sa > sb, `${sa} vs ${sb}`)

  const C = '100000003'
  await Gs.report(C, '10001', '123', 1, roleData({ useTime: 500, rent: 3 }), SID)
  const sc = await scoreOf(1, C)
  check('借出不进名次键：用时相同即同分（并列）', sc === sa, `${sc} vs ${sa}`)
}

console.log('=== 剧诗反超守卫：低优先级取极值也不得越级 ===')
{
  const cases = [
    ['星章', 10, { medals: 10, useTime: 999999, rent: 0 }, 9, { medals: 9, useTime: 0, rent: 99 }],
    ['幕数', 10, { rounds: 10, medals: 0, useTime: 999999, rent: 0 }, 9, { rounds: 9, medals: 10, useTime: 0, rent: 99 }],
    ['模式', 4, { mode: 4, rounds: 0, medals: 0, useTime: 999999, rent: 0 }, 3, { mode: 3, rounds: 10, medals: 10, useTime: 0, rent: 99 }]
  ]
  for (const [label, hiVal, hiOpt, loVal, loOpt] of cases) {
    const hi = '100001001'
    const lo = '100001002'
    store.strings.clear()
    store.zsets.clear()
    await Gs.report(hi, '10001', '123', 1, roleData(hiOpt), SID)
    await Gs.report(lo, '10001', '123', 1, roleData(loOpt), SID)
    const sHi = await scoreOf(1, hi)
    const sLo = await scoreOf(1, lo)
    console.log(`  ${label} ${hiVal} vs ${loVal}（后者低优先级全取极值）: ${sHi} vs ${sLo}`)
    check(`${label}差一级不被下级极值反超`, sHi > sLo, `${sHi} vs ${sLo}`)
  }
}

console.log('=== 深渊名次键：层→星（战斗只展示） ===')
{
  store.strings.clear()
  store.zsets.clear()
  const hiFloor = await reportAbyssAt('100004001', { firstTs: (ABYSS_START + 31 * 86400) * 1000, floor: '12-3', star: 0, battles: 99 })
  const loFloor = await reportAbyssAt('100004002', { firstTs: (ABYSS_START + 0) * 1000, floor: '11-3', star: 3, battles: 0 })
  check('更高层优先于任何星数/首查差', hiFloor > loFloor, `${hiFloor} vs ${loFloor}`)

  const hiStar = await reportAbyssAt('100004003', { firstTs: (ABYSS_START + 31 * 86400) * 1000, star: 3, battles: 99 })
  const loStar = await reportAbyssAt('100004004', { firstTs: (ABYSS_START + 0) * 1000, star: 2, battles: 0 })
  check('同层更高星优先于任何首查/战斗差', hiStar > loStar, `${hiStar} vs ${loStar}`)

  const fewer = await reportAbyssAt('100004005', { firstTs: (ABYSS_START + 5 * 86400) * 1000, battles: 10 })
  const more = await reportAbyssAt('100004006', { firstTs: (ABYSS_START + 5 * 86400) * 1000, battles: 20 })
  check('战斗不进名次键：层星相同即同分（并列）', fewer === more, `${fewer} vs ${more}`)
}

console.log('=== 并列密集名次 + 首查只破并列（getRank） ===')
{
  store.strings.clear()
  store.zsets.clear()
  const early = '100006001'
  const late = '100006002'
  const noFirst = '100006003'
  const lower = '100006004'
  // 三人同层同星（同分），首查：early 最早、late 次日、noFirst 缺失（老数据）
  await reportAbyssAt(early, { firstTs: (ABYSS_START + 3600) * 1000, battles: 20 })
  await reportAbyssAt(late, { firstTs: (ABYSS_START + 86400) * 1000, battles: 21 })
  seedSlot(noFirst, 0, { scores: { floor: 123, star: 3 }, extra: { max_floor: '12-3', max_floor_star: 3, battle_num: 22 }, time: Date.now() })
  await redis.zAdd(compoundKey(0), { score: await scoreOf(0, early), value: noFirst })
  await reportAbyssAt(lower, { firstTs: (ABYSS_START + 60) * 1000, floor: '11-3', star: 3, battles: 0 })

  const list = await Gs.getRank('123', 0, '__', SID, 20)
  const order = list.map(r => r.uid)
  const ranks = list.map(r => r.rank)
  console.log(`  顺序: ${order.join(' → ')}；名次: ${ranks.join(',')}`)
  check('并列者按首查先后排列（早者在前）', order[0] === early && order[1] === late, order.join(','))
  check('密集名次：三人并列第 1、下一名是第 2', ranks[0] === 1 && ranks[1] === 1 && ranks[2] === 1 && ranks[3] === 2, ranks.join(','))
  check('首查缺失（老数据）排在同名次末尾', order[2] === noFirst, order[2])
  check('本人名次与列表一致（并列者同为 1）', (await Gs.getRankForUid(early, '123', 0, '__', SID))?.rank === 1)
  check('本人名次：低一层者为 2', (await Gs.getRankForUid(lower, '123', 0, '__', SID))?.rank === 2)
}

console.log('=== 首查冻结 + 名次键取最优、展示字段取最后一次 ===')
{
  store.strings.clear()
  store.zsets.clear()
  const uid = '100007001'
  const firstTs = (ABYSS_START + 7200) * 1000
  await reportAbyssAt(uid, { firstTs, star: 2, battles: 20 })
  const scoreAfterFirst = await scoreOf(0, uid)

  // 成绩提升：名次键更新，但首查不刷新
  await Gs.report(uid, '10001', '123', 0, abyssData({ star: 3, battles: 25 }), SID)
  const slot1 = JSON.parse(store.strings.get(uidKeyOf(uid)))[0][SID]
  check('成绩提升后首查保持不变（冻结）', slot1.firstTime === firstTs, String(slot1.firstTime))
  check('成绩提升后名次键更高', (await scoreOf(0, uid)) > scoreAfterFirst)
  check('展示字段取最后一次（战斗 25）', slot1.extra.battle_num === 25 && slot1.scores.battle === -25,
    `${slot1.extra.battle_num}/${slot1.scores.battle}`)

  // 成绩变差：名次键不回退，展示字段仍刷新
  const before = await scoreOf(0, uid)
  await Gs.report(uid, '10001', '123', 0, abyssData({ floor: '11-3', star: 3, battles: 30 }), SID)
  const slot2 = JSON.parse(store.strings.get(uidKeyOf(uid)))[0][SID]
  check('更差的上报不覆盖名次键（分数不回退）', (await scoreOf(0, uid)) === before, `${await scoreOf(0, uid)} vs ${before}`)
  check('更差的上报仍刷新展示字段（战斗 30）', slot2.extra.battle_num === 30 && slot2.scores.battle === -30,
    `${slot2.extra.battle_num}/${slot2.scores.battle}`)
  check('名次键字段保持最优（仍是 12-3）', slot2.scores.floor === 123, String(slot2.scores.floor))
}

console.log('=== 危战名次键：难度→用时 ===')
{
  store.strings.clear()
  store.zsets.clear()
  const A = '100008001'
  const B = '100008002'
  await Gs.report(A, '10001', '123', 2, { single: { best: { difficulty: 5, second: 100 } } }, SID)
  await Gs.report(B, '10001', '123', 2, { single: { best: { difficulty: 5, second: 101 } } }, SID)
  check('同难度用時少者在前', (await scoreOf(2, A)) > (await scoreOf(2, B)))
  const C = '100008003'
  await Gs.report(C, '10001', '123', 2, { single: { best: { difficulty: 4, second: 1 } } }, SID)
  check('难度差一级不被用时反超', (await scoreOf(2, B)) > (await scoreOf(2, C)))
}

console.log('=== 重排幂等（rebuildAll） ===')
{
  store.strings.clear()
  store.zsets.clear()
  await reportAbyssAt('100009001', { firstTs: (ABYSS_START + 3600) * 1000, star: 3 })
  await reportAbyssAt('100009002', { firstTs: (ABYSS_START + 7200) * 1000, star: 2 })
  const beforeA = await scoreOf(0, '100009001')
  const r1 = await Gs.rebuildAll(0)
  const afterA = await scoreOf(0, '100009001')
  const r2 = await Gs.rebuildAll(0)
  const againA = await scoreOf(0, '100009001')
  check('重排后有数据被处理', r1.total >= 2 && r2.total >= 2, `${r1.total}/${r2.total}`)
  check('重排不改变名次键分数（幂等）', beforeA === afterA && afterA === againA, `${beforeA}/${afterA}/${againA}`)
  check('重排不丢首查（并列顺序仍可算）', (await Gs.getRank('123', 0, '__', SID, 20))[0].uid === '100009001')
}

console.log('=== 定向重置与上报交错（第三轮 P2-2） ===')
{
  // 本例是「重置类型 0 + 上报类型 1」：两个玩法不共用重置锁，靠 uid 元信息那把锁串行化
  store.strings.clear()
  store.zsets.clear()
  const uid = '100005001'
  const uidKey = uidKeyOf(uid)
  // 初始：类型 0 与类型 1（类型 1 的旧值为 100 秒）
  store.strings.set(uidKey, JSON.stringify({
    qq: '10001',
    0: { [SID]: { scores: {}, extra: {}, time: 1 } },
    1: { [SID]: { scores: {}, extra: { time_second: 100 }, time: 1 } }
  }))

  armed = true
  heldOnce = false
  releaseHold = null

  // 1) 重置类型 0：读到旧快照后卡在写回
  const prunePromise = Gs.resetRank('123', 0)
  const heldNow = await waitUntil(() => heldOnce)
  check('前置：重置已读到旧快照并暂停在写回', heldNow)

  // 2) 类型 1 的上报与重置交错（先保存 Promise，再释放暂停点）
  const reportPromise = Gs.report(uid, '10001', '123', 1, roleData({ useTime: 501 }), SID)
  await new Promise(r => setTimeout(r, 30)) // 让上报尽量先执行到读/锁等待
  if (releaseHold) releaseHold()
  await Promise.all([prunePromise, reportPromise])

  const info = JSON.parse(store.strings.get(uidKey) || '{}')
  console.log(`  交错后类型槽位: ${Object.keys(info).filter(k => k !== 'qq').join(',') || '无'}；类型1用时=${info?.[1]?.[SID]?.extra?.time_second}`)
  check('目标玩法槽位已移除', info[0] == null, JSON.stringify(Object.keys(info)))
  check('其他玩法明细未被旧快照覆盖（应为 501）', info?.[1]?.[SID]?.extra?.time_second === 501,
    String(info?.[1]?.[SID]?.extra?.time_second))
  check('交错后综合分已按新值写入', (await scoreOf(1, uid)) > 0)

  armed = false
}

console.log('=== 重置与上报共用重置锁：上报先开始、重置插进来（第四轮 #4） ===')
{
  store.strings.clear()
  store.zsets.clear()
  timeline = []
  const uid = '100010001'
  const uidKey = uidKeyOf(uid)
  // 预置类型 0 的旧槽位与旧 ZSET 成员（重置才有键可删）；类型 1 明细不该被顺带清掉
  store.strings.set(uidKey, JSON.stringify({
    qq: '10001',
    0: { [SID]: { scores: { floor: 113, star: 3 }, extra: {}, time: 1 } },
    1: { [SID]: { scores: {}, extra: { time_second: 100 }, time: 1 } }
  }))
  await redis.zAdd(compoundKey(0), { score: 1, value: uid })

  zaddRecord = true; zaddHold = true; zaddHeld = false; releaseZAdd = null
  delRecord = true; delHold = false

  // 1) 同玩法上报先开始，暂停在 `__` 维度 ZSET 写入前
  const reportPromise = Gs.report(uid, '10001', '123', 0, abyssData({ star: 3, battles: 20 }), SID)
  check('前置：上报已暂停在 ZSET 写入前', await waitUntil(() => zaddHeld))

  // 2) 重置同玩法：必须等上报整体结束（含锁外的 ZSET 写入）
  const resetPromise = Gs.resetRank('123', 0)
  const resetSettled = await Promise.race([
    resetPromise.then(() => '重置已完成', () => '重置已完成'),
    new Promise(r => setTimeout(() => r('仍在等锁'), 50))
  ])
  check('串行化：上报未走完时，重置拿不到锁（不删键）', resetSettled === '仍在等锁', resetSettled)

  if (releaseZAdd) releaseZAdd()
  await Promise.all([reportPromise, resetPromise])

  zaddHold = false; zaddRecord = false; delRecord = false

  const info = JSON.parse(store.strings.get(uidKey) || '{}')
  const hasSlot = !!info?.[0]?.[SID]
  const hasScore = (await scoreOf(0, uid)) != null
  const zsetKey = await anyZsetMember(0, uid)
  console.log(`  交错后：槽位=${hasSlot} 分数=${hasScore} 仍有成员的 ZSET=${zsetKey || '无'}；时序=${timeline.join(' → ')}`)
  check('不存在「ZSET 有成员但元信息无该类型槽位」', !(zsetKey && !hasSlot), `zset=${zsetKey} slot=${hasSlot}`)
  check('终态只能是「槽位在且分数在」或「两者都不在」',
    (hasSlot && hasScore) || (!hasSlot && !hasScore), `slot=${hasSlot} score=${hasScore}`)
  const delIdx = timeline.indexOf(`del:${compoundKey(0)}`)
  const lastZAdd = timeline.reduce((acc, t, i) => (t.startsWith('zadd:') ? i : acc), -1)
  check('串行化：重置的删键落在上报全部 ZSET 写入之后', delIdx >= 0 && lastZAdd >= 0 && lastZAdd < delIdx, timeline.join(' → '))
  check('其他玩法明细未被连带清掉', info?.[1]?.[SID]?.extra?.time_second === 100, JSON.stringify(info))
}

console.log('=== 重置与上报共用重置锁：重置先开始、上报插进来（第四轮 #4） ===')
{
  store.strings.clear()
  store.zsets.clear()
  timeline = []
  const uid = '100011001'
  const uidKey = uidKeyOf(uid)
  store.strings.set(uidKey, JSON.stringify({
    qq: '10001',
    0: { [SID]: { scores: { floor: 113, star: 3 }, extra: {}, time: 1 } }
  }))
  await redis.zAdd(compoundKey(0), { score: 1, value: uid })

  delRecord = true; delHold = true; delHeld = false; releaseDel = null
  delHoldPrefix = `${KEY}:0:`
  zaddRecord = true; zaddHold = false

  // 1) 同玩法重置先开始，暂停在删键前（uid 元信息修剪已完成）
  const resetPromise = Gs.resetRank('123', 0)
  check('前置：重置已进入删键阶段并暂停', await waitUntil(() => delHeld))

  // 2) 重置进行中发起同玩法上报：必须等重置整体结束才写
  const reportPromise = Gs.report(uid, '10001', '123', 0, abyssData({ star: 3, battles: 20 }), SID)
  const reportSettled = await Promise.race([
    reportPromise.then(() => '上报已完成', () => '上报已完成'),
    new Promise(r => setTimeout(() => r('仍在等锁'), 50))
  ])
  check('串行化：重置删键未完成前，上报不结束（被重置锁挡住）', reportSettled === '仍在等锁', reportSettled)

  if (releaseDel) releaseDel()
  await Promise.all([resetPromise, reportPromise])

  delHold = false; delRecord = false; zaddRecord = false

  const info = JSON.parse(store.strings.get(uidKey) || '{}')
  const hasSlot = !!info?.[0]?.[SID]
  const hasScore = (await scoreOf(0, uid)) != null
  const zsetKey = await anyZsetMember(0, uid)
  console.log(`  交错后：槽位=${hasSlot} 分数=${hasScore} 仍有成员的 ZSET=${zsetKey || '无'}；时序=${timeline.join(' → ')}`)
  check('不存在「ZSET 有成员但元信息无该类型槽位」', !(zsetKey && !hasSlot), `zset=${zsetKey} slot=${hasSlot}`)
  check('终态只能是「槽位在且分数在」或「两者都不在」',
    (hasSlot && hasScore) || (!hasSlot && !hasScore), `slot=${hasSlot} score=${hasScore}`)
  const delIdx = timeline.indexOf(`del:${compoundKey(0)}`)
  const firstZAdd = timeline.findIndex(t => t.startsWith('zadd:'))
  check('串行化：重置进行中发起的上报，其 ZSET 写入全部落在重置删键之后',
    delIdx >= 0 && firstZAdd > delIdx, timeline.join(' → '))
}

console.log('=== 星铁名次键：末日 难度→分（战斗只展示） ===')
{
  store.strings.clear()
  store.zsets.clear()
  const T = (ABYSS_START + 3600) * 1000
  const A = '200001001'
  const B = '200001002'
  await srReportAt(A, 0, { firstTs: T, score: 60000, battle: 10 })
  await srReportAt(B, 0, { firstTs: T, score: 59999, battle: 0 })
  check('同难度分数高者在前', (await srScoreOf(0, A)) > (await srScoreOf(0, B)))
  const C = '200001003'
  await srReportAt(C, 0, { firstTs: T, floor: 11, score: 999999, battle: 0 })
  check('难度差一级不被分数极值反超', (await srScoreOf(0, B)) > (await srScoreOf(0, C)))
  const D = '200001004'
  await srReportAt(D, 0, { firstTs: T, score: 60000, battle: 99 })
  check('战斗不进名次键：难度分数相同即同分（并列）', (await srScoreOf(0, D)) === (await srScoreOf(0, A)))

  // 虚构：块宽足够宽，星数不被分数顶掉（旧公式 score*10 在 score ≥ 10000 时会借位越级）
  const E = '200001005'
  const F = '200001006'
  await srReportAt(E, 1, { firstTs: T, star: 1, score: 0, round: 5 })
  await srReportAt(F, 1, { firstTs: T, star: 0, score: 999999, round: 0 })
  check('虚构：星数差一级不被分数极值反超（旧公式此处会借位）', (await srScoreOf(1, E)) > (await srScoreOf(1, F)))
}

console.log('=== 星铁并列：密集名次 + 首查只破并列 ===')
{
  store.strings.clear()
  store.zsets.clear()
  const early = '200002001'
  const late = '200002002'
  const lower = '200002003'
  await srReportAt(early, 0, { firstTs: (ABYSS_START + 600) * 1000, score: 60000 })
  await srReportAt(late, 0, { firstTs: (ABYSS_START + 7200) * 1000, score: 60000 })
  await srReportAt(lower, 0, { firstTs: (ABYSS_START + 60) * 1000, floor: 11, score: 999999 })
  const list = await Sr.getRank('123', 0, '__', SID, 20)
  const order = list.map(r => r.uid)
  const ranks = list.map(r => r.rank)
  console.log(`  顺序: ${order.join(' → ')}；名次: ${ranks.join(',')}`)
  check('并列者按首查先后排列（早者在前）', order[0] === early && order[1] === late, order.join(','))
  check('密集名次：并列同为 1、下一名是 2', ranks[0] === 1 && ranks[1] === 1 && ranks[2] === 2, ranks.join(','))
  check('本人名次与列表一致（并列者同为 1）', (await Sr.getRankForUid(late, '123', 0, '__', SID))?.rank === 1)

  // 首查冻结 + 名次键不回退
  const firstTs = (ABYSS_START + 999) * 1000
  const uid = early
  await srReportAt(uid, 0, { firstTs, score: 70000 })
  const slot1 = JSON.parse(store.strings.get(srUidKeyOf(uid)))[0][SID]
  check('星铁：成绩提升后首查保持不变（冻结）', slot1.firstTime === firstTs, String(slot1.firstTime))
  const before = await srScoreOf(0, uid)
  await Sr.report(uid, '10001', '123', 0, srData({ floor: 11, star: 3, score: 1, round: 9, battle: 99 }), SID)
  const slot2 = JSON.parse(store.strings.get(srUidKeyOf(uid)))[0][SID]
  check('星铁：更差的上报不覆盖名次键（分数不回退）', (await srScoreOf(0, uid)) === before)
  check('星铁：更差的上报仍刷新展示字段（战斗 99）', slot2.extra.battle_num === 99 && slot2.scores.battle === -99,
    `${slot2.extra.battle_num}/${slot2.scores.battle}`)
}

console.log('=== 星铁侧对称：重置进行中发起的上报被重置锁挡住（第四轮 #4） ===')
{
  store.strings.clear()
  store.zsets.clear()
  timeline = []
  const uid = '200010001'
  const uidKey = srUidKeyOf(uid)
  store.strings.set(uidKey, JSON.stringify({
    qq: '10001',
    0: { [SID]: { scores: { floor: 12, star: 3, score: 1, round: -9 }, extra: {}, time: 1 } }
  }))
  await redis.zAdd(srCompoundKey(0), { score: 1, value: uid })

  delRecord = true; delHold = true; delHeld = false; releaseDel = null
  delHoldPrefix = `${SR_KEY}:0:`
  zaddRecord = true; zaddHold = false

  const resetPromise = Sr.resetRank('123', 0)
  check('前置：星铁重置已进入删键阶段并暂停', await waitUntil(() => delHeld))

  const reportPromise = Sr.report(uid, '10001', '123', 0, srData({ score: 60000, battle: 10 }), SID)
  const reportSettled = await Promise.race([
    reportPromise.then(() => '上报已完成', () => '上报已完成'),
    new Promise(r => setTimeout(() => r('仍在等锁'), 50))
  ])
  check('星铁：重置删键未完成前，上报不结束（被重置锁挡住）', reportSettled === '仍在等锁', reportSettled)

  if (releaseDel) releaseDel()
  await Promise.all([resetPromise, reportPromise])

  delHold = false; delRecord = false; zaddRecord = false; delHoldPrefix = ''

  const info = JSON.parse(store.strings.get(uidKey) || '{}')
  const hasSlot = !!info?.[0]?.[SID]
  const hasScore = (await srScoreOf(0, uid)) != null
  const zsetKey = await anySrZsetMember(0, uid)
  console.log(`  交错后：槽位=${hasSlot} 分数=${hasScore} 仍有成员的 ZSET=${zsetKey || '无'}；时序=${timeline.join(' → ')}`)
  check('星铁：不存在「ZSET 有成员但元信息无该类型槽位」', !(zsetKey && !hasSlot), `zset=${zsetKey} slot=${hasSlot}`)
  check('星铁：终态只能是「槽位在且分数在」或「两者都不在」',
    (hasSlot && hasScore) || (!hasSlot && !hasScore), `slot=${hasSlot} score=${hasScore}`)
  const delIdx = timeline.indexOf(`del:${srCompoundKey(0)}`)
  const firstZAdd = timeline.findIndex(t => t.startsWith('zadd:'))
  check('星铁：重置进行中发起的上报，其 ZSET 写入全部落在重置删键之后',
    delIdx >= 0 && firstZAdd > delIdx, timeline.join(' → '))
}

/* ---------- 排行榜总开关（第四轮 #5）：走真实上报守卫 ---------- */
console.log('=== 排行榜总开关关闭时不上报（第四轮 #5） ===')
{
  // 配置目录经 AXIU_CONFIG_DIR 重定向到 test/.test-tmp/，仓库 config/ 一个字节不碰
  const cfgDir = path.join(tmpDir, 'rank-order-cfg')
  fs.rmSync(cfgDir, { recursive: true, force: true })
  fs.mkdirSync(cfgDir, { recursive: true })
  const cfgPath = path.join(cfgDir, 'config.yaml')
  process.env.AXIU_CONFIG_DIR = cfgDir
  /** 写一份最小配置：只关心两个总开关 */
  const writeCfg = (gsRankEnabled) => fs.writeFileSync(cfgPath,
    'gsAbyss:\n  enabled: true\n' +
    `gsAbyssRank:\n  enabled: ${gsRankEnabled}\n` +
    'srChallenge:\n  enabled: true\n' +
    'srChallengeRank:\n  enabled: true\n', 'utf8')

  // 重量级导入（连带 render / miao / genshin），放在最后，不影响前面的用例
  const { reportGsIfEnabled } = await importMod('modules/challenge/gsQuery.js')
  const uid = '100030001'
  const zsetKeys = () => [...store.zsets.keys()].join(',') || '无'
  /** 每个情形都从空存储 + 指定开关出发，断言互不依赖 */
  const guardCase = async ({ gsRank, groupStatus, isGroup }) => {
    store.strings.clear()
    store.zsets.clear()
    await Gs.setGroupStatus('123', groupStatus)
    writeCfg(gsRank)
    const e = { isGroup, group_id: '123', user_id: '10001', at: '', msg: '#深渊' }
    await reportGsIfEnabled(e, uid, 0, abyssData(), SID, true, '深渊')
  }

  // 情形 1：总开关关闭 —— 配置承诺「关闭后不上报」，群开关开着也不写
  await guardCase({ gsRank: false, groupStatus: 1, isGroup: true })
  check('总开关关闭：不产生任何排行 ZSET 键', store.zsets.size === 0, zsetKeys())
  check('总开关关闭：不写 uid 元信息', (await redis.keys(`${KEY}:uid:*`)).length === 0)

  // 情形 2：总开关开启、群开关关闭 —— 该群退出参与，同样不写
  await guardCase({ gsRank: true, groupStatus: 0, isGroup: true })
  check('群开关关闭：不产生任何排行 ZSET 键', store.zsets.size === 0, zsetKeys())

  // 情形 3：私聊不上报（原有口径，一并回归）
  await guardCase({ gsRank: true, groupStatus: 1, isGroup: false })
  check('私聊不上报', store.zsets.size === 0, zsetKeys())

  // 正向对照：两个开关都开时必须真的写，否则上面三条断言没有意义
  await guardCase({ gsRank: true, groupStatus: 1, isGroup: true })
  check('对照：开关全开时写入 ZSET 与 uid 元信息',
    store.zsets.size > 0 && (await scoreOf(0, uid)) != null && !!store.strings.get(uidKeyOf(uid)), zsetKeys())
}

finish()
