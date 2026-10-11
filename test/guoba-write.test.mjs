/**
 * 锅巴配置读写：值序列化 / 写前验证 / 原子替换 / 群规则往返 / 坏配置救回
 *
 * 走的是生产那套 `getConfigData` / `setConfigData`，只把配置目录重定向到 `test/.test-tmp`
 * （`AXIU_CONFIG_DIR`），仓库里的 `config/` 一个字节都不碰。
 */
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { checker, importMod, installFrameworkStubs, pluginRoot, requireFile, tmpDir } from './_helper.mjs'

installFrameworkStubs()

/** 日志收集：断言「读不出来」的错误文案里不带配置行原文（口令泄露那条路） */
const logs = []
globalThis.logger.error = (...args) => logs.push(args.map(String).join(' '))
globalThis.logger.warn = (...args) => logs.push(args.map(String).join(' '))

for (const rel of [
  'defSet/config.yaml',
  'config/config.yaml.example',
  'config/group_config.yaml.example',
  'config/MihoyoBBSTools_config.yaml.example'
]) requireFile(rel)

/* ---------------- 重定向到临时目录 ---------------- */
const cfgDir = path.join(tmpDir, 'guoba-cfg')
fs.rmSync(cfgDir, { recursive: true, force: true })
fs.mkdirSync(cfgDir, { recursive: true })
for (const name of ['config.yaml.example', 'group_config.yaml.example', 'MihoyoBBSTools_config.yaml.example']) {
  fs.copyFileSync(path.join(pluginRoot, 'config', name), path.join(cfgDir, name))
}
process.env.AXIU_CONFIG_DIR = cfgDir

const { supportGuoba } = await importMod('guoba/index.js')
const { getPluginConfig, validateRendered, yamlValue } = await importMod('components/config.js')

const cfgPath = path.join(cfgDir, 'config.yaml')
const groupPath = path.join(cfgDir, 'group_config.yaml')
const templatePath = path.join(pluginRoot, 'defSet', 'config.yaml')

