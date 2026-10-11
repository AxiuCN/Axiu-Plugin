/**
 * 星铁抽卡记录合并（model/srGacha.js `appendNewRecordsToGenuinePool`）
 *
 * 覆盖：首次出五星的窗口扣除、十连同秒尾段、远端更旧五星的重叠窗口、
 *       重复同步幂等、文件新旧方向、UTC+8 占位时间（第二轮回归）
 */
import { importMod, requireFile, installFrameworkStubs, checker } from './_helper.mjs'

installFrameworkStubs()
requireFile('model/srGacha.js')

const { appendNewRecordsToGenuinePool } = await importMod('model/srGacha.js')
const { check, finish } = checker()

const UID = '100000001'
const TYPE = 11
const BASE_ID = 1789143000000000000n
let seq = 0
const nextId = () => String(BASE_ID + BigInt(++seq))

/** 本地（导入）记录 */
const rec = (name, time, rank = '3') => ({
  id: nextId(),
  uid: UID,
  name,
  item_type: rank === '5' ? '角色' : '光锥',
  rank_type: rank,
  gacha_type: String(TYPE),
  time
})

/** 接口返回的五星条目 */
const apiStar = (name, time, gachaCount) => ({
  id: nextId(),
  item: { name, item_type: 'ItemType_Avatar' },
  time,
  gacha_count: gachaCount
})

const isFiller = (r) => r.name === '占位记录'
const countFillers = (arr, time) => arr.filter(r => isFiller(r) && (!time || r.time === time)).length
const countStars = (arr) => arr.filter(r => String(r.rank_type) === '5').length

/** 20 条真实三星记录（时间递增，2026-09-01 起） */
function localTwenty () {
  const out = []
  for (let i = 0; i < 20; i++) {
    const day = String(1 + Math.floor(i / 3)).padStart(2, '0')
    const hh = String(9 + (i % 3) * 4).padStart(2, '0')
    out.push(rec(`真实三星${i + 1}`, `2026-09-${day} ${hh}:00:00`))
  }
  return out
}

console.log('=== 首次出五星：已记录 20 抽、首个五星为第 25 抽（第三轮 P2-1 场景 A）===')
{
  const local = localTwenty()
  const newestFirst = [...local].reverse()
  const star = apiStar('符玄', '2026-09-27 22:40:00', 25)

  const r1 = appendNewRecordsToGenuinePool({ prevRecords: newestFirst, fiveStars: [star], pity: 0, uid: UID, type: TYPE })
  console.log(`  合并后 ${r1.records.length} 条（占位 ${countFillers(r1.records)}，五星 ${countStars(r1.records)}）`)
  check('合并为 25 条（修复前 45 条）', r1.records.length === 25, `实际 ${r1.records.length}`)
  check('仅补 4 条占位（24 − 已记录 20）', countFillers(r1.records) === 4, `实际 ${countFillers(r1.records)}`)
  check('原 20 条真实记录逐条保留', local.every(l => r1.records.some(x => x.id === l.id)))
  check('新五星已写入且带上间隔数', r1.records.some(r => r.name === '符玄' && r.gacha_count === 25))

  const r2 = appendNewRecordsToGenuinePool({ prevRecords: r1.records, fiveStars: [star], pity: 0, uid: UID, type: TYPE })
  check('重复同步相同数据仍为 25 条', r2.records.length === 25, `实际 ${r2.records.length}`)

  const r3 = appendNewRecordsToGenuinePool({ prevRecords: r1.records, fiveStars: [star], pity: 3, uid: UID, type: TYPE })
  console.log(`  再增加 3 抽当前垫抽 → ${r3.records.length} 条`)
  check('再增加 3 抽当前垫抽 → 28 条', r3.records.length === 28, `实际 ${r3.records.length}`)
}

console.log('=== 十连同秒：9 条尾段记录（第三轮 P2-1 场景 B）===')
{
  const batchTime = '2026-09-27 22:40:00'
  const five = rec('符玄', batchTime, '5')
  const tail = []
  for (let i = 0; i < 9; i++) tail.push(rec(`真实三星${i + 1}`, batchTime))
  const newestFirst = [...tail, five] // 新在前：9 条三星在五星之前（= 五星之后所抽）
  const star = { ...apiStar('符玄', batchTime, 9), id: five.id }

  const r = appendNewRecordsToGenuinePool({ prevRecords: newestFirst, fiveStars: [star], pity: 9, uid: UID, type: TYPE })
  console.log(`  合并后 ${r.records.length} 条（占位 ${countFillers(r.records)}）`)
  check('同秒尾段被正确计入 → 保持 10 条（修复前 19 条）', r.records.length === 10, `实际 ${r.records.length}`)
}

