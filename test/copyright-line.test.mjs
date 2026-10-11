/**
 * 版权行（components/pluginVersion.js）
 *
 * 覆盖：框架名按 bot 根 package.json 的包名判定（含 trss → TRSS-Yunzai，否则 Yunzai-Bot）、
 * 版本号读不到时**不拼版本**（不出现 `TRSS-Yunzai vTRSS-Yunzai`）、名称与版本号之间留空格
 * （不出现 `Yunzai-Bot3.1.3` 这种粘连）、出图版带 `<span class="version">`、聊天版不带 HTML 标签。
 *
 * 注意：两个版本号都按 `process.cwd()` 推导，套件可能在插件目录下运行（此时读不到 bot 根包），
 * 因此断言写成**两种环境都成立**的形式，不写死版本数字。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pluginRoot, importMod, installFrameworkStubs, checker } from './_helper.mjs'

installFrameworkStubs()

const { buildCopyright, buildCopyrightText, pluginVersion, yunzaiName, yunzaiVersion } = await importMod('components/pluginVersion.js')
const { check, finish } = checker()

/** 按同样的规则自行推导期望的框架名（读得到 bot 根包时用于对照） */
const rootPkgPath = path.join(process.cwd(), 'package.json')
let expectedName = null
try {
  if (fs.existsSync(rootPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'))
    expectedName = /trss/i.test(pkg.name || '') ? 'TRSS-Yunzai' : 'Yunzai-Bot'
  }
} catch { /* 读不到就不对照 */ }

const html = buildCopyright()
const text = buildCopyrightText()

console.log(`  框架名=${yunzaiName} 框架版本=${yunzaiVersion || '(空)'} 插件版本=${pluginVersion}`)
console.log(`  出图: ${html}`)
console.log(`  聊天: ${text}`)

check('框架名只可能是 TRSS-Yunzai 或 Yunzai-Bot', ['TRSS-Yunzai', 'Yunzai-Bot'].includes(yunzaiName), String(yunzaiName))
check('框架名与 bot 根包名判定一致（读得到根包时）', expectedName === null || yunzaiName === expectedName,
  `期望 ${expectedName}，实际 ${yunzaiName}`)
check('插件版本取自插件 package.json（读得到时非兜底值）',
  pluginVersion === JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8')).version || pluginVersion === '1.0.0',
  String(pluginVersion))
check('出图版权行带 <span class="version"> 且以 Created By 开头',
  html.startsWith('Created By ') && html.includes(`<span class="version">${pluginVersion}</span>`), html)
check('聊天版权行不含 HTML 标签', !/[<>]/.test(text) && text.startsWith('Created By '), text)
check('名称与版本号不粘连（不会出现 Yunzai-Bot3.1.3 / TRSS-Yunzai3.1.3）',
  !/(TRSS-Yunzai|Yunzai-Bot)\d/.test(html) && !/(TRSS-Yunzai|Yunzai-Bot)\d/.test(text), `${html} | ${text}`)
check('版本号缺失时框架段只有名称（不出现 v+名称 / 重复名）',
  yunzaiVersion ? html.includes(yunzaiVersion) : !/vTRSS-Yunzai|vYunzai-Bot/.test(text),
  `version=${yunzaiVersion || '(空)'}`)

finish()
