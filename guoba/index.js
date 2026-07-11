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
          'api.Host': apiCfg.Host ?? '127.0.0.1',
          'api.Port': apiCfg.Port ?? 3000,
          'api.Address': apiCfg.Address ?? 'http://127.0.0.1:3000',
          'api.verifyAddr': apiCfg.verifyAddr ?? 'http://127.0.0.1:3000/GTest/register',
          'api.GtestType': apiCfg.GtestType ?? 2
        }
      },

      async setConfigData(data, { Result }) {
        try {
          const configDir = path.join(PLUGIN_DIR, 'config')
          if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })

          // 群配置：GTags 原生数组，直接 YAML.stringify
          const groups = Array.isArray(data.groups) ? data.groups : []
          fs.writeFileSync(GROUP_CONFIG_PATH, YAML.stringify({ groups }), 'utf8')

          // 过码配置：通过 Cfg 单例写入 config/config.yaml
          const apiCfg = {
            type: data['api.type'] ?? 1,
            api: data['api.api'] ?? '',
            resapi: data['api.resapi'] ?? '',
            key: data['api.key'] ?? '',
            query: data['api.query'] ?? '',
            resquery: data['api.resquery'] ?? '',
            startApi: data['api.startApi'] ?? false,
            Host: data['api.Host'] ?? '127.0.0.1',
            Port: data['api.Port'] ?? 3000,
            Address: data['api.Address'] ?? 'http://127.0.0.1:3000',
            verifyAddr: data['api.verifyAddr'] ?? 'http://127.0.0.1:3000/GTest/register',
            GtestType: data['api.GtestType'] ?? 2
          }

          const current = Cfg.getConfig('config') || {}
          Cfg.setConfig('config', { ...current, api: apiCfg })

          return Result.ok({}, '保存成功~')
        } catch (err) {
          logger.error('[Axiu-Plugin] 保存配置失败:', err)
          return Result.error(`保存失败：${err.message}`)
        }
      }
    }
  }
}
