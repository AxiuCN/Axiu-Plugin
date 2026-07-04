import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'
import YAML from 'yaml'
import * as restartMod from './restart.js'
import * as groupApproveMod from './groupApprove.js'
import { getRestartConfig } from '../components/config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PLUGIN_DIR = path.join(__dirname, '..')

const RESTART_CONFIG_PATH = path.join(PLUGIN_DIR, 'config', 'config.yaml')
const RESTART_TEMPLATE_PATH = path.join(PLUGIN_DIR, 'defSet', 'config.yaml')
const GROUP_CONFIG_PATH = path.join(PLUGIN_DIR, 'config', 'group_config.yaml')

const allDefaults = {
  ...restartMod.getDefaults(),
  ...groupApproveMod.getDefaults()
}

// ==================== 工具函数 ====================

function generateConfig(templatePath, values) {
  const template = fs.readFileSync(templatePath, 'utf8')
  return template.replace(/\$\{(\w+)\}/g, (_, name) => {
    if (name in values) {
      const val = values[name]
      return val == null ? '' : String(val)
    }
    return ''
  })
}

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

function parseCron(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(item => item.cron || item).filter(Boolean)
  return String(raw).split('\n').map(s => s.trim()).filter(Boolean)
}

function cronToTemplateValue(arr) {
  if (!arr.length) return '[]'
  return '\n' + arr.map(c => `    - "${c}"`).join('\n')
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
      description: '自动入群审核、MCSManager面板重启，自用插件',
      icon: 'mdi:robot-outline',
      iconColor: '#1677ff'
    },
    configInfo: {
      schemas: [
        ...restartMod.getSchema(),
        ...groupApproveMod.getSchema()
      ],

      getConfigData() {
        const restart = getRestartConfig(PLUGIN_DIR)
        const groupRaw = readGroupConfigRaw()
        const cronArr = restart.restartCron || []
        const cronText = Array.isArray(cronArr) ? cronArr.join('\n') : String(cronArr)

        return {
          'restart.enableMcsm': restart.enableMcsm ?? true,
          'restart.useMcsmManagerPluginConfig': restart.useMcsmManagerPluginConfig ?? true,
          'restart.mcsmHost': restart.mcsmHost ?? '127.0.0.1',
          'restart.mcsmPort': restart.mcsmPort ?? 23333,
          'restart.mcsmApiKey': restart.mcsmApiKey ?? '',
          'restart.mcsmInstanceUuid': restart.mcsmInstanceUuid ?? '',
          'restart.mcsmDaemonId': restart.mcsmDaemonId ?? '',
          'restart.restartCron': cronText,
          groups: groupRaw.groups || []
        }
      },

      async setConfigData(data, { Result }) {
        try {
          const configDir = path.join(PLUGIN_DIR, 'config')
          if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })

          // 重启配置：generateConfig 模板替换，保留注释
          const restartCronArr = parseCron(data['restart.restartCron'])

          const values = {
            restart_enableMcsm: data['restart.enableMcsm'] ?? true,
            restart_useMcsmManagerPluginConfig: data['restart.useMcsmManagerPluginConfig'] ?? true,
            restart_mcsmHost: data['restart.mcsmHost'] || '127.0.0.1',
            restart_mcsmPort: data['restart.mcsmPort'] ?? 23333,
            restart_mcsmApiKey: data['restart.mcsmApiKey'] || '',
            restart_mcsmInstanceUuid: data['restart.mcsmInstanceUuid'] || '',
            restart_mcsmDaemonId: data['restart.mcsmDaemonId'] || '',
            restart_restartCron: cronToTemplateValue(restartCronArr)
          }

          const content = generateConfig(RESTART_TEMPLATE_PATH, values)
          fs.writeFileSync(RESTART_CONFIG_PATH, content, 'utf8')

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
