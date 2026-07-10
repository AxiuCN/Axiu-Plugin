import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'
import YAML from 'yaml'
import * as groupApproveMod from './groupApprove.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PLUGIN_DIR = path.join(__dirname, '..')

const GROUP_CONFIG_PATH = path.join(PLUGIN_DIR, 'config', 'group_config.yaml')

// ==================== 工具函数 ====================

function readGroupConfigRaw() {
  try {
    if (fs.existsSync(GROUP_CONFIG_PATH)) {
      return YAML.parse(fs.readFileSync(GROUP_CONFIG_PATH, 'utf8')) || {}
    }
  } catch (err) {
    logger.error('[Axiu-Plugin] 读取群配置失败:', err)
  }
  const examplePath = path.join(PLUGIN_DIR, 'config', 'group_config.yaml.example')
  if (fs.existsSync(examplePath)) {
    try { return YAML.parse(fs.readFileSync(examplePath, 'utf8')) || {} } catch {}
  }
  return { groups: [] }
}

// ==================== 导出 ====================

export function supportGuoba() {
  return {
    pluginInfo: {
      name: 'Axiu-Plugin',
      title: '阿修插件',
      author: '@阿修Axiu',
      authorLink: 'https://github.com/AxiuCN',
      link: 'https://github.com/AxiuCN/Axiu-Plugin',
      isV3: true,
      isV2: false,
      description: '自动入群审核，自用插件',
      icon: 'mdi:robot-outline',
      iconColor: '#1677ff'
    },
    configInfo: {
      schemas: [
        ...groupApproveMod.getSchema()
      ],

      getConfigData() {
        const groupRaw = readGroupConfigRaw()

        return {
          groups: groupRaw.groups || []
        }
      },

      async setConfigData(data, { Result }) {
        try {
          const configDir = path.join(PLUGIN_DIR, 'config')
          if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })

          // 群配置：GTags 原生数组，直接 YAML.stringify
          const groups = Array.isArray(data.groups) ? data.groups : []
          fs.writeFileSync(GROUP_CONFIG_PATH, YAML.stringify({ groups }), 'utf8')

          return Result.ok({}, '保存成功~')
        } catch (err) {
          logger.error('[Axiu-Plugin] 保存配置失败:', err)
          return Result.error(`保存失败：${err.message}`)
        }
      }
    }
  }
}
