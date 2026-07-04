import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { DEFAULT_RESTART_CONFIG, getDefaultGroupConfig } from './constants.js'

/**
 * 加载重启配置
 * 优先级：config/config.yaml > config/config.yaml.example > 硬编码默认值
 * 首次启动时自动从 .example 复制到 config.yaml
 * @param {string} pluginRoot - 插件根目录
 * @returns {object} restart 配置对象
 */
export function getRestartConfig(pluginRoot) {
  const configPath = path.join(pluginRoot, 'config', 'config.yaml')
  const examplePath = path.join(pluginRoot, 'config', 'config.yaml.example')

  if (fs.existsSync(configPath)) {
    try {
      const raw = YAML.parse(fs.readFileSync(configPath, 'utf8')) || {}
      return raw.restart || DEFAULT_RESTART_CONFIG.restart
    } catch (err) {
      logger.error('[Axiu-Plugin] 解析 config.yaml 失败:', err)
      return DEFAULT_RESTART_CONFIG.restart
    }
  }

  if (fs.existsSync(examplePath)) {
    try {
      const dir = path.dirname(configPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(examplePath, configPath)
      logger.info('[Axiu-Plugin] 已从 .example 创建 config.yaml，请按需修改')
      const raw = YAML.parse(fs.readFileSync(examplePath, 'utf8')) || {}
      return raw.restart || DEFAULT_RESTART_CONFIG.restart
    } catch (err) {
      logger.error('[Axiu-Plugin] 从 .example 复制配置失败:', err)
      return DEFAULT_RESTART_CONFIG.restart
    }
  }

  logger.warn('[Axiu-Plugin] 无配置文件，使用默认重启配置')
  return DEFAULT_RESTART_CONFIG.restart
}

/**
 * 加载入群审核配置
 * 优先级：config/group_config.yaml > config/group_config.yaml.example > 空 Map
 * 首次启动时自动从 .example 复制到 group_config.yaml
 * 支持两种 YAML 格式：
 *   - 列表格式（锅巴 GSubForm）：groups: [{groupId, whitelistAnswers, blacklistAnswers}]
 *   - 映射格式（手动编辑）：groups: {"123": {whitelistAnswers: [...], blacklistAnswers: [...]}}
 * whitelistAnswers/blacklistAnswers 支持数组（YAML）和换行字符串（锅巴 textarea）
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
 * @param {object} raw - YAML 解析结果
 * @returns {Map<string, {whitelistAnswers: string[], blacklistAnswers: string[]}>}
 */
function normalizeGroupConfig(raw) {
  const map = new Map()
  const groups = raw.groups
  if (!groups) return map

  /** @type {Array<{groupId?: string, whitelistAnswers?: string|string[], blacklistAnswers?: string|string[]}>} */
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

/**
 * 标准化答案列表：支持 YAML 数组（手动编辑）和换行字符串（锅巴 textarea）
 * @param {string|string[]|undefined} answers
 * @returns {string[]}
 */
function normalizeAnswerList(answers) {
  if (!answers) return []
  if (Array.isArray(answers)) {
    return answers.map(a => String(a).trim()).filter(Boolean)
  }
  return String(answers).split('\n').map(a => a.trim()).filter(Boolean)
}
