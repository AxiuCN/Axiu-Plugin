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
import {
  readConfigWithStatus,
  readField,
  resolveConfigPath,
  validateRendered,
  writeConfigAtomic,
  yamlValue
} from '../components/config.js'
import {
  groupShapeOf,
  groupsFromPanel,
  groupsToPanel,
  resolveGroupConfigPath
} from '../components/groupConfig.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PLUGIN_DIR = path.join(__dirname, '..')

/**
 * 配置路径：主配置 / 群配置走 `components/` 的解析函数（与插件侧读的是同一份，
 * 且回归套件能用 `AXIU_CONFIG_DIR` 重定向）；MihoyoBBSTools 模板只在锅巴这条路上用，跟着同一目录。
 * 模板 `defSet/config.yaml` 是只读输入，路径固定。
 */
const configDir = () => process.env.AXIU_CONFIG_DIR || path.join(PLUGIN_DIR, 'config')
const CONFIG_PATH = () => resolveConfigPath()
const GROUP_CONFIG_PATH = () => resolveGroupConfigPath(PLUGIN_DIR)
const BBS_TOOLS_TEMPLATE_PATH = () => path.join(configDir(), 'MihoyoBBSTools_config.yaml')
const BBS_TOOLS_TEMPLATE_EXAMPLE = () => path.join(configDir(), 'MihoyoBBSTools_config.yaml.example')
const DEFSET_CONFIG_PATH = path.join(PLUGIN_DIR, 'defSet', 'config.yaml')

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
  'signin.manualSignin': 'signin_manualSignin',
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
  const configPath = GROUP_CONFIG_PATH()
  try {
    if (fs.existsSync(configPath)) {
      return YAML.parse(fs.readFileSync(configPath, 'utf8')) || {}
    }
  } catch (err) {
    logger.error('[Axiu-Plugin] 读取群配置失败:', err)
  }
  const examplePath = path.join(configDir(), 'group_config.yaml.example')
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
  if (fs.existsSync(BBS_TOOLS_TEMPLATE_PATH())) {
    file = BBS_TOOLS_TEMPLATE_PATH()
  } else if (fs.existsSync(BBS_TOOLS_TEMPLATE_EXAMPLE())) {
    file = BBS_TOOLS_TEMPLATE_EXAMPLE()
  }
  if (!file) return {}
  try {
    return YAML.parse(fs.readFileSync(file, 'utf8')) || {}
  } catch (err) {
    logger.error('[Axiu-Plugin] 读取 MihoyoBBSTools 模板失败：', err)
    return {}
  }
}

/**
 * 按 defSet 模板渲染出运行时配置文本
 *
 * 值一律经 `yamlValue()`：字符串加引号并转义，所以以 `*` 开头的 cron（`*\/30 * * * * ?`）不会被
 * YAML 当别名语法，含 `#` / `:` / 引号 / 换行的值也写不坏。**禁止**在这里裸拼字符串。
 */