console.log('=== 远端同时返回更旧五星（重叠窗口识别）===')
{
  const newestFirst = [...localTwenty()].reverse()
  const star = apiStar('符玄', '2026-09-27 22:40:00', 25)
  const oldStar = apiStar('旧五星', '2026-08-01 10:00:00', 12)

  const r = appendNewRecordsToGenuinePool({ prevRecords: newestFirst, fiveStars: [star, oldStar], pity: 0, uid: UID, type: TYPE })
  console.log(`  合并后 ${r.records.length} 条（新五星间隔占位 ${countFillers(r.records, '2026-09-27 22:40:00')}，旧五星间隔占位 ${countFillers(r.records, '2026-08-01 10:00:00')}）`)
  check('合并为 37 条（11 + 旧五星 + 24 + 新五星）', r.records.length === 37, `实际 ${r.records.length}`)
  check('新五星间隔只补 4 条（已扣除本地 20）', countFillers(r.records, '2026-09-27 22:40:00') === 4)
  check('旧五星间隔补满 11 条（其前无本地记录，不误扣）', countFillers(r.records, '2026-08-01 10:00:00') === 11)
  check('两个五星都在结果中', r.records.some(x => x.name === '符玄') && r.records.some(x => x.name === '旧五星'))
}

console.log('=== 文件方向：旧在前保存时计数一致 ===')
{
  const oldestFirst = localTwenty()
  const star = apiStar('符玄', '2026-09-27 22:40:00', 25)

  const r = appendNewRecordsToGenuinePool({ prevRecords: oldestFirst, fiveStars: [star], pity: 0, uid: UID, type: TYPE })
  const times = r.records.map(x => x.time)
  console.log(`  order=${r.order} 记录数 ${r.records.length}`)
  check('识别为旧在前', r.order === 'oldest', r.order)
  check('旧在前同样合并为 25 条', r.records.length === 25, `实际 ${r.records.length}`)
  check('旧在前保持时间单调不减', times.every((t, i) => i === 0 || times[i - 1] <= t))
}

console.log('=== 第二轮回归：无五星差额补数与 UTC+8 占位时间 ===')
{
  const local = localTwenty()
  const newestFirst = [...local].reverse()

  const same = appendNewRecordsToGenuinePool({ prevRecords: newestFirst, fiveStars: [], pity: 20, uid: UID, type: TYPE })
  check('垫抽与本地记录一致时不追加', same.records.length === 20, `实际 ${same.records.length}`)
  check('原记录逐字节保留', JSON.stringify(same.records) === JSON.stringify(newestFirst))

  const r1 = appendNewRecordsToGenuinePool({ prevRecords: newestFirst, fiveStars: [], pity: 25, uid: UID, type: TYPE })
  console.log(`  垫抽 25 差额补数 → ${r1.records.length} 条`)
  check('垫抽差额 5 → 补 5 条', r1.records.length === 25, `实际 ${r1.records.length}`)

  const r2 = appendNewRecordsToGenuinePool({ prevRecords: r1.records, fiveStars: [], pity: 25, uid: UID, type: TYPE })
  check('再次同步不增长（幂等）', r2.records.length === 25, `实际 ${r2.records.length}`)

  const pad = r1.records.find(isFiller)
  const padMs = Date.parse(`${pad.time.replace(' ', 'T')}+08:00`)
  console.log(`  占位时间 ${pad.time}`)
  check('占位时间按 UTC+8 生成（与本地当前时刻相差 < 1 小时）', Math.abs(Date.now() - padMs) < 3600 * 1000, `${pad.time}`)
}

console.log('=== 第二轮回归：已有五星 + 新增五星的幂等性 ===')
{
  const local = [
    rec('真实三星X', '2026-09-20 10:00:00'),
    rec('真实五星旧', '2026-09-19 10:00:00', '5'),
    rec('真实三星Y', '2026-09-18 10:00:00')
  ]
  const newStar = apiStar('真实五星新', '2026-09-27 22:40:00', 8)
  const knownStar = apiStar('真实五星旧', '2026-09-19 10:00:00', 5)

  const r1 = appendNewRecordsToGenuinePool({ prevRecords: local, fiveStars: [newStar, knownStar], pity: 3, uid: UID, type: TYPE })
  console.log(`  第一次 ${r1.records.length} 条（added=${r1.added}）`)
  check('追加 1 个新五星', r1.added === 1)
  check('新五星间隔扣除已记录的 1 抽（8−1−1）', countFillers(r1.records, '2026-09-27 22:40:00') === 6)

  const r2 = appendNewRecordsToGenuinePool({ prevRecords: r1.records, fiveStars: [newStar, knownStar], pity: 3, uid: UID, type: TYPE })
  check('再次同步不增长（幂等）', r2.records.length === r1.records.length, `${r1.records.length} → ${r2.records.length}`)
}

