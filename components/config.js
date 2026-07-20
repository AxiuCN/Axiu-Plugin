import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const configDir = path.join(pluginRoot, 'config')
const configFile = path.join(configDir, 'config.yaml')
const exampleFile = path.join(configDir, 'config.yaml.example')

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
  if (fs.existsSync(configFile)) {
    try {
      return { ...defaultConfig, ...YAML.parse(fs.readFileSync(configFile, 'utf8')) }
    } catch (e) {
      logger?.warn('[Axiu-Plugin] 配置文件解析失败，使用默认配置')
      return defaultConfig
    }
  }
  if (fs.existsSync(exampleFile)) {
    fs.copyFileSync(exampleFile, configFile)
    logger?.info('[Axiu-Plugin] 已从 config.yaml.example 创建配置文件')
    try {
      return { ...defaultConfig, ...YAML.parse(fs.readFileSync(configFile, 'utf8')) }
    } catch (e) {
      return defaultConfig
    }
  }
  return defaultConfig
}

export { pluginRoot, configDir, configFile, exampleFile }

