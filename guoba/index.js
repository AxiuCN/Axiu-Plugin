import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'
import YAML from 'yaml'
import * as qrLoginMod from './qrLogin.js'
import * as groupApproveMod from './groupApprove.js'
import * as captchaMod from './captcha.js'
import * as signinMod from './signin.js'
import * as challengeMod from './challenge.js'
import * as proxySpeakMod from './proxySpeak.js'
import gsCfg from '../model/gsCfg.js'
import { getPluginConfig } from '../components/config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PLUGIN_DIR = path.join(__dirname, '..')

const GROUP_CONFIG_PATH = path.join(PLUGIN_DIR, 'config', 'group_config.yaml')
const DEFSET_CONFIG_PATH = path.join(PLUGIN_DIR, 'defSet', 'config.yaml')
const CONFIG_PATH = path.join(PLUGIN_DIR, 'config', 'config.yaml')
const BBS_TOOLS_TEMPLATE_PATH = path.join(PLUGIN_DIR, 'config', 'MihoyoBBSTools_config.yaml')
const BBS_TOOLS_TEMPLATE_EXAMPLE = path.join(PLUGIN_DIR, 'config', 'MihoyoBBSTools_config.yaml.example')

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
  'api.bindHost': 'api_bindHost',
  'api.Address': 'api_Address',
  'api.verifyAddr': 'api_verifyAddr',
  'api.GtestType': 'api_GtestType',
  'api.qrLogin_enabled': 'api_qrLogin_enabled',
  'signin.enable': 'signin_enable',
  'signin.schedule': 'signin_schedule',
  'signin.refreshSchedule': 'signin_refreshSchedule',
  'signin.randomDelayMin': 'signin_randomDelayMin',
  'signin.pythonCommand': 'signin_pythonCommand',
  'signin.notifyGroup': 'signin_notifyGroup',
  'signin.reportGroups': 'signin_reportGroups',
  'signin.captchaRetries': 'signin_captchaRetries',
  'signin.captchaTimeout': 'signin_captchaTimeout',
  'srChallenge.enabled': 'srChallenge_enabled',
  'srChallengeRank.enabled': 'srChallengeRank_enabled',
  'srChallengeRank.rankNumber': 'srChallengeRank_rankNumber',
  'gsAbyss.enabled': 'gsAbyss_enabled',
  'gsAbyssRank.enabled': 'gsAbyssRank_enabled',
  'gsAbyssRank.rankNumber': 'gsAbyssRank_rankNumber',
  'proxySpeak.enabled': 'proxySpeak_enabled'
}

// ==================== 工具函数 ====================

