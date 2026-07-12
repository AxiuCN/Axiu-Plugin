/** 米游社签到 Plugin 入口
 *
 *  命令：
 *    #初始化签到环境 — 检查 Python、安装依赖、拉取子模块（仅 master）
 *    #注册自动签到 — 为当前用户注册签到（所有已绑定 stoken 的账号）
 *    #注册本群签到 — 为群内所有已绑定 stoken 的成员注册（仅 master/admin）
 *    #签到名单列表 — 列出所有已注册签到用户（仅 master）
 *    #开始签到     — 手动执行当前用户的签到
 *    #全部签到     — 手动执行全部已注册用户签到（仅 master，自动签到期间不可用）
 *    #刷新自动签到 — 刷新当前用户所有签到配置的 cookie
 *    #签到状态     — 查看当前用户绑定和签到注册情况
 *
 *  定时任务：每日自动签到（cron 从 config/config.yaml → signin.schedule 读取）
 */

import plugin from '../../../lib/plugins/plugin.js'
import {
  SIGNIN_LOG_PREFIX,
  refreshCookie,
  registerUser,
  registerGroupMembers,
  signinForUser,
  signinForAll,
  refreshUserCookies,
  initEnvironment,
  getSigninStatus,
  formatSummaryReport,
  isAutoSigninRunning,
  setAutoSigninRunning
} from '../modules/mysSignin/signinManager.js'
import { getSigninConfig, listAllRegisteredQQ, listUserConfigs } from '../model/mysSignin/bbsToolsConfig.js'

export class MysSigninApp extends plugin {
  constructor () {
    super({
      name: '[Axiu-Plugin] 米游社签到',
      dsc: '米游社自动签到（社区+游戏+云游戏）',
      event: 'message',
      priority: 500,
      rule: [
        { reg: '^#初始化签到环境$', fnc: 'initEnv', permission: 'master', log: true },
        { reg: '^#注册自动签到$', fnc: 'register', permission: 'all', log: true },
        { reg: '^#注册本群签到$', fnc: 'groupRegister', permission: 'all', log: true },
        { reg: '^#签到名单列表$', fnc: 'listProfiles', permission: 'master', log: true },
        { reg: '^#(开始|手动|测试)签到$', fnc: 'startSignin', permission: 'all', log: true },
        { reg: '^#全部签到$', fnc: 'signinAll', permission: 'master', log: true },
        { reg: '^#刷新自动签到$', fnc: 'refreshCookieCmd', permission: 'all', log: true },
        { reg: '^#签到状态$', fnc: 'signinStatus', permission: 'all', log: true }
      ],
      task: [
        {
          name: '米游社自动签到',
          fnc: 'autoSignin',
          // cron 在 init() 中动态加载
          cron: getSigninConfig().schedule
        }
      ]
    })
  }

  /** 动态重载 cron */
  async init () {
    const cfg = getSigninConfig()
    if (cfg.enable && this.task && this.task[0]) {
      this.task[0].cron = cfg.schedule
    }
  }

  // ==================== #初始化签到环境 ====================

  async initEnv (e) {
    await e.reply('正在初始化签到环境，请稍候...')
    const result = await initEnvironment()
    if (result.ok) {
      await e.reply(`签到环境初始化完成\n${result.message}`)
    } else {
      await e.reply(`签到环境初始化失败\n${result.message}`)
    }
    return true
  }

  // ==================== #注册自动签到 ====================

  async register (e) {
    await e.reply('正在注册自动签到...')
    const result = await registerUser(e.user_id)
    await e.reply(result.message)
    return true
  }

  // ==================== #注册本群签到 ====================

  async groupRegister (e) {
    if (!e.isGroup) {
      await e.reply('此命令仅在群聊中可用')
      return true
    }

    // 权限检查：master 或群管理
    if (!e.isMaster) {
      const group = e.group || Bot.pickGroup(e.group_id)
      try {
        const member = await group?.pickMember(e.user_id)?.getInfo()
        if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
          await e.reply('仅群主/管理员可执行此操作')
          return true
        }
      } catch {
        await e.reply('权限检查失败，请稍后重试')
        return true
      }
    }

    await e.reply('正在获取群成员列表并注册签到...')

    // 获取群成员
    let memberIds = []
    try {
      const group = e.group || Bot.pickGroup(e.group_id)
      const memberMap = await group.getMemberMap()
      memberIds = [...memberMap.keys()].filter(id => String(id) !== String(Bot.uin))
    } catch (err) {
      logger?.error(`${SIGNIN_LOG_PREFIX} 获取群成员失败: ${err.message}`)
      await e.reply('获取群成员列表失败')
      return true
    }

    if (memberIds.length === 0) {
      await e.reply('群成员列表为空')
      return true
    }

