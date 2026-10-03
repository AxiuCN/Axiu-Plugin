/**
 * 套件运行器：顺序跑 test/ 下全部 <主题>.test.mjs，聚合结果
 *
 * 用法（任意 cwd）：
 *   node test/run.mjs                 # 跑全部
 *   node test/run.mjs --filter=merge  # 只跑文件名含 merge 的
 *   node test/run.mjs --list          # 只列清单
 *   pnpm test                         # package.json 里的快捷方式
 *
 * 退出码：有任一失败 → 1；全部通过或跳过 → 0
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
/** bot 根目录（app/）：子进程 cwd 钉在这里，与生产一致（部分 model 按 cwd 解析插件内路径） */
const appRoot = path.resolve(testDir, '../..')

const args = process.argv.slice(2)
const filterArg = args.find(a => a.startsWith('--filter='))
const filter = filterArg ? filterArg.slice('--filter='.length) : ''
const listOnly = args.includes('--list')

const files = fs.readdirSync(testDir)
  .filter(f => f.endsWith('.test.mjs'))
  .filter(f => !filter || f.includes(filter))
  .sort()

if (!files.length) {
  console.log(filter ? `没有匹配 --filter=${filter} 的套件` : 'test/ 下没有 *.test.mjs')
  process.exit(0)
}

if (listOnly) {
  for (const f of files) console.log(f)
  process.exit(0)
}

/** 跑一个套件，返回 { file, code, output } */
function runOne (file) {
  return new Promise((resolve) => {
    const cp = spawn(process.execPath, [path.join(testDir, file)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: appRoot
    })
    let output = ''
    cp.stdout.on('data', d => { output += d })
    cp.stderr.on('data', d => { output += d })
    cp.on('close', code => resolve({ file, code, output }))
  })
}

const results = []
for (const file of files) {
  process.stdout.write(`\n===== ${file} =====\n`)
  const r = await runOne(file)
  // 套件输出直接透传，便于定位失败断言
  process.stdout.write(r.output)
  const skipped = /⏭ 跳过/.test(r.output)
  const summary = (r.output.match(/结果：通过 (\d+) \/ 失败 (\d+)/) || [])
  results.push({
    ...r,
    skipped,
    summary: summary[2] !== undefined ? `通过 ${summary[1]} / 失败 ${summary[2]}` : ''
  })
}

console.log('\n================ 汇总 ================')
let failed = 0
for (const r of results) {
  const state = r.code === 0 ? (r.skipped ? '跳过' : '通过') : '失败'
  if (r.code !== 0) failed++
  console.log(`${state.padEnd(4)} ${r.file.padEnd(32)} ${r.summary || (r.skipped ? '（缺前置）' : `exit=${r.code}`)}`)
}
console.log(`\n共 ${results.length} 个套件：通过 ${results.filter(r => r.code === 0 && !r.skipped).length}｜跳过 ${results.filter(r => r.skipped).length}｜失败 ${failed}`)
process.exit(failed ? 1 : 0)
