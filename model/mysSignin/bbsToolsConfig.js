/** 米游社签到配置管理
 *  - 读取 config/MihoyoBBSTools_config.yaml 模板
 *  - 读取 config/config.yaml → signin: 主配置
 *  - 为每用户生成 tool/MihoyoBBSTools/MihoyoBBSTools/config/{qq}_n.yaml
 */

import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.join(__dirname, '..', '..')

/** MihoyoBBSTools 子模块 config 目录 */
const BBS_TOOLS_CONFIG_DIR = path.join(
  pluginRoot, 'tool', 'MihoyoBBSTools', 'MihoyoBBSTools', 'config'
)

/** 个人签到配置路径 */
function getUserConfigPath (qq, n) {
  return path.join(BBS_TOOLS_CONFIG_DIR, `${qq}_${n}.yaml`)
}

/** 列出指定 QQ 的所有签到配置文件 */
function listUserConfigs (qq) {
  if (!fs.existsSync(BBS_TOOLS_CONFIG_DIR)) return []
  const files = fs.readdirSync(BBS_TOOLS_CONFIG_DIR)
  const pattern = new RegExp(`^${qq}_(\\d+)\\.yaml$`)
  return files
    .filter(f => pattern.test(f))
    .map(f => {
      const match = f.match(pattern)
      return {
        n: parseInt(match[1]),
        path: path.join(BBS_TOOLS_CONFIG_DIR, f)
      }
    })
    .sort((a, b) => a.n - b.n)
}

/** 列出所有已注册签到的 QQ 号 */
function listAllRegisteredQQ () {
  if (!fs.existsSync(BBS_TOOLS_CONFIG_DIR)) return []
  const files = fs.readdirSync(BBS_TOOLS_CONFIG_DIR)
  const qqSet = new Set()
  const pattern = /^(\d+)_\d+\.yaml$/
  for (const f of files) {
    const match = f.match(pattern)
    if (match) qqSet.add(match[1])
  }
  return [...qqSet]
}

/** 确定下一个可用的 n (从 1 开始递增) */
function getNextN (qq) {
  const existing = listUserConfigs(qq)
  if (existing.length === 0) return 1
  return existing[existing.length - 1].n + 1
}

// ==================== 模板读取 ====================

/**
 * 读取 MihoyoBBSTools 模板配置
 * 优先级: config/MihoyoBBSTools_config.yaml > config/MihoyoBBSTools_config.yaml.example
 * @returns {object} MihoyoBBSTools 配置对象 (v15)
 */
function loadBbsToolsTemplate () {
  const configPath = path.join(pluginRoot, 'config', 'MihoyoBBSTools_config.yaml')
  const examplePath = path.join(pluginRoot, 'config', 'MihoyoBBSTools_config.yaml.example')

  let file = null
  if (fs.existsSync(configPath)) {
    file = configPath
  } else if (fs.existsSync(examplePath)) {
    // 首次启动：复制 .example → config.yaml
    file = examplePath
    try { fs.copyFileSync(examplePath, configPath) } catch {}
  }

  if (!file || !fs.existsSync(file)) {
    throw new Error('MihoyoBBSTools 签到模板不存在，请检查 config/MihoyoBBSTools_config.yaml.example')
  }

  return YAML.parse(fs.readFileSync(file, 'utf8')) || {}
}

/**
 * 读取 defSet 干净模板（用于 #刷新自动签到 替换 cookie）
 * @returns {object}
 */
function loadBbsToolsDefSetTemplate () {
  const defSetPath = path.join(pluginRoot, 'defSet', 'MihoyoBBSTools_config.yaml')
  if (!fs.existsSync(defSetPath)) {
    // 回退到 runtime 模板
    return loadBbsToolsTemplate()
  }
  return YAML.parse(fs.readFileSync(defSetPath, 'utf8')) || {}
}

// ==================== 主配置读取 ====================

/**
 * 读取 signin 主配置
 * 优先级: config/config.yaml → signin: 段 > config/config.yaml.example > 内置默认值
 * @returns {object}
 */
