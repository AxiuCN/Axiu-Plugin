/**
 * 原神排行综合排序与 UID 元信息并发（model/gsChallengeRank.js）
 *
 * 覆盖：
 * - 剧诗权重阶梯：「用时优先于借出」，低优先级项不得越级（第三轮 P2-5）
 * - 深渊首查时间窗口：月期 28~31 天仍保序，且星数/层数不被时间与战斗反超（第三轮 P2-6）
 * - 定向重置与上报交错：不覆盖其他玩法刚写入的明细（第三轮 P2-2）
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
const { check, finish } = checker()

const KEY = 'Axiu:gsAbyss:rank' // 键格式与 AGENTS.md 记录一致
const SID = '1001'
const compoundKey = (ct) => `${KEY}:${ct}:__:${SID}`
const scoreOf = (ct, uid) => redis.zScore(compoundKey(ct), uid)
const waitUntil = async (fn, timeoutMs = 3000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return true
    await new Promise(r => setTimeout(r, 5))
  }
  return false
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

console.log('=== P2-5 剧诗：用时优先于借出 ===')
{
  const A = '100000001'
  const B = '100000002'
  await Gs.report(A, '10001', '123', 1, roleData({ useTime: 500, rent: 0 }), SID)
  await Gs.report(B, '10001', '123', 1, roleData({ useTime: 501, rent: 2 }), SID)
  const sa = await scoreOf(1, A)
  const sb = await scoreOf(1, B)
  console.log(`  500秒/借出0 = ${sa}；501秒/借出2 = ${sb}`)
  check('500 秒 / 借出 0 次 高于 501 秒 / 借出 2 次', sa > sb, `${sa} vs ${sb}`)

  const C = '100000003'
  await Gs.report(C, '10001', '123', 1, roleData({ useTime: 500, rent: 3 }), SID)
  check('用时相同时借出多者在前', (await scoreOf(1, C)) > sa)
}

console.log('=== P2-5 反超守卫：低优先级取极值也不得越级 ===')
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

console.log('=== P2-6 深渊：月期后段仍按首查时间排序 ===')
{
  /** 预置 slot（含自定义首次查询时间），再用同样成绩上报以保留 firstTime */
  const reportAbyss = async (uid, { star = 3, battles = 20, elapsedDays = 0 }) => {
    const firstTs = (ABYSS_START + elapsedDays * 86400) * 1000
    store.strings.set(`${KEY}:uid:${uid}`, JSON.stringify({
      qq: '10001',
      0: { [SID]: { scores: { floor: 123, star }, extra: {}, firstTime: firstTs, startTs: ABYSS_START, time: Date.now() } }
    }))
    await Gs.report(uid, '10001', '123', 0, abyssData({ star, battles }), SID)
    return scoreOf(0, uid)
  }

  const A = '100002001'
  const B = '100002002'
  const sa = await reportAbyss(A, { elapsedDays: 21, battles: 20 })
  const sb = await reportAbyss(B, { elapsedDays: 22, battles: 10 })
  console.log(`  21 天/战斗20 = ${sa}；22 天/战斗10 = ${sb}`)
  check('开赛后 21 天仍优先于 22 天（战斗更多也不被反超）', sa > sb, `${sa} vs ${sb}`)

  console.log('  赛季跨度 28~31 天逐日检查：')
  let spanOk = true
  for (const d of [28, 29, 30, 31]) {
    store.strings.clear()
    store.zsets.clear()
    const early = '100003001'
    const late = '100003002'
    const s1 = await reportAbyss(early, { elapsedDays: d, battles: 20 })
    const s2 = await reportAbyss(late, { elapsedDays: d + 1, battles: 10 })
    const ok = s1 > s2
    if (!ok) spanOk = false
    console.log(`    ${d} 天 vs ${d + 1} 天: ${s1} vs ${s2} → ${ok ? '保序' : '失序'}`)
  }
  check('28/29/30/31 天均不提前失去时间顺序', spanOk)
}

console.log('=== P2-6 反超守卫：星数/层数优先，同时刻比战斗 ===')
{
  store.strings.clear()
  store.zsets.clear()
  const reportAbyss = async (uid, { floor = '12-3', star = 3, battles = 20, elapsedDays = 0 }) => {
    const firstTs = (ABYSS_START + elapsedDays * 86400) * 1000
    store.strings.set(`${KEY}:uid:${uid}`, JSON.stringify({
      qq: '10001',
      0: { [SID]: { scores: {}, extra: {}, firstTime: firstTs, startTs: ABYSS_START, time: Date.now() } }
    }))
    await Gs.report(uid, '10001', '123', 0, abyssData({ floor, star, battles }), SID)
    return scoreOf(0, uid)
  }

  const hiStar = await reportAbyss('100004001', { star: 3, battles: 99, elapsedDays: 31 })
  const loStar = await reportAbyss('100004002', { star: 2, battles: 0, elapsedDays: 0 })
  console.log(`  3星/末段查询/99战 = ${hiStar}；2星/首日查询/0战 = ${loStar}`)
  check('更高星数优先于任何时间差与战斗差', hiStar > loStar, `${hiStar} vs ${loStar}`)

  const hiFloor = await reportAbyss('100004003', { floor: '12-3', star: 0, battles: 99, elapsedDays: 31 })
  const loFloor = await reportAbyss('100004004', { floor: '11-3', star: 3, battles: 0, elapsedDays: 0 })
  check('更高层数优先于任何星数/时间/战斗差', hiFloor > loFloor, `${hiFloor} vs ${loFloor}`)

  const fewer = await reportAbyss('100004005', { battles: 10, elapsedDays: 5 })
  const more = await reportAbyss('100004006', { battles: 20, elapsedDays: 5 })
  check('查询时间相同时按战斗次数少者优先', fewer > more, `${fewer} vs ${more}`)
}

console.log('=== P2-2 定向重置与上报交错 ===')
{
  store.strings.clear()
  store.zsets.clear()
  const uid = '100005001'
  const uidKey = `${KEY}:uid:${uid}`
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

  // 2) 类型 1 的上报与重置交错（按报告建议：先保存 Promise，再释放暂停点）
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

finish()
