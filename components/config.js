import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const configDir = path.join(pluginRoot, 'config')
const configFile = path.join(configDir, 'config.yaml')
const exampleFile = path.join(configDir, 'config.yaml.example')

/**
 * 配置目录（**回归套件专用重定向**：设了 `AXIU_CONFIG_DIR` 就读写那里）
 *
 * 生产不设这个变量。加它的唯一目的是让回归套件能真跑「读文件 → 渲染 → 写盘」这条路，
 * 而不碰仓库里的 `config/config.yaml`。读写都经下面两个解析函数，不再各自拼路径。
 */
const resolvedConfigDir = () => process.env.AXIU_CONFIG_DIR || configDir

/** 运行时配置路径（读与写共用同一个来源） */
export const resolveConfigPath = () => path.join(resolvedConfigDir(), 'config.yaml')

/** 参考默认值路径（运行时那份不存在时退到它） */
export const resolveExamplePath = () => path.join(resolvedConfigDir(), 'config.yaml.example')

/** 默认配置 */
const defaultConfig = {
  srChallenge: { enabled: true },
  srChallengeRank: { enabled: true, rankNumber: 20 },
  proxySpeak: { enabled: true }
}

/**
 * 获取插件配置
 * config.yaml 不存在时从 .example 复制；.example 也不存在则返回默认值
 * @returns {object} 配置对象
 */
export function getPluginConfig () {
  const file = resolveConfigPath()
  const example = resolveExamplePath()
  if (fs.existsSync(file)) {
    try {
      return { ...defaultConfig, ...YAML.parse(fs.readFileSync(file, 'utf8')) }
    } catch (e) {
      logger?.warn('[Axiu-Plugin] 配置文件解析失败，使用默认配置')
      return defaultConfig
    }
  }
  if (fs.existsSync(example)) {
    fs.copyFileSync(example, file)
    logger?.info('[Axiu-Plugin] 已从 config.yaml.example 创建配置文件')
    try {
      return { ...defaultConfig, ...YAML.parse(fs.readFileSync(file, 'utf8')) }
    } catch (e) {
      return defaultConfig
    }
  }
  return defaultConfig
}

/* ------------------------- 配置读写助手（锅巴面板与写入路径共用） ------------------------- */

/** 按点分路径读配置（中间层缺失不抛错） */
export function readField (src, field) {
  let cur = src
  for (const seg of String(field).split('.')) {
    if (cur === null || cur === undefined) return undefined
    cur = cur[seg]
  }
  return cur
}

/**
 * 值 → 单行 YAML 字面量（配置写入的**唯一**出口）
 *
 * 字符串一律 `JSON.stringify`：以 `*` 开头的 cron（`*\/30 * * * * ?`，YAML 会把它当别名语法）、
 * 含 `#` / `:` / 引号 / 换行的值都能安全写成一行，并原样解析回来。
 * 数组与对象写成单行 YAML（与 `config/config.yaml.example` 里人写的形式一致）。
 */
export function yamlValue (value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (value === null || value === undefined) return '""'
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(yamlValue).join(', ')}]`
  return `{${Object.entries(value).map(([k, v]) => `${k}: ${yamlValue(v)}`).join(', ')}}`
}

/**
 * 解析失败时的安全错误文案
 *
 * `yaml` 库会把出错那行的原文塞进异常消息，而那行常常是 `api.key` 这类口令——原文照抄进日志
 * 或锅巴弹窗等于把口令打出来。这里只留「哪份文件 + 解析器给的原因（到第一个换行为止）」。
 */
function explainParseError (file, err) {
  const reason = String(err?.message ?? err).split('\n')[0].trim()
  return `解析不了 ${file}：${reason}`
}

/**
 * 读配置 + 状态（锅巴面板用）
 *
 * 与 `getPluginConfig()` 的区别：这里把「读不出来」和「本来就没配」分开，调用方才能在保存回执里
 * 点明「这份文件坏了、面板显示的是参考默认值」。读的是**文件当前内容**，不是模块加载时的快照。
 * @returns {{config: object, error: string|null, file: string}} error 非空 = 那份文件读不出来
 */
export function readConfigWithStatus () {
  const file = resolveConfigPath()
  const example = resolveExamplePath()
  if (fs.existsSync(file)) {
    try {
      return { config: { ...defaultConfig, ...YAML.parse(fs.readFileSync(file, 'utf8')) }, error: null, file }
    } catch (err) {
      const error = explainParseError(file, err)
      logger?.error(`[Axiu-Plugin] 读取配置失败：${error}`)
      return { config: { ...defaultConfig }, error, file }
    }
  }
  /* 运行时那份还没生成：退到参考文件（不复制、不覆盖），面板照常打得开 */
  if (fs.existsSync(example)) {
    try {
      return { config: { ...defaultConfig, ...YAML.parse(fs.readFileSync(example, 'utf8')) }, error: null, file: example }
    } catch (err) {
      return { config: { ...defaultConfig }, error: explainParseError(example, err), file: example }
    }
  }
  return { config: { ...defaultConfig }, error: null, file }
}

/** 两个值是否等价（写前验证用：标量按字符串比，数组/对象按结构比） */
function sameValue (a, b) {
  const bothArray = Array.isArray(a) && Array.isArray(b)
  const bothObject = a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)
  return bothArray || bothObject ? JSON.stringify(a) === JSON.stringify(b) : String(a) === String(b)
}

/**
 * 写前验证：渲染出的文本必须能被解析回来，且每个键解析回来的值就是准备写的值
 *
 * 少了这一步，一个坏值就能把文件写成「下次读不出来的样子」，而面板还会报保存成功。
 * @param {string} text 准备写盘的文本
 * @param {object} values 以点分路径为键的值（渲染前已归一，不留 undefined）
 * @param {string} [file] 出错文案里写的文件
 * @returns {{ok: true} | {ok: false, parseError: string|null, invalid: string[]}}
 */
export function validateRendered (text, values, file = resolveConfigPath()) {
  let parsed
  try {
    parsed = YAML.parse(text)
  } catch (err) {
    return { ok: false, parseError: explainParseError(file, err), invalid: [] }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, parseError: `${file} 渲染结果不是一份 YAML 映射`, invalid: [] }
  const invalid = Object.entries(values)
    .filter(([field, want]) => !sameValue(want, readField(parsed, field)))
    .map(([field]) => field)
  return invalid.length ? { ok: false, parseError: null, invalid } : { ok: true }
}

/**
 * 临时文件 + 原子替换写盘
 *
 * 避免「写到一半崩溃，留下一份读不出来的配置」。临时文件与目标同目录（同卷才能原子替换），
 * 名字以 `.yaml` 结尾、落在 `config/*.yaml` 这条 gitignore 规则内；异常路径保证清理。
 */
export function writeConfigAtomic (file, text) {
  const tmp = path.join(path.dirname(file), `.config.tmp.${process.pid}-${Math.random().toString(36).slice(2, 8)}.yaml`)
  try {
    fs.writeFileSync(tmp, text, 'utf8')
    fs.renameSync(tmp, file)
  } finally {
    if (fs.existsSync(tmp)) {
      try { fs.unlinkSync(tmp) } catch { /* 清理失败不影响本次写入结果 */ }
    }
  }
}

export { pluginRoot, configDir, configFile, exampleFile }