function getSigninConfig () {
  const configFile = path.join(pluginRoot, 'config', 'config.yaml')
  const exampleFile = path.join(pluginRoot, 'config', 'config.yaml.example')

  let cfg = {}
  const readYaml = (file) => {
    try {
      if (fs.existsSync(file)) {
        return YAML.parse(fs.readFileSync(file, 'utf8')) || {}
      }
    } catch { /* ignore */ }
    return {}
  }

  cfg = readYaml(configFile)
  if (!cfg.signin) {
    const example = readYaml(exampleFile)
    cfg.signin = example.signin || {}
  }

  const s = cfg.signin || {}
  return {
    enable: s.enable ?? true,
    schedule: s.schedule ?? '0 0 5 * * ? *',
    randomDelayMin: s.randomDelayMin ?? 0,
    pythonCommand: s.pythonCommand ?? 'python',
    notifyGroup: s.notifyGroup ?? true,
    captchaRetries: s.captchaRetries ?? 3,
    captchaTimeout: s.captchaTimeout ?? 240
  }
}

// ==================== 配置生成 ====================

/**
 * 根据 stoken 数据 + 模板生成 MihoyoBBSTools 用户配置对象
 * @param {object} stokenEntry - stoken 条目 ({stuid, stoken, ltoken, mid, uid})
 * @param {string} cookie - 完整 cookie 字符串 (ltoken=...;ltuid=...;cookie_token=...;account_id=...)
 * @returns {object} MihoyoBBSTools 配置对象
 */
function buildUserConfig (stokenEntry, cookie) {
  const template = loadBbsToolsTemplate()

  // 深拷贝模板，避免修改缓存
  const config = JSON.parse(JSON.stringify(template))

  // 填充 account 段
  config.account.cookie = cookie
  config.account.stuid = String(stokenEntry.stuid || '')
  config.account.stoken = String(stokenEntry.stoken || '')
  config.account.mid = String(stokenEntry.mid || '')

  // 确保版本号
  config.version = config.version || 15

  return config
}

/**
 * 生成用户签到配置文件
 * @param {string} qq - QQ 号
 * @param {number} n - 序号
 * @param {object} stokenEntry - stoken 条目
 * @param {string} cookie - 完整 cookie 字符串
 * @returns {{path: string, n: number}} 生成的配置文件信息
 */
function writeUserConfig (qq, n, stokenEntry, cookie) {
  const config = buildUserConfig(stokenEntry, cookie)
  const filePath = getUserConfigPath(qq, n)

  // 确保目录存在
  if (!fs.existsSync(BBS_TOOLS_CONFIG_DIR)) {
    fs.mkdirSync(BBS_TOOLS_CONFIG_DIR, { recursive: true })
  }

  fs.writeFileSync(filePath, YAML.stringify(config), 'utf8')
  return { path: filePath, n }
}

/**
 * 刷新已有配置文件的 cookie（#刷新自动签到）
 * 从 defSet 干净模板读取，仅替换 account 段
 * @param {string} filePath - 已有配置文件路径
 * @param {object} stokenEntry - stoken 条目
 * @param {string} cookie - 新 cookie 字符串
 */
function refreshUserConfigCookie (filePath, stokenEntry, cookie) {
  const template = loadBbsToolsDefSetTemplate()
  const existing = YAML.parse(fs.readFileSync(filePath, 'utf8')) || {}

  // 用 defSet 模板覆盖 account 段，保留用户自定义的 games/BBS 设置
  existing.account = JSON.parse(JSON.stringify(template.account || {}))
  existing.account.cookie = cookie
  existing.account.stuid = String(stokenEntry.stuid || '')
  existing.account.stoken = String(stokenEntry.stoken || '')
  existing.account.mid = String(stokenEntry.mid || '')

  fs.writeFileSync(filePath, YAML.stringify(existing), 'utf8')
}

/**
 * 删除指定 QQ 的所有签到配置文件
 * @param {string} qq - QQ 号
 * @returns {number} 删除的文件数
 */
function deleteUserConfigs (qq) {
  const configs = listUserConfigs(qq)
  for (const cfg of configs) {
    try { fs.unlinkSync(cfg.path) } catch {}
  }
  return configs.length
}

export {
  pluginRoot,
  BBS_TOOLS_CONFIG_DIR,
  getUserConfigPath,
  listUserConfigs,
  listAllRegisteredQQ,
  getNextN,
  loadBbsToolsTemplate,
  loadBbsToolsDefSetTemplate,
  getSigninConfig,
  buildUserConfig,
  writeUserConfig,
  refreshUserConfigCookie,
  deleteUserConfigs
}
