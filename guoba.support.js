import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'
import YAML from 'yaml'
import { getRestartConfig } from './components/config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PLUGIN_DIR = __dirname

const CONFIG_PATH = path.join(PLUGIN_DIR, 'config', 'config.yaml')
const GROUP_CONFIG_PATH = path.join(PLUGIN_DIR, 'config', 'group_config.yaml')

/** 读取群配置原始对象 */
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
      description: '自动入群审核、MCSManager面板重启，自用插件'
    },
    configInfo: {
      schemas: [
        // ========== 重启管理 ==========
        {
          component: 'Divider',
          label: '重启管理 (mcsRestart)',
          componentProps: { orientation: 'left', plain: true }
        },
        {
          field: 'restart.enableMcs',
          label: '启用MCS面板重启',
          bottomHelpMessage: '关闭则使用框架原生重启',
          component: 'Switch',
          defaultValue: true
        },
        {
          field: 'restart.useMcsManagerPluginConfig',
          label: '读取MCS插件用户数据',
          bottomHelpMessage: '从 mcsmanager-plugin 自动读取面板地址和API Key。开启后下方地址/端口/API Key将被忽略',
          component: 'Switch',
          defaultValue: true
        },
        {
          field: 'restart.mcsHost',
          label: 'MCS面板地址',
          component: 'Input',
          defaultValue: '127.0.0.1',
          componentProps: { placeholder: '127.0.0.1' }
        },
        {
          field: 'restart.mcsPort',
          label: 'MCS面板端口',
          component: 'InputNumber',
          defaultValue: 23333,
          componentProps: { min: 1, max: 65535, step: 1 }
        },
        {
          field: 'restart.mcsApiKey',
          label: 'API Key',
          component: 'Input',
          defaultValue: '',
          componentProps: { placeholder: 'MCSManager 面板 API Key' }
        },
        {
          field: 'restart.mcsInstanceUuid',
          label: '实例UUID',
          component: 'Input',
          required: true,
          componentProps: { placeholder: 'MCSManager 实例 UUID（必填）' }
        },
        {
          field: 'restart.mcsDaemonId',
          label: '守护进程ID',
          component: 'Input',
          required: true,
          componentProps: { placeholder: 'MCSManager 守护进程 ID（必填）' }
        },
        {
          field: 'restart.restartCron',
          label: '定时重启Cron',
          bottomHelpMessage: '每行一个cron表达式，留空不执行定时任务。示例：0 4 * * *',
          component: 'Input',
          componentProps: {
            type: 'textarea',
            placeholder: '0 4 * * *\n0 12 * * *',
            rows: 3
          }
        },

        // ========== 入群审核 ==========
        {
          component: 'Divider',
          label: '入群审核 (autoGroupApprove)',
          componentProps: { orientation: 'left', plain: true }
        },
        {
          field: 'groups',
          label: '群审核规则',
          bottomHelpMessage: '为每个群配置白名单和黑名单答案。答案不区分大小写',
          component: 'GSubForm',
          componentProps: {
            multiple: true,
            schemas: [
              {
                field: 'groupId',
                label: '群号',
                component: 'Input',
                required: true,
                componentProps: { placeholder: '例如：123456789' }
              },
              {
                field: 'whitelistAnswers',
                label: '白名单答案（每行一个）',
                component: 'Input',
                componentProps: {
                  type: 'textarea',
                  placeholder: '答案一\n答案二',
                  rows: 3
                }
              },
              {
                field: 'blacklistAnswers',
                label: '黑名单答案（每行一个）',
                component: 'Input',
                componentProps: {
                  type: 'textarea',
                  placeholder: '广告\n诈骗',
                  rows: 3
                }
              }
            ]
          }
        }
      ],

      /**
       * 返回扁平化配置数据（点分隔键名）
       * GSubForm 字段（groups）直接返回数组
       */
      getConfigData() {
        const restart = getRestartConfig(PLUGIN_DIR)
        const groupRaw = readGroupConfigRaw()
        const cronArr = restart.restartCron || []
        const cronText = Array.isArray(cronArr) ? cronArr.join('\n') : String(cronArr)

        return {
          'restart.enableMcs': restart.enableMcs ?? true,
          'restart.useMcsManagerPluginConfig': restart.useMcsManagerPluginConfig ?? true,
          'restart.mcsHost': restart.mcsHost ?? '127.0.0.1',
          'restart.mcsPort': restart.mcsPort ?? 23333,
          'restart.mcsApiKey': restart.mcsApiKey ?? '',
          'restart.mcsInstanceUuid': restart.mcsInstanceUuid ?? '',
          'restart.mcsDaemonId': restart.mcsDaemonId ?? '',
          'restart.restartCron': cronText,
          groups: groupRaw.groups || []
        }
      },

      async setConfigData(data, { Result }) {
        try {
          const configDir = path.join(PLUGIN_DIR, 'config')
          if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })

          // 构建重启配置
          const cronRaw = data['restart.restartCron']
          const restartCron = Array.isArray(cronRaw)
            ? cronRaw.map(item => item.cron || item).filter(Boolean)
            : String(cronRaw || '').split('\n').map(s => s.trim()).filter(Boolean)

          const restart = {
            enableMcs: coerceBool(data['restart.enableMcs'], true),
            useMcsManagerPluginConfig: coerceBool(data['restart.useMcsManagerPluginConfig'], true),
            mcsHost: data['restart.mcsHost'] ?? '127.0.0.1',
            mcsPort: data['restart.mcsPort'] ?? 23333,
            mcsApiKey: data['restart.mcsApiKey'] ?? '',
            mcsInstanceUuid: data['restart.mcsInstanceUuid'] ?? '',
            mcsDaemonId: data['restart.mcsDaemonId'] ?? '',
            restartCron
          }
          fs.writeFileSync(CONFIG_PATH, YAML.stringify({ restart }), 'utf8')

          // 构建群配置
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

/** 强制转布尔，处理 Switch 组件可能返回字符串的情况 */
function coerceBool(val, defaultVal) {
  if (val === undefined || val === null) return defaultVal
  if (typeof val === 'boolean') return val
  if (val === 'true' || val === '1') return true
  if (val === 'false' || val === '0') return false
  return defaultVal
}