function renderTemplate (template, values) {
  let out = template
  for (const [field, varName] of Object.entries(TEMPLATE_VARS)) {
    /* 函数替换：值里的 $& / $1 / $$ 不会被 String.replace 当特殊语法展开 */
    out = out.replace(new RegExp(`\\$\\{${varName}\\}`, 'g'), () => yamlValue(values[field]))
  }
  return out
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
      iconColor: '#1677ff',
      iconPath: path.join(PLUGIN_DIR, 'resources/images/Axiu.ico')
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
        /* 读**文件当前内容**（只有读不出来时才退回参考默认值），不读模块加载那一刻的快照 */
        const read = readConfigWithStatus()
        const cfg = read.config
        const signinReportGroups = readField(cfg, 'signin.reportGroups')
        const groupRaw = readGroupConfigRaw()
        const bbsTemplate = readBbsToolsTemplateRaw()
        const mihoyobbs = bbsTemplate.mihoyobbs || {}
        const gamesCn = bbsTemplate.games?.cn || {}
        const gamesOs = bbsTemplate.games?.os || {}
        const cloudCn = bbsTemplate.cloud_games?.cn || {}
        const cloudOs = bbsTemplate.cloud_games?.os || {}
        const web = bbsTemplate.web_activity || {}

        return {
          // 群配置：手写的映射格式也转成行，面板不丢规则
          groups: groupsToPanel(groupRaw.groups),

          // api 过码配置
          'api.type': readField(cfg, 'api.type') ?? 1,
          'api.api': readField(cfg, 'api.api') ?? '',
          'api.resapi': readField(cfg, 'api.resapi') ?? '',
          'api.key': readField(cfg, 'api.key') ?? '',
          'api.query': readField(cfg, 'api.query') ?? '',
          'api.resquery': readField(cfg, 'api.resquery') ?? '',
          'api.startApi': readField(cfg, 'api.startApi') ?? false,
          'api.Port': readField(cfg, 'api.Port') ?? 3000,
          'api.bindHost': readField(cfg, 'api.bindHost') ?? '127.0.0.1',
          'api.Address': readField(cfg, 'api.Address') ?? 'http://127.0.0.1:3000',
          'api.verifyAddr': readField(cfg, 'api.verifyAddr') ?? 'http://127.0.0.1:3000/GTest/register',
          'api.GtestType': readField(cfg, 'api.GtestType') ?? 2,
          'api.qrLogin_enabled': readField(cfg, 'api.qrLogin_enabled') ?? true,

          // srChallenge
          'srChallenge.enabled': readField(cfg, 'srChallenge.enabled') ?? true,

          // srChallengeRank
          'srChallengeRank.enabled': readField(cfg, 'srChallengeRank.enabled') ?? true,
          'srChallengeRank.rankNumber': readField(cfg, 'srChallengeRank.rankNumber') ?? 20,

          // gsAbyss
          'gsAbyss.enabled': readField(cfg, 'gsAbyss.enabled') ?? true,

          // gsAbyssRank
          'gsAbyssRank.enabled': readField(cfg, 'gsAbyssRank.enabled') ?? true,
          'gsAbyssRank.rankNumber': readField(cfg, 'gsAbyssRank.rankNumber') ?? 20,

          // proxySpeak
          'proxySpeak.enabled': readField(cfg, 'proxySpeak.enabled') ?? true,

          // signin 主配置
          'signin.enable': readField(cfg, 'signin.enable') ?? true,
          'signin.manualSignin': readField(cfg, 'signin.manualSignin') ?? true,
          'signin.schedule': readField(cfg, 'signin.schedule') ?? '0 0 5 * * ? *',
          'signin.refreshSchedule': readField(cfg, 'signin.refreshSchedule') ?? '0 30 4 * * ? *',
          'signin.randomDelayMin': readField(cfg, 'signin.randomDelayMin') ?? 0,
          'signin.pythonCommand': readField(cfg, 'signin.pythonCommand') ?? 'python',
          'signin.notifyGroup': readField(cfg, 'signin.notifyGroup') ?? true,
          // GSelectGroup 需要数组，config 存的是逗号分隔字符串，这里做转换
          'signin.reportGroups': signinReportGroups ? String(signinReportGroups).split(/[,，\s]+/).filter(Boolean) : [],
          'signin.captchaRetries': readField(cfg, 'signin.captchaRetries') ?? 3,
          'signin.captchaTimeout': readField(cfg, 'signin.captchaTimeout') ?? 240,

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
          const dir = configDir()
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

          /* 读一次当前文件：表单没提交的键要用它兜底，回执里也要说清原文件读不读得出来 */
          const read = readConfigWithStatus()

          // ---------- 主配置：模板渲染 → 写前验证 → 原子替换 ----------
          let template
          try {
            template = fs.readFileSync(DEFSET_CONFIG_PATH, 'utf8')
          } catch (err) {
            return Result.error(`读不到配置模板 ${DEFSET_CONFIG_PATH}：${err.message}`)
          }

          const values = {}
          for (const [field] of Object.entries(TEMPLATE_VARS)) {
            /* 面板没提交的键沿用文件当前值（**不能**退回空串：那会把用户的值抹掉） */
            let value = field in data ? data[field] : readField(read.config, field)
            value = value ?? ''
            if (Array.isArray(value)) value = value.join(',')
            values[field] = value
          }
          const text = renderTemplate(template, values)
          const check = validateRendered(text, values, CONFIG_PATH())
          if (!check.ok) {
            return Result.error(
              check.parseError
                ? `保存被拒绝（你的文件没有被改动）：渲染出的配置解析不回来 —— ${check.parseError}`
                : `保存被拒绝（你的文件没有被改动）：这些值写不成有效的 YAML —— ${check.invalid.join('、')}`
            )
          }

          // ---------- 群配置：保持文件原有形态；没有群号的行不算内容，不许静默清空 ----------
          let groupText = null
          let groupSkipped = 0
          if (data.groups !== undefined) {
            if (!Array.isArray(data.groups)) return Result.error('保存被拒绝：群规则必须是数组（你的文件没有被改动）')
            const rows = groupsToPanel(data.groups)
            if (rows.length === 0 && data.groups.length > 0) {
              return Result.error('保存被拒绝：群规则里没有有效的群号（你的文件没有被改动）')
            }
            groupSkipped = data.groups.length - rows.length
            const built = groupsFromPanel(rows, groupShapeOf(readGroupConfigRaw().groups))
            if (built.error) return Result.error(`保存被拒绝：${built.error}（你的文件没有被改动）`)
            groupText = YAML.stringify({ groups: built.groups })
            /* 群配置也要过同一道闸：写出去的东西必须能原样读回同样的行 */
            if (JSON.stringify(groupsToPanel(YAML.parse(groupText).groups)) !== JSON.stringify(rows)) {
              return Result.error('保存被拒绝：群规则写不成等价的 YAML（你的文件没有被改动）')
            }
          }

          // ---------- MihoyoBBSTools 模板配置：直接读写 YAML ----------
          const bbsTemplate = readBbsToolsTemplateRaw()
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

          const bbsText = YAML.stringify(bbsTemplate)

          // ---------- 全部验证通过后才落盘 ----------
          writeConfigAtomic(CONFIG_PATH(), text)
          if (groupText !== null) writeConfigAtomic(GROUP_CONFIG_PATH(), groupText)
          fs.writeFileSync(BBS_TOOLS_TEMPLATE_PATH(), bbsText, 'utf8')

          // 清除 gsCfg 缓存
          delete gsCfg.config.config
          delete gsCfg.defSet.config

          const notes = []
          if (read.error) notes.push(`原配置读不出来（${read.error}），其余键已按参考默认值重写，请核对`)
          if (groupSkipped) notes.push(`已忽略 ${groupSkipped} 行没有群号的群规则`)
          return Result.ok({}, `保存成功~${notes.length ? `（${notes.join('；')}）` : ''}`)
        } catch (err) {
          logger.error('[Axiu-Plugin] 保存配置失败:', err)
          return Result.error(`保存失败：${err.message}`)
        }
      }
    }
  }
}
