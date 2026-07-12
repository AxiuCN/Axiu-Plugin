/** 签到文件日志
 *  - 写入 pluginRoot/log/signin-{date}.log
 *  - 首次写入时清理 7 天前的旧日志
 *  - Python 签到详细输出写到此日志，不在云崽运行日志中刷屏
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.join(__dirname, '..')
const LOG_DIR = path.join(pluginRoot, 'log')

let _cleaned = false

/** 确保日志目录存在 */
function ensureLogDir () {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true })
  }
}

/** 清理 7 天前的旧日志（每个会话只执行一次）*/
function cleanOldLogs () {
  if (_cleaned) return
  _cleaned = true
  const now = Date.now()
  const sevenDays = 7 * 24 * 60 * 60 * 1000
  try {
    if (!fs.existsSync(LOG_DIR)) return
    for (const file of fs.readdirSync(LOG_DIR)) {
      if (!file.startsWith('signin-') || !file.endsWith('.log')) continue
      const filePath = path.join(LOG_DIR, file)
      const stat = fs.statSync(filePath)
      if (now - stat.mtimeMs > sevenDays) {
        fs.unlinkSync(filePath)
      }
    }
  } catch { /* 清理失败不影响签到功能 */ }
}

/**
 * 写入一行签到日志到当日文件
 * @param {string} text - 日志内容
 */
export function writeSigninLog (text) {
  ensureLogDir()
  cleanOldLogs()
  const today = new Date().toISOString().slice(0, 10)
  const logPath = path.join(LOG_DIR, `signin-${today}.log`)
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
  fs.appendFileSync(logPath, `[${ts}] ${text}\n`, 'utf8')
}