    await e.reply(`共 ${memberIds.length} 名成员，开始注册（可能需要几分钟）...`)
    const result = await registerGroupMembers(memberIds)
    await e.reply(result.message)
    return true
  }

  // ==================== #签到名单列表 ====================

  async listProfiles (e) {
    const qqList = listAllRegisteredQQ()
    if (qqList.length === 0) {
      await e.reply('暂无已注册签到用户')
      return true
    }

    let msg = `已注册签到用户 (共 ${qqList.length} 人):`
    for (const qq of qqList.slice(0, 30)) {
      const configs = listUserConfigs(qq)
      msg += `\n  QQ=${qq}: ${configs.length} 个账号`
    }
    if (qqList.length > 30) {
      msg += `\n  ...及其他 ${qqList.length - 30} 人`
    }
    // 转发长消息
    const forwardMsg = await e.runtime.makeForwardMsg([{
      message: msg, nickname: Bot.nickname || 'Yunzai-Bot', user_id: Bot.uin
    }])
    await e.reply(forwardMsg)
    return true
  }

  // ==================== #开始签到 ====================

  async startSignin (e) {
    if (isAutoSigninRunning()) {
      await e.reply('自动签到正在执行中，请稍后再试')
      return true
    }

    const configs = listUserConfigs(e.user_id)
    if (configs.length === 0) {
      await e.reply('未注册签到\n发送【#注册自动签到】进行注册')
      return true
    }

    await e.reply(`开始签到 (共 ${configs.length} 个账号)...`)
    const result = await signinForUser(e.user_id, false)
    await e.reply(result.message)
    return true
  }

  // ==================== #全部签到 ====================

  async signinAll (e) {
    if (isAutoSigninRunning()) {
      await e.reply('自动签到正在执行中，请勿重复执行')
      return true
    }

    const qqList = listAllRegisteredQQ()
    if (qqList.length === 0) {
      await e.reply('暂无已注册签到用户')
      return true
    }

    await e.reply(`开始全部签到 (共 ${qqList.length} 个用户)...`)
    setAutoSigninRunning(true)

    try {
      const summary = await signinForAll(false)
      const report = formatSummaryReport(summary)
      await e.reply(report)
    } finally {
      setAutoSigninRunning(false)
    }
    return true
  }

  // ==================== #刷新自动签到 ====================

  async refreshCookieCmd (e) {
    await e.reply('正在刷新签到 cookie...')
    const result = await refreshUserCookies(e.user_id)
    await e.reply(result.message)
    return true
  }

  // ==================== #签到状态 ====================

  async signinStatus (e) {
    const { message } = await getSigninStatus(e.user_id)
    await e.reply(message)
    return true
  }

  // ==================== 自动签到（定时任务） ====================

  async autoSignin () {
    const cfg = getSigninConfig()
    if (!cfg.enable) {
      logger?.info(`${SIGNIN_LOG_PREFIX} 自动签到已关闭`)
      return true
    }

    if (isAutoSigninRunning()) {
      logger?.warn(`${SIGNIN_LOG_PREFIX} 自动签到已在执行中，跳过`)
      return true
    }

    // 随机延迟
    if (cfg.randomDelayMin > 0) {
      const delay = Math.floor(Math.random() * cfg.randomDelayMin * 60000)
      logger?.info(`${SIGNIN_LOG_PREFIX} 随机延迟 ${(delay / 1000).toFixed(0)}s 后开始`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    logger?.info(`${SIGNIN_LOG_PREFIX} 自动签到开始`)
    setAutoSigninRunning(true)

    try {
      const summary = await signinForAll(true)

      // 向 master 发送签到汇总（含失败详情）
      if (cfg.notifyGroup && summary.details.length > 0) {
        await this._notifyGroups(summary)
      }

      logger?.info(
        `${SIGNIN_LOG_PREFIX} 自动签到完成: ${summary.success}/${summary.total} 成功`
      )
    } catch (err) {
      logger?.error(`${SIGNIN_LOG_PREFIX} 自动签到异常: ${err.message}`)
    } finally {
      setAutoSigninRunning(false)
    }
    return true
  }

  /** 签到完成后向 master 发送汇总 */
  async _notifyGroups (summary) {
    const report = formatSummaryReport(summary)
    try {
      // 通过 config 获取 masterQQ
      const masterQQ = (await import('../../../lib/config/config.js')).default?.masterQQ
      if (masterQQ && masterQQ.length > 0) {
        const friend = Bot.pickFriend(masterQQ[0])
        await friend.sendMsg(report)
      }
    } catch (err) {
      logger?.warn(`${SIGNIN_LOG_PREFIX} 发送汇总通知失败: ${err.message}`)
    }
  }
}
