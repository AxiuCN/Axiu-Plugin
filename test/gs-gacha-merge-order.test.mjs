/**
 * 原神抽卡合并的排序口径（`apps/gsGachaLog.js` 的 `mergeJson`）
 *
 * 抽卡 id 是 19 位十进制串，超过 Number 安全整数范围：相邻 id 转 Number 后**相等**，
 * 一旦用 `Number(b.id) - Number(a.id)` 排序，稳定排序会保留 Map 插入顺序，
 * 本地旧五星就会排在远端新记录之前，五星间隔与首抽时间随之算错。
 *
 * 覆盖口径：
 * - 直接从源码里取 `mergeJson` 执行（不复制实现，避免测了个假函数）
 * - 长 ID 相邻时新记录在前；远端覆盖本地；去重后单条；不同长度按数值排序
 * - 静态约束：该排序不得再出现 `Number(...)` 相减
 *
 * 不联网、不读真实抽卡数据。
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { checker, pluginRoot } from './_helper.mjs'

const { check, finish } = checker()
const src = fs.readFileSync(path.join(pluginRoot, 'apps', 'gsGachaLog.js'), 'utf8')

/* ==================== 【1】从源码取函数 ==================== */

console.log('【1】mergeJson 从源码提取并执行（不复制实现）')
const start = src.indexOf('function mergeJson (')
check('源码里能找到 mergeJson', start > 0, `index=${start}`)
let mergeJson = null
let extractError = ''
try {
  mergeJson = vm.runInNewContext('(' + src.slice(start) + ')')
} catch (err) {
  extractError = err?.message ?? String(err)
}
check('函数可被求值（提取失败说明源码结构变了，断言会跟着转红）',
  typeof mergeJson === 'function', extractError)

/* ==================== 【2】长 ID 排序 ==================== */

console.log('\n【2】19 位相邻 ID：新记录必须排在旧记录之前')
{
  const oldFive = { id: '1677072070000399578', rank_type: '5', name: 'old-five' }
  const newThree = { id: '1677072070000399579', rank_type: '3', name: 'new-three' }
  const out = mergeJson([oldFive], [newThree, oldFive])
  check('远端新三星排在本地旧五星之前（修复前相反）', out[0]?.id === newThree.id, JSON.stringify(out.map(x => x.id)))
  check('两条都在，未被去重吞掉', out.length === 2, String(out.length))
}
{
  // Number 精度实测：证明这条用例真的踩在精度边界上
  check('前提成立：两个 19 位 ID 转 Number 后相等',
    Number('1677072070000399578') === Number('1677072070000399579'))
}

/* ==================== 【3】去重与覆盖规则不变 ==================== */

console.log('\n【3】去重、远端覆盖、不同长度排序')
{
  const out = mergeJson([{ id: '2', name: 'local' }], [{ id: '2', name: 'remote' }])
  check('同 id 只留一条', out.length === 1, String(out.length))
  check('远端覆盖本地（字段取远端）', out[0]?.name === 'remote', String(out[0]?.name))
}
{
  const out = mergeJson([{ id: '9' }], [{ id: '10' }])
  check('不同长度按数值降序（10 在 9 之前，而非字符串序）', out[0]?.id === '10', JSON.stringify(out.map(x => x.id)))
}
{
  const out = mergeJson([], [])
  check('空输入返回空数组', Array.isArray(out) && out.length === 0)
}
{
  const out = mergeJson([{ id: '3' }], [{ id: '1' }, { id: '2' }])
  check('多条按降序排列', out.map(x => x.id).join(',') === '3,2,1', out.map(x => x.id).join(','))
}

/* ==================== 【4】静态约束 ==================== */

console.log('\n【4】静态约束：排序不得再用 Number 相减')
// 取函数体（到行首的 `}` 为止），避免把文件里其它函数算进来
const afterStart = src.slice(start)
const funcEnd = afterStart.indexOf('\n}')
const mergeBody = funcEnd > 0 ? afterStart.slice(0, funcEnd) : afterStart
check('取到了 mergeJson 函数体', /\.sort\(/.test(mergeBody), mergeBody.slice(0, 80))
check('sort 不再使用 Number(...) 相减', !/Number\s*\(/.test(mergeBody))
check('sort 使用字符串数值比较（localeCompare + numeric）',
  /localeCompare\([\s\S]{0,120}?numeric:\s*true/.test(mergeBody))

finish()