/**
 * 签到 runner 的失败判定（tool/MihoyoBBSTools/mysSignin_runner.py）
 *
 * 覆盖：依赖把失败写进结果文本、而 status_code 仍为 0 的各类分支——
 * 游戏 429「本次签到失败」、脚本失败/异常、云游戏 -100（国服「token 失效/防沉迷」、
 * 国际服「云原神 token 失效」，命中后依赖会清理对应 cookie）
 *
 * 用假 module-dir 端到端执行 run()，不依赖 MihoyoBBSTools 子模块与网络
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { mod, tmpDir, skip, checker } from './_helper.mjs'

const PY = process.env.AXIU_TEST_PYTHON || 'python'
const probe = spawnSync(PY, ['--version'], { stdio: 'ignore' })
if (probe.error || probe.status !== 0) skip(`缺少可用 python（可用 AXIU_TEST_PYTHON 指定解释器）`)

const { check, finish } = checker()

const workDir = path.join(tmpDir, 'runner-marks')
const modDir = path.join(workDir, 'mod')
fs.rmSync(workDir, { recursive: true, force: true })
fs.mkdirSync(modDir, { recursive: true })
fs.writeFileSync(path.join(modDir, 'config.py'),
  'config_Path = ""\npath = ""\nconfig_prefix = ""\nserverless = False\nconfig = {}\n', 'utf8')
fs.writeFileSync(path.join(modDir, 'error.py'),
  'class CookieError(Exception):\n    pass\n\n\nclass StokenError(Exception):\n    pass\n', 'utf8')
const cfgPath = path.join(workDir, 'user_1.yaml')
fs.writeFileSync(cfgPath, 'account:\n  cookie: test\n', 'utf8')

let seq = 0
/**
 * 用给定结果文本跑一次 runner
 * @returns {{rc: number, ok?: boolean, statusCode?: number, failedMarks?: string[], message?: string, missing?: boolean}}
 */
function runRunner (message, statusCode = 0) {
  const tag = `case-${++seq}`
  fs.writeFileSync(path.join(modDir, 'main.py'),
    `def main():\n    return ${statusCode}, ${JSON.stringify(message)}\n`, 'utf8')
  const resultFile = path.join(workDir, `${tag}.json`)
  const r = spawnSync(PY, [
    mod('tool/MihoyoBBSTools/mysSignin_runner.py'),
    '--config', cfgPath,
    '--module-dir', modDir,
    '--result-file', resultFile
  ], {
    stdio: 'ignore',
    // 必须禁写字节码：连续覆写同一 main.py 时，若两次内容等长且同秒写入，
    // Python 会复用过期 .pyc，导致本用例实际跑的是上一个用例的模块
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
  })
  if (!fs.existsSync(resultFile)) return { rc: r.status, missing: true }
  return { rc: r.status, ...JSON.parse(fs.readFileSync(resultFile, 'utf8')) }
}

console.log('=== 应判为失败：仅文本体现失败、status_code 仍为 0 ===')
const failCases = [
  ['游戏 429（本次签到失败）', '原神：\n123456789，本次签到失败'],
  ['触发验证码导致签到失败', '123456789，触发验证码，本次签到失败'],
  ['云游戏脚本失败', '脚本签到失败，json 文本：{"retcode": -1}'],
  ['云游戏脚本异常', '脚本签到发生异常，请查看日志'],
  ['云游戏 -100（国服文案）', '云神里绫华:\r\ntoken 失效/防沉迷'],
  ['云游戏 -100（国际服文案）', '云原神 token 失效']
]
for (const [label, text] of failCases) {
  const r = runRunner(text, 0)
  console.log(`  ${label}: ok=${r.ok} marks=${JSON.stringify(r.failedMarks)} rc=${r.rc}`)
  check(`${label} → 结果文本与输入一致（防字节码复用导致的假通过）`, r.message === text, JSON.stringify(r.message))
  check(`${label} → ok=false`, r.ok === false, JSON.stringify(r))
  check(`${label} → failedMarks 非空`, Array.isArray(r.failedMarks) && r.failedMarks.length > 0)
  check(`${label} → 退出码 1`, r.rc === 1, String(r.rc))
}

console.log('=== 不应误报：正常成功与空文本 ===')
const okCases = [
  ['正常成功文案', '原神：\n123456789已连续签到3天\n今天获得的奖励是…'],
  ['已签到过（未获得免费时长）', '签到失败，未获得免费时长，可能是已经签到过了或者超出免费时长上限'],
  ['空文本', '']
]
for (const [label, text] of okCases) {
  const r = runRunner(text, 0)
  console.log(`  ${label}: ok=${r.ok} marks=${JSON.stringify(r.failedMarks)}`)
  check(`${label} → ok=true`, r.ok === true, JSON.stringify(r))
  check(`${label} → failedMarks 为空`, Array.isArray(r.failedMarks) && r.failedMarks.length === 0)
}

console.log('=== 回归：status_code 非 0 与 stoken 异常 ===')
{
  const r = runRunner('账号 Stoken 异常', 1)
  check('status_code=1 → ok=false 且退出码 1', r.ok === false && r.rc === 1, JSON.stringify(r))
  check('status_code 如实保留', r.statusCode === 1, String(r.statusCode))
}

try { fs.rmSync(workDir, { recursive: true, force: true }) } catch { /* 忽略清理失败 */ }

finish()