console.log('=== 第四轮 #2：十连同秒的同名五星不能被整类压掉 ===')
{
  const star = { ...rec('黄泉', '2026-09-05 10:00:00', '5'), id: 'import-star-1' }
  const local = [star, rec('真实三星1', '2026-09-04 09:00:00')]
  // 同一秒两个同名五星（十连双黄），都晚于本地最新五星
  const twins = [apiStar('黄泉', '2026-09-05 11:00:00', 5), apiStar('黄泉', '2026-09-05 11:00:00', 15)]
  const out = appendNewRecordsToGenuinePool({ prevRecords: local, fiveStars: twins, pity: 2, uid: UID, type: TYPE })
  const named = out.records.filter(r => r.name === '黄泉' && String(r.rank_type) === '5')
  check('同秒同名两个五星都记为新增（旧实现只记 1 条）', out.added === 2, `added=${out.added}`)
  check('池内该名五星共 3 条（1 条导入 + 2 条新增）', named.length === 3, String(named.length))

  // 幂等：同样的两条再来一次（换新 id，走「名称|秒级时间」按条数消费）
  const again = twins.map(t => ({ ...t, id: String(BigInt(t.id) + 1000n) }))
  const out2 = appendNewRecordsToGenuinePool({ prevRecords: out.records, fiveStars: again, pity: 2, uid: UID, type: TYPE })
  check('再同步（id 不同、名称时间相同）不重复记入', out2.added === 0, `added=${out2.added}`)

  const out3 = appendNewRecordsToGenuinePool({ prevRecords: out.records, fiveStars: twins, pity: 2, uid: UID, type: TYPE })
  check('再同步（同一批对象，同源 id 命中）不重复记入', out3.added === 0, `added=${out3.added}`)
}

console.log('=== 第四轮 #3：新五星必须按时间归并，不能整段前置 ===')
{
  const star = { ...rec('黄泉', '2026-09-05 10:00:00', '5'), id: 'import-star-2' }
  const local = [
    star,
    rec('真实三星1', '2026-09-04 09:00:00'),
    rec('真实三星2', '2026-09-03 09:00:00'),
    rec('真实三星3', '2026-09-02 09:00:00')
  ]
  // 同步①：接口没有新五星（只有本地已有的那条），仅按垫抽差补占位——占位时间 = 现在
  const r1 = appendNewRecordsToGenuinePool({
    prevRecords: local,
    fiveStars: [apiStar('黄泉', '2026-09-05 10:00:00', 25)],
    pity: 5,
    uid: UID,
    type: TYPE
  })
  check('同步①：无新五星，只补垫抽占位', r1.added === 0 && countFillers(r1.records) >= 2, `added=${r1.added} fillers=${countFillers(r1.records)}`)

  // 同步②：接口这次才带回一个新五星 银狼(11:30)——晚于本地最新五星(10:00)，但早于①留下的占位（时间=现在）
  const r2 = appendNewRecordsToGenuinePool({
    prevRecords: r1.records,
    fiveStars: [apiStar('银狼', '2026-09-05 11:30:00', 10)],
    pity: 6,
    uid: UID,
    type: TYPE
  })
  const idxSilver = r2.records.findIndex(r => r.name === '银狼')
  const idxPadding = r2.records.findIndex(r => isFiller(r) && r.time > '2026-09-06 00:00:00')
  const idxOld = r2.records.findIndex(r => r.name === '黄泉')
  console.log(`  顺序: 银狼@${idxSilver} 落在 旧占位@${idxPadding} 与 黄泉@${idxOld} 之间`)
  check('新增五星插在时间正确的位置（旧占位 > 银狼 11:30 > 黄泉 10:00）',
    idxSilver > idxPadding && idxOld > idxSilver, `${idxPadding}/${idxSilver}/${idxOld}`)

  let inverted = null
  for (let i = 1; i < r2.records.length; i++) {
    if (String(r2.records[i - 1].time) < String(r2.records[i].time)) {
      inverted = `${i - 1}:${r2.records[i - 1].time} < ${i}:${r2.records[i].time}`
      break
    }
  }
  check('合并后数组按时间非递增（消费者按数组顺序累计才正确）', inverted === null, String(inverted))
  check('五星总数仍为 2（未重复、未丢失）', countStars(r2.records) === 2, String(countStars(r2.records)))
}

finish()
