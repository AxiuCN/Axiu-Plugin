import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { getDefaultGroupConfig } from './constants.js'

/**
 * 群配置目录（**回归套件专用重定向**：设了 `AXIU_CONFIG_DIR` 就读写那里，生产不设）
 *
 * 与 `components/config.js` 的 `resolveConfigPath()` 同一个开关，锅巴的读写也走这里。
 */
const resolvedGroupDir = pluginRoot => process.env.AXIU_CONFIG_DIR || path.join(pluginRoot, 'config')

/** 运行时群配置路径 */
export const resolveGroupConfigPath = pluginRoot => path.join(resolvedGroupDir(pluginRoot), 'group_config.yaml')

/** 群配置参考默认值路径 */
export const resolveGroupExamplePath = pluginRoot => path.join(resolvedGroupDir(pluginRoot), 'group_config.yaml.example')

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
  const configPath = resolveGroupConfigPath(pluginRoot)
  const examplePath = resolveGroupExamplePath(pluginRoot)

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

/* ------------------------- 锅巴面板形态的双向转换 ------------------------- */

/**
 * 面板形态：数组格式原样归一，映射格式转成行（`{"123": {...}}` → `{groupId: '123', ...}`）
 *
 * 读侧**两种格式都认**——手写的映射格式不能因为「面板只认数组」就被丢掉。
 * 认不出的结构返回 []；没有群号的行跳过（空行本身没有内容可丢）。
 * @param {Array|object} groups YAML 里的 `groups` 值
 * @returns {Array<{groupId: string, whitelistAnswers: string[], blacklistAnswers: string[]}>}
 */
export function groupsToPanel(groups) {
  const items = Array.isArray(groups)
    ? groups
    : (groups && typeof groups === 'object' ? Object.entries(groups).map(([groupId, cfg]) => ({ groupId, ...cfg })) : [])
  return items
    .map(item => ({
      groupId: String(item?.groupId ?? '').trim(),
      whitelistAnswers: normalizeAnswerList(item?.whitelistAnswers),
      blacklistAnswers: normalizeAnswerList(item?.blacklistAnswers)
    }))
    .filter(row => row.groupId)
}

/** 文件里 `groups` 原本的形态：'map' = 手写映射格式，'list' = 锅巴数组格式 */
export function groupShapeOf(groups) {
  return groups && typeof groups === 'object' && !Array.isArray(groups) ? 'map' : 'list'
}

/**
 * 面板提交的行 → 写回用的 `groups` 值（**保持文件原有形态**：原来是映射就写映射、是数组就写数组）
 * @param {Array} rows 面板行（先用 `groupsToPanel()` 归一）
 * @param {'list'|'map'} [shape] 目标形态，取 `groupShapeOf()` 的结果
 * @returns {{groups: Array|object, error: string|null}} error 非空 = 这份输入不能写，调用方应拒绝保存
 */
export function groupsFromPanel(rows, shape = 'list') {
  if (!Array.isArray(rows)) return { groups: [], error: '群规则必须是数组' }
  const list = []
  for (const row of rows) {
    const groupId = String(row?.groupId ?? '').trim()
    if (!groupId) continue
    if (row.whitelistAnswers !== undefined && !Array.isArray(row.whitelistAnswers)) {
      return { groups: [], error: `群 ${groupId} 的白名单不是数组` }
    }
    if (row.blacklistAnswers !== undefined && !Array.isArray(row.blacklistAnswers)) {
      return { groups: [], error: `群 ${groupId} 的黑名单不是数组` }
    }
    list.push({
      groupId,
      whitelistAnswers: normalizeAnswerList(row.whitelistAnswers),
      blacklistAnswers: normalizeAnswerList(row.blacklistAnswers)
    })
  }
  if (shape === 'map') {
    const map = {}
    for (const row of list) map[row.groupId] = { whitelistAnswers: row.whitelistAnswers, blacklistAnswers: row.blacklistAnswers }
    return { groups: map, error: null }
  }
  return { groups: list, error: null }
}
