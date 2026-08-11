/** 版本号读取 — 参照 LinkFlow/ProfileImg components/pluginVersion.js
 *  供帮助模板等展示插件与 Yunzai 版本
 */

import fs from 'node:fs'
import path from 'node:path'

/** 插件版本（从 package.json 读取） */
const pkgPath = path.join(process.cwd(), 'plugins/Axiu-Plugin', 'package.json')
let pluginVersion = '1.0.0'
try {
  if (fs.existsSync(pkgPath)) {
    pluginVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '1.0.0'
  }
} catch (e) {
  logger.error('[Axiu-Plugin] 读取版本号失败:', e)
}

/** Yunzai 版本（从 Bot 根目录 package.json 读取） */
const yunzaiPkgPath = path.join(process.cwd(), 'package.json')
let yunzaiVersion = 'TRSS-Yunzai'
try {
  if (fs.existsSync(yunzaiPkgPath)) {
    yunzaiVersion = JSON.parse(fs.readFileSync(yunzaiPkgPath, 'utf8')).version || 'TRSS-Yunzai'
  }
} catch (e) { /* 忽略 */ }

export { pluginVersion, yunzaiVersion }
