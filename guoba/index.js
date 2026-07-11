import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'
import YAML from 'yaml'
import * as groupApproveMod from './groupApprove.js'
import * as captchaMod from './captcha.js'
import Cfg from '../model/Cfg.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PLUGIN_DIR = path.join(__dirname, '..')

const GROUP_CONFIG_PATH = path.join(PLUGIN_DIR, 'config', 'group_config.yaml')
const DEFSET_CONFIG_PATH = path.join(PLUGIN_DIR, 'defSet', 'config.yaml')
const CONFIG_PATH = path.join(PLUGIN_DIR, 'config', 'config.yaml')

/** guoba field → defSet 模板变量名 */
const TEMPLATE_VARS = {
  'api.type': 'api_type',
  'api.api': 'api_api',
  'api.resapi': 'api_resapi',
  'api.key': 'api_key',
  'api.query': 'api_query',
  'api.resquery': 'api_resquery',
  'api.startApi': 'api_startApi',
  'api.Port': 'api_Port',
  'api.Address': 'api_Address',
  'api.verifyAddr': 'api_verifyAddr',
  'api.GtestType': 'api_GtestType',
  'api.qrLogin_enabled': 'api_qrLogin_enabled'
}

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
      description: '自动入群审核、代发言、米游社过码',
      icon: 'mdi:robot-outline',
      iconColor: '#1677ff'
    },
    configInfo: {
      schemas: [
        ...groupApproveMod.getSchema(),
        ...captchaMod.getSchema()
      ],

      getConfigData() {
        const groupRaw = readGroupConfigRaw()
        const apiCfg = Cfg.api || {}

        return {
          groups: groupRaw.groups || [],
          'api.type': apiCfg.type ?? 1,
          'api.api': apiCfg.api ?? '',
          'api.resapi': apiCfg.resapi ?? '',
          'api.key': apiCfg.key ?? '',
          'api.query': apiCfg.query ?? '',
          'api.resquery': apiCfg.resquery ?? '',
          'api.startApi': apiCfg.startApi ?? false,
          'api.Port': apiCfg.Port ?? 3000,
          'api.Address': apiCfg.Address ?? 'http://127.0.0.1:3000',
          'api.verifyAddr': apiCfg.verifyAddr ?? 'http://127.0.0.1:3000/GTest/register',
          'api.GtestType': apiCfg.GtestType ?? 2,
          'api.qrLogin_enabled': apiCfg.qrLogin_enabled ?? true
        }
      },

      async setConfigData(data, { Result }) {
        try {
          const configDir = path.join(PLUGIN_DIR, 'config')
          if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })

          // 群配置：GTags 原生数组，直接 YAML.stringify
          const groups = Array.isArray(data.groups) ? data.groups : []
          fs.writeFileSync(GROUP_CONFIG_PATH, YAML.stringify({ groups }), 'utf8')

          // 过码配置：读取 defSet 模板，替换 ${变量} 后写入 config.yaml（保留注释）
          let template = fs.readFileSync(DEFSET_CONFIG_PATH, 'utf8')
          for (const [field, varName] of Object.entries(TEMPLATE_VARS)) {
            const value = data[field] ?? ''
            template = template.replace(new RegExp(`\\$\\{${varName}\\}`, 'g'), String(value))
          }
          fs.writeFileSync(CONFIG_PATH, template, 'utf8')

          // 使 Cfg 缓存失效，下次读取时重新加载
          delete Cfg.config.config
          delete Cfg.defSet.config

          return Result.ok({}, '保存成功~')
        } catch (err) {
          logger.error('[Axiu-Plugin] 保存配置失败:', err)
          return Result.error(`保存失败：${err.message}`)
        }
      }
    }
  }
}
