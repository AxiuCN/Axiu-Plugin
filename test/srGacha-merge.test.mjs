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

finish()
