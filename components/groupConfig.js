import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { getDefaultGroupConfig } from './constants.js'

/**
 * 加载入群审核配置
 * 优先级：config/group_config.yaml > config/group_config.yaml.example > 空 Map
 * 首次启动时自动从 .example 复制到 group_config.yaml
 * 支持两种 YAML 格式：
 *   - 列表格式（锅巴 GSubForm）：groups: [{groupId, whitelistAnswers, blacklistAnswers}]
 *   - 映射格式（手动编辑）：groups: {"123": {whitelistAnswers: [...], blacklistAnswers: [...]}}
 * @param {string} pluginRoot - 插件根目录
 * @returns {Map<string, {whitelistAnswers: string[], blacklistAnswers: string[]}>}
 */
export function getGroupApproveConfig(pluginRoot) {
  const configPath = path.join(pluginRoot, 'config', 'group_config.yaml')
  const examplePath = path.join(pluginRoot, 'config', 'group_config.yaml.example')

  let raw = null

  if (fs.existsSync(configPath)) {
    try {
      raw = YAML.parse(fs.readFileSync(configPath, 'utf8')) || {}
    } catch (err) {
      logger.error('[Axiu-Plugin] 解析 group_config.yaml 失败:', err)
      return getDefaultGroupConfig()
    }
  } else if (fs.existsSync(examplePath)) {
    try {
      const dir = path.dirname(configPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(examplePath, configPath)
      logger.info('[Axiu-Plugin] 已从 .example 创建 group_config.yaml，请按需修改')
      raw = YAML.parse(fs.readFileSync(examplePath, 'utf8')) || {}
    } catch (err) {
      logger.error('[Axiu-Plugin] 从 .example 复制群配置失败:', err)
      return getDefaultGroupConfig()
    }
  }

  if (!raw) {
    logger.warn('[Axiu-Plugin] 无入群审核配置文件，使用空配置')
    return getDefaultGroupConfig()
  }

  return normalizeGroupConfig(raw)
}

/**
 * 将 YAML 解析结果标准化为 Map 格式
 */
function normalizeGroupConfig(raw) {
  const map = new Map()
  const groups = raw.groups
  if (!groups) return map

  const items = Array.isArray(groups)
    ? groups
    : Object.entries(groups).map(([groupId, cfg]) => ({ groupId, ...cfg }))

  for (const item of items) {
    const groupId = String(item.groupId || '').trim()
    if (!groupId) continue

    map.set(groupId, {
      whitelistAnswers: normalizeAnswerList(item.whitelistAnswers),
      blacklistAnswers: normalizeAnswerList(item.blacklistAnswers)
    })
  }

  return map
}

function normalizeAnswerList(answers) {
  if (!Array.isArray(answers)) return []
  return answers.map(a => String(a).trim()).filter(Boolean)
}
