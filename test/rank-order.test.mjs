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
import { importMod, installFrameworkStubs, checker } from './_helper.mjs'

// 写前钩子：只暂停「第一次对 uid 键的写入」，用于制造确定的交错（仅交错用例会启用）
let armed = false
let heldOnce = false
let releaseHold = null
const beforeWrite = async (key) => {
  if (!armed || heldOnce || !String(key).includes(':uid:')) return
  heldOnce = true
  await new Promise(resolve => { releaseHold = resolve })
}

const store = installFrameworkStubs({ beforeWrite })

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

finish()
