/** 版本号与版权行 — 参照 ProfileImg-Plugin components/pluginVersion.js
 *
 *  供帮助图 / 签到报告 / 出图页脚展示插件与框架版本。
 *  框架名按 bot 根 package.json 的包名判定（TRSS-Yunzai 为 `trss-yunzai`，原版为 `yunzai-bot`）；
 *  版本号读不到时**不拼版本**，避免渲染成 `TRSS-Yunzai vTRSS-Yunzai` 这种重复形态。
 */

import fs from 'node:fs'
import path from 'node:path'

/** 插件版本（从插件自己的 package.json 读取） */
const pkgPath = path.join(process.cwd(), 'plugins/Axiu-Plugin', 'package.json')
let pluginVersion = '1.0.0'
try {
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    pluginVersion = pkg.version || '1.0.0'
  }
} catch (e) {
  logger.error('[Axiu-Plugin] 读取版本号失败:', e)
}

const yunzaiPkgPath = path.join(process.cwd(), 'package.json')

/** 框架显示名与版本号 */
let yunzaiName = 'Yunzai-Bot'
let yunzaiVersion = ''
try {
  if (fs.existsSync(yunzaiPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(yunzaiPkgPath, 'utf8'))
    yunzaiName = /trss/i.test(pkg.name || '') ? 'TRSS-Yunzai' : 'Yunzai-Bot'
    yunzaiVersion = pkg.version || ''
  }
} catch (e) { /* 忽略：读不到就用默认名、不显示版本 */ }

/** 出图页脚版权行（模板用 `{{@sys.copyright}}` 注入）
 *  名称与版本号之间必须留空格，否则会渲染成 `Yunzai-Bot3.1.3` 这种贴在一起的形态
 *  @returns {string} 带 `<span class="version">` 的 HTML 片段
 */
export function buildCopyright () {
  const framework = yunzaiVersion ? `${yunzaiName} <span class="version">${yunzaiVersion}</span>` : yunzaiName
  return `Created By ${framework} & Axiu-Plugin <span class="version">${pluginVersion}</span>`
}

/** 纯文本版权行（聊天消息用，不能带 HTML 标签）
 *  @returns {string}
 */
export function buildCopyrightText () {
  const framework = yunzaiVersion ? `${yunzaiName} v${yunzaiVersion}` : yunzaiName
  return `Created By ${framework} & Axiu-Plugin v${pluginVersion}`
}

export { pluginVersion, yunzaiName, yunzaiVersion }