const panel = () => supportGuoba().configInfo
const Result = {
  ok: (data, msg) => ({ status: 'ok', msg }),
  error: msg => ({ status: 'error', msg })
}
/** 读不回来时给空对象：断言该红就红，套件不因为读崩而中断 */
const readCfg = () => {
  try { return YAML.parse(fs.readFileSync(cfgPath, 'utf8')) || {} } catch { return {} }
}
const readGroup = () => {
  try { return YAML.parse(fs.readFileSync(groupPath, 'utf8')) || {} } catch { return {} }
}
const commentLines = file => fs.readFileSync(file, 'utf8').split('\n').filter(l => /^\s*#/.test(l)).join('\n')
const save = data => panel().setConfigData(data, { Result })

const { check, finish } = checker()

console.log('【1】值 → YAML 字面量：危险值都写得出、读得回')
for (const [label, value] of [
  ['以 * 开头的 cron', '*/30 * * * * ?'],
  ['含 # 的值', 'appkey=abc&referer=https://x/#frag'],
  ['含 : 的值', 'appkey=abc: def'],
  ['含双引号的值', '他说"你好"'],
  ['多行 HTML', '<div>a</div>\n<div>b</div>'],
  ['空串', ''],
  ['看起来像数字的字符串', '12345']
]) {
  let parsed
  try {
    parsed = YAML.parse(`k: ${yamlValue(value)}`)?.k
  } catch (err) {
    parsed = `解析失败：${err.message}`
  }
  check(`${label} 原样读回（且仍是字符串）`, parsed === value && typeof parsed === 'string')
}
check('数字与布尔不加引号（类型不漂）', yamlValue(3000) === '3000' && yamlValue(false) === 'false')
check('裸写以 * 开头的值确实会炸（这条闸不是多余的）', (() => {
  try { YAML.parse('k: */30 * * * * ?'); return false } catch { return true }
})())

console.log('\n【2】端到端保存：通配符 cron / 特殊字符 / 多行值')
let data = panel().getConfigData()
check('面板读到参考默认值（config.yaml 还没生成）', data['api.type'] === 0 && data['signin.schedule'] === '0 0 5 * * ? *')
data['signin.schedule'] = '*/30 * * * * ?'
data['signin.refreshSchedule'] = '0 30 4 * * ? *'
data['api.query'] = 'itemid=34&referer=https://webstatic.mihoyo.com/#tab'
data['api.key'] = 'appkey=abc: def'
/* 面板控件本身是单行输入，但手改请求可能带换行：值必须能安全写成一行字面量 */
data['api.resquery'] = 'action=1\nline2'
let res = await save(data)
check('保存成功', res.status === 'ok', res.msg)
check('文件能被解析回来', (() => { try { readCfg(); return true } catch { return false } })())
check('通配符 cron 原样落盘', readCfg().signin?.schedule === '*/30 * * * * ?')
check('含 # 与 : 的值原样落盘', readCfg().api?.query === 'itemid=34&referer=https://webstatic.mihoyo.com/#tab' && readCfg().api?.key === 'appkey=abc: def')
check('带换行的值解析回来仍是两行', readCfg().api?.resquery === 'action=1\nline2')
check('插件侧读到的是新值', getPluginConfig().signin.schedule === '*/30 * * * * ?')
check('注释骨架与模板一致（渲染保注释）', commentLines(cfgPath) === commentLines(templatePath))
check('行数与模板一致（带换行的值没撑破骨架）', fs.readFileSync(cfgPath, 'utf8').split('\n').length === fs.readFileSync(templatePath, 'utf8').split('\n').length)

console.log('\n【3】表单没提交的键：沿用文件当前值，不写空串')
data = panel().getConfigData()
check('面板读到了刚存的值', data['api.key'] === 'appkey=abc: def')
delete data['api.key']
res = await save(data)
check('只改别处也能保存成功', res.status === 'ok', res.msg)
check('没提交的键保持原值', readCfg().api?.key === 'appkey=abc: def')

console.log('\n【4】写前验证：好文本放行、坏文本与对不上的值被拒')
check('好文本通过', validateRendered(`k: ${yamlValue('v')}\n`, { k: 'v' }).ok === true)
const aliasBad = validateRendered('k: */30 * * * * ?\n', { k: '*/30 * * * * ?' })
check('非法 YAML 被拒并给出原因', aliasBad.ok === false && !!aliasBad.parseError)
const mismatch = validateRendered('k: "other"\n', { k: 'want' })
check('值对不上被拒并列出字段名', mismatch.ok === false && mismatch.invalid.includes('k'))
check('错误文案里不带配置行原文', !String(aliasBad.parseError).includes('*/30 * * * * ?'))

console.log('\n【5】群规则：映射格式不被丢、数组格式保持数组、非法输入不许静默清空')
fs.writeFileSync(groupPath, 'groups:\n  "123456":\n    whitelistAnswers:\n      - 答案一\n    blacklistAnswers:\n      - 广告\n', 'utf8')
data = panel().getConfigData()
check('映射格式读成面板行', Array.isArray(data.groups) && data.groups.length === 1 && data.groups[0]?.groupId === '123456')
check('白/黑名单逐条读出来', data.groups?.[0]?.whitelistAnswers?.[0] === '答案一' && data.groups?.[0]?.blacklistAnswers?.[0] === '广告')
res = await save(data)
check('无改动往返也保存成功', res.status === 'ok', res.msg)
check('写回仍是映射格式', !Array.isArray(readGroup().groups) && readGroup().groups?.['123456']?.blacklistAnswers?.[0] === '广告')

fs.writeFileSync(groupPath, 'groups:\n  - groupId: 654321\n    whitelistAnswers:\n      - 甲\n    blacklistAnswers: []\n', 'utf8')
data = panel().getConfigData()
check('数组格式读成面板行', data.groups?.[0]?.groupId === '654321' && data.groups?.[0]?.whitelistAnswers?.[0] === '甲')
res = await save(data)
check('写回仍是数组格式', Array.isArray(readGroup().groups) && readGroup().groups?.[0]?.groupId === '654321')

const groupBefore = fs.readFileSync(groupPath, 'utf8')
res = await save({ ...data, groups: 'not-an-array' })
check('非数组被拒', res.status === 'error' && /群规则必须是数组/.test(res.msg))
check('被拒时群配置零改动', fs.readFileSync(groupPath, 'utf8') === groupBefore)

res = await save({ ...data, groups: [{ groupId: '', whitelistAnswers: ['x'], blacklistAnswers: [] }] })
check('全是空群号被拒（不许静默清空）', res.status === 'error' && /没有有效的群号/.test(res.msg))
check('再次被拒时群配置仍零改动', fs.readFileSync(groupPath, 'utf8') === groupBefore)

data = panel().getConfigData()
res = await save({ ...data, groups: [...data.groups, { groupId: '   ', whitelistAnswers: [], blacklistAnswers: [] }] })
check('混着空行的保存成功并点明忽略了几行', res.status === 'ok' && /已忽略 1 行/.test(res.msg))
check('有效行仍写回', Array.isArray(readGroup().groups) && readGroup().groups?.[0]?.groupId === '654321')

console.log('\n【6】坏配置：面板照常打开、保存能救回、回执点明、文案不泄露口令')
fs.writeFileSync(cfgPath, 'api:\n  key: "PLAINTEXT_SECRET\n', 'utf8')
logs.length = 0
data = panel().getConfigData()
check('读不出来时面板照常返回字段', data['api.type'] !== undefined && data['signin.schedule'] !== undefined)
check('读不出来的告警进了日志', logs.some(l => /读取配置失败/.test(l)))
check('日志里没有配置行原文', !logs.join('\n').includes('PLAINTEXT_SECRET'))
res = await save(data)
check('坏配置仍能保存救回', res.status === 'ok', res.msg)
check('回执点明其余键按参考默认值重写', /参考默认值重写/.test(res.msg || ''))
check('回执里没有配置行原文', !String(res.msg).includes('PLAINTEXT_SECRET'))
check('救回后文件可解析', (() => { try { readCfg(); return true } catch { return false } })())

console.log('\n【7】落盘方式：临时文件不留残渣')
check('没有 .config.tmp.*.yaml 残留', fs.readdirSync(cfgDir).filter(f => f.startsWith('.config.tmp.')).length === 0)

finish()