function readGroupConfigRaw () {
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

/**
 * 读取 MihoyoBBSTools 模板配置
 * 优先级: config/MihoyoBBSTools_config.yaml > config/MihoyoBBSTools_config.yaml.example
 */
function readBbsToolsTemplateRaw () {
  let file = null
  if (fs.existsSync(BBS_TOOLS_TEMPLATE_PATH)) {
    file = BBS_TOOLS_TEMPLATE_PATH
  } else if (fs.existsSync(BBS_TOOLS_TEMPLATE_EXAMPLE)) {
    file = BBS_TOOLS_TEMPLATE_EXAMPLE
  }
  if (!file) return {}
  try {
    return YAML.parse(fs.readFileSync(file, 'utf8')) || {}
  } catch (err) {
    logger.error('[Axiu-Plugin] 读取 MihoyoBBSTools 模板失败:', err)
    return {}
  }
}

/** 读取 signin 主配置（从 config.yaml） */
function readSigninConfigRaw () {
  const cfg = gsCfg.getConfig('config') || {}
  return cfg.signin || {}
}

// ==================== 导出 ====================

export function supportGuoba () {
  return {
    pluginInfo: {
      name: 'Axiu-Plugin',
      title: '阿修插件',
      author: '@阿修Axiu',
      authorLink: 'https://github.com/AxiuCN',
      link: 'https://github.com/AxiuCN/Axiu-Plugin',
      isV3: true,
      isV2: false,
      description: '自动入群审核、代发言、米游社过码、米游社签到',
      icon: 'mdi:robot-outline',
      iconColor: '#1677ff'
    },
    configInfo: {
      schemas: [
        ...qrLoginMod.getSchema(),
        ...signinMod.getSchema(),
        ...captchaMod.getSchema(),
        ...challengeMod.getSchema(),
        ...groupApproveMod.getSchema(),
        ...proxySpeakMod.getSchema()
      ],

      getConfigData () {
        const groupRaw = readGroupConfigRaw()
        const apiCfg = gsCfg.api || {}
        const signinCfg = readSigninConfigRaw()
        const bbsTemplate = readBbsToolsTemplateRaw()
        const mihoyobbs = bbsTemplate.mihoyobbs || {}
        const gamesCn = bbsTemplate.games?.cn || {}
        const gamesOs = bbsTemplate.games?.os || {}
        const cloudCn = bbsTemplate.cloud_games?.cn || {}
        const cloudOs = bbsTemplate.cloud_games?.os || {}
        const web = bbsTemplate.web_activity || {}

        return {
          // 群配置
          groups: groupRaw.groups || [],

          // api 过码配置
          'api.type': apiCfg.type ?? 1,
          'api.api': apiCfg.api ?? '',
          'api.resapi': apiCfg.resapi ?? '',
          'api.key': apiCfg.key ?? '',
          'api.query': apiCfg.query ?? '',
          'api.resquery': apiCfg.resquery ?? '',
          'api.startApi': apiCfg.startApi ?? false,
          'api.Port': apiCfg.Port ?? 3000,
          'api.bindHost': apiCfg.bindHost ?? '127.0.0.1',
          'api.Address': apiCfg.Address ?? 'http://127.0.0.1:3000',
          'api.verifyAddr': apiCfg.verifyAddr ?? 'http://127.0.0.1:3000/GTest/register',
          'api.GtestType': apiCfg.GtestType ?? 2,
          'api.qrLogin_enabled': apiCfg.qrLogin_enabled ?? true,

          // srChallenge
          'srChallenge.enabled': getPluginConfig()?.srChallenge?.enabled ?? true,

          // srChallengeRank
          'srChallengeRank.enabled': getPluginConfig()?.srChallengeRank?.enabled ?? true,
          'srChallengeRank.rankNumber': getPluginConfig()?.srChallengeRank?.rankNumber ?? 20,

          // gsAbyss
          'gsAbyss.enabled': getPluginConfig()?.gsAbyss?.enabled ?? true,

          // gsAbyssRank
          'gsAbyssRank.enabled': getPluginConfig()?.gsAbyssRank?.enabled ?? true,
          'gsAbyssRank.rankNumber': getPluginConfig()?.gsAbyssRank?.rankNumber ?? 20,

          // proxySpeak
          'proxySpeak.enabled': getPluginConfig()?.proxySpeak?.enabled ?? true,

          // signin 主配置
          'signin.enable': signinCfg.enable ?? true,
          'signin.schedule': signinCfg.schedule ?? '0 0 5 * * ? *',
          'signin.refreshSchedule': signinCfg.refreshSchedule ?? '0 30 4 * * ? *',
          'signin.randomDelayMin': signinCfg.randomDelayMin ?? 0,
          'signin.pythonCommand': signinCfg.pythonCommand ?? 'python',
          'signin.notifyGroup': signinCfg.notifyGroup ?? true,
          // GSelectGroup 需要数组，config 存的是逗号分隔字符串，这里做转换
          'signin.reportGroups': (signinCfg.reportGroups || '')
            ? String(signinCfg.reportGroups).split(/[,，\s]+/).filter(Boolean)
            : [],
          'signin.captchaRetries': signinCfg.captchaRetries ?? 3,
          'signin.captchaTimeout': signinCfg.captchaTimeout ?? 240,

          // MihoyoBBSTools 模板
          'mihoyobbs.enable': mihoyobbs.enable ?? true,
          'mihoyobbs.checkin': mihoyobbs.checkin ?? true,
          'mihoyobbs.read': mihoyobbs.read ?? false,
          'mihoyobbs.like': mihoyobbs.like ?? false,
          'mihoyobbs.cancel_like': mihoyobbs.cancel_like ?? false,
          'mihoyobbs.share': mihoyobbs.share ?? false,

          'games.cn.enable': gamesCn.enable ?? true,
          'games.cn.retries': gamesCn.retries ?? 3,
          'games.cn.genshin.checkin': gamesCn.genshin?.checkin ?? true,
          'games.cn.honkai_sr.checkin': gamesCn.honkai_sr?.checkin ?? true,
          'games.cn.zzz.checkin': gamesCn.zzz?.checkin ?? true,
          'games.cn.honkai3rd.checkin': gamesCn.honkai3rd?.checkin ?? false,
          'games.cn.honkai2.checkin': gamesCn.honkai2?.checkin ?? false,
          'games.cn.tears_of_themis.checkin': gamesCn.tears_of_themis?.checkin ?? false,

          'games.os.enable': gamesOs.enable ?? false,
          'games.os.cookie': gamesOs.cookie ?? '',
          'games.os.genshin.checkin': gamesOs.genshin?.checkin ?? false,
          'games.os.honkai_sr.checkin': gamesOs.honkai_sr?.checkin ?? false,
          'games.os.zzz.checkin': gamesOs.zzz?.checkin ?? false,

          'cloud_games.cn.enable': cloudCn.enable ?? false,
          'cloud_games.cn.genshin.enable': cloudCn.genshin?.enable ?? false,
          'cloud_games.cn.zzz.enable': cloudCn.zzz?.enable ?? false,
          'cloud_games.os.enable': cloudOs.enable ?? false,
          'cloud_games.os.genshin.enable': cloudOs.genshin?.enable ?? false,

          'web_activity.enable': web.enable ?? false
        }
      },

      async setConfigData (data, { Result }) {
        try {
          const configDir = path.join(PLUGIN_DIR, 'config')
          if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })

          // 群配置：GTags 原生数组，直接 YAML.stringify
          const groups = Array.isArray(data.groups) ? data.groups : []
          fs.writeFileSync(GROUP_CONFIG_PATH, YAML.stringify({ groups }), 'utf8')

          // 主配置（api + signin）：读取 defSet 模板，替换 ${变量} 后写入 config.yaml
          let template = fs.readFileSync(DEFSET_CONFIG_PATH, 'utf8')
          for (const [field, varName] of Object.entries(TEMPLATE_VARS)) {
            let value = data[field] ?? ''
            if (Array.isArray(value)) value = value.join(',')
            template = template.replace(new RegExp(`\\$\\{${varName}\\}`, 'g'), String(value))
          }
          fs.writeFileSync(CONFIG_PATH, template, 'utf8')

          // MihoyoBBSTools 模板配置：直接读写 YAML
          let bbsTemplate = readBbsToolsTemplateRaw()
          if (!bbsTemplate.mihoyobbs) bbsTemplate.mihoyobbs = {}
          if (!bbsTemplate.games) bbsTemplate.games = { cn: {}, os: {} }
          if (!bbsTemplate.games.cn) bbsTemplate.games.cn = {}
          if (!bbsTemplate.games.os) bbsTemplate.games.os = {}
          if (!bbsTemplate.cloud_games) bbsTemplate.cloud_games = { cn: {}, os: {} }
          if (!bbsTemplate.cloud_games.cn) bbsTemplate.cloud_games.cn = { genshin: {}, zzz: {} }
          if (!bbsTemplate.cloud_games.os) bbsTemplate.cloud_games.os = { genshin: {} }

          // BBS
          bbsTemplate.mihoyobbs.enable = data['mihoyobbs.enable'] ?? true
          bbsTemplate.mihoyobbs.checkin = data['mihoyobbs.checkin'] ?? true
          bbsTemplate.mihoyobbs.read = data['mihoyobbs.read'] ?? false
          bbsTemplate.mihoyobbs.like = data['mihoyobbs.like'] ?? false
          bbsTemplate.mihoyobbs.cancel_like = data['mihoyobbs.cancel_like'] ?? false
          bbsTemplate.mihoyobbs.share = data['mihoyobbs.share'] ?? false

          // CN games
          bbsTemplate.games.cn.enable = data['games.cn.enable'] ?? true
          bbsTemplate.games.cn.retries = data['games.cn.retries'] ?? 3
          bbsTemplate.games.cn.genshin.checkin = data['games.cn.genshin.checkin'] ?? true
          bbsTemplate.games.cn.honkai_sr.checkin = data['games.cn.honkai_sr.checkin'] ?? true
          bbsTemplate.games.cn.zzz.checkin = data['games.cn.zzz.checkin'] ?? true
          bbsTemplate.games.cn.honkai3rd.checkin = data['games.cn.honkai3rd.checkin'] ?? false
          bbsTemplate.games.cn.honkai2.checkin = data['games.cn.honkai2.checkin'] ?? false
          bbsTemplate.games.cn.tears_of_themis.checkin = data['games.cn.tears_of_themis.checkin'] ?? false

          // OS games
          bbsTemplate.games.os.enable = data['games.os.enable'] ?? false
          bbsTemplate.games.os.cookie = data['games.os.cookie'] ?? ''
          bbsTemplate.games.os.genshin.checkin = data['games.os.genshin.checkin'] ?? false
          bbsTemplate.games.os.honkai_sr.checkin = data['games.os.honkai_sr.checkin'] ?? false
          bbsTemplate.games.os.zzz.checkin = data['games.os.zzz.checkin'] ?? false

          // Cloud
          bbsTemplate.cloud_games.cn.enable = data['cloud_games.cn.enable'] ?? false
          bbsTemplate.cloud_games.cn.genshin.enable = data['cloud_games.cn.genshin.enable'] ?? false
          bbsTemplate.cloud_games.cn.zzz.enable = data['cloud_games.cn.zzz.enable'] ?? false
          bbsTemplate.cloud_games.os.enable = data['cloud_games.os.enable'] ?? false
          bbsTemplate.cloud_games.os.genshin.enable = data['cloud_games.os.genshin.enable'] ?? false

          // Web
          bbsTemplate.web_activity.enable = data['web_activity.enable'] ?? false

          fs.writeFileSync(BBS_TOOLS_TEMPLATE_PATH, YAML.stringify(bbsTemplate), 'utf8')

          // 清除 gsCfg 缓存
          delete gsCfg.config.config
          delete gsCfg.defSet.config

          return Result.ok({}, '保存成功~')
        } catch (err) {
          logger.error('[Axiu-Plugin] 保存配置失败:', err)
          return Result.error(`保存失败：${err.message}`)
        }
      }
    }
  }
}
