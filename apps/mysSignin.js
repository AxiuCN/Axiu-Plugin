/** 米游社签到 Plugin 入口
 *
 *  命令：
 *    #初始化签到环境 — 检查 Python、安装依赖、拉取子模块（仅 master）
 *    #注册自动签到 — 为当前用户注册签到（所有已绑定 stoken 的账号）
 *    #注册本群签到 — 为群内所有已绑定 stoken 的成员注册（仅 master/admin）
 *    #注册所有群签到 — 为机器人所在全部群的成员注册（仅 master）
 *    #签到名单列表 — 列出所有已注册签到用户（仅 master）
 *    #签到         — 手动执行当前用户的签到
 *    #全部签到     — 手动执行全部已注册用户签到（仅 master，自动签到期间不可用）
 *    #刷新自动签到 — 刷新当前用户所有签到配置的 cookie
 *    #签到状态     — 查看当前用户绑定和签到注册情况
 *    #删除签到     — 删除当前用户的所有签到配置文件（需重新注册）
 *    #删除stoken   — 删除当前用户的所有 stoken 条目（需重新扫码绑定）
 *
 *  定时任务：每日自动签到（cron 从 config/config.yaml → signin.schedule 读取）
 */

import plugin from '../../../lib/plugins/plugin.js'
import {
  SIGNIN_LOG_PREFIX,
  refreshCookie,
  registerUser,
  registerGroupMembers,
  registerAllGroups,
  signinForUser,
  signinForAll,
  refreshUserCookies,
  refreshAllUserCookies,
  deleteUserSigninConfigs,
  deleteUserStoken,
  initEnvironment,
  getSigninStatus,
  formatSummaryReport,
  buildSigninReport,
  buildRefreshReport,
  isAutoSigninRunning,
  setAutoSigninRunning
} from '../modules/mysSignin/signinManager.js'
import { getSigninConfig, listAllRegisteredQQ, listUserConfigs } from '../model/mysSignin/bbsToolsConfig.js'
import { pluginVersion, yunzaiVersion } from '../components/pluginVersion.js'

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
        { reg: '^#注册所有群签到$', fnc: 'registerAllCmd', permission: 'master', log: true },
        { reg: '^#签到名单列表$', fnc: 'listProfiles', permission: 'master', log: true },
        { reg: '^#(开始|手动|测试)?签到$', fnc: 'startSignin', permission: 'all', log: true },
        { reg: '^#全部签到$', fnc: 'signinAll', permission: 'master', log: true },
        { reg: '^#刷新自动签到$', fnc: 'refreshCookieCmd', permission: 'all', log: true },
        { reg: '^#签到状态$', fnc: 'signinStatus', permission: 'all', log: true },
        { reg: '^#删除签到$', fnc: 'deleteSigninCmd', permission: 'all', log: true },
        { reg: '^#删除stoken$', fnc: 'deleteStokenCmd', permission: 'all', log: true }
      ],
      task: [
        {
          name: '米游社自动刷新cookie',
          fnc: () => this.autoRefreshCookies(),
          cron: getSigninConfig().refreshSchedule
        },
        {
          name: '米游社自动签到',
          fnc: () => this.autoSignin(),
          cron: getSigninConfig().schedule
        }
      ]
    })
  }

  /** 动态重载 cron */
  async init () {
    const cfg = getSigninConfig()
    if (cfg.enable && this.task) {
      if (this.task[0]) this.task[0].cron = cfg.refreshSchedule
      if (this.task[1]) this.task[1].cron = cfg.schedule
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
    const failCount = result.failed?.length || 0
    const successCount = result.count || 0
    const total = successCount + failCount
    if (total === 0) {
      // 前置失败（如未绑定 stoken）：直接透出原因，避免 0/0
      await e.reply(result.message + this._reportFooter())
      return true
    }
    let report = `--- 注册签到报告 ---\n注册签到成功: ${successCount}/${total}\n注册签到失败: ${failCount}/${total}`
    // 增量注册明细（仅当有新增/更新时有意义）
    if (result.created > 0 && result.updated > 0) report += `\n（新增 ${result.created} 个账号，更新 ${result.updated} 个账号）`
    else if (result.created > 0) report += `\n（新增 ${result.created} 个账号）`
    else if (result.updated > 0) report += `\n（更新 ${result.updated} 个账号）`
    await e.reply(report + this._reportFooter())
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
    let report = `--- 注册本群签到报告 ---\n注册签到成功: ${result.success}/${result.total}\n注册签到失败: ${result.failed.length}/${result.total}`
    if (result.skipped > 0) report += `\n无变更（已注册）: ${result.skipped} 人`
    await e.reply(report + this._reportFooter())
    return true
  }

  // ==================== #注册所有群签到 ====================

  async registerAllCmd (e) {
    if (isAutoSigninRunning()) {
      await e.reply('签到/注册任务正在执行中，请稍后再试')
      return true
    }

    const allGroupIds = Bot.getGroupList?.() || []
    const groupIds = allGroupIds.filter(id => /^\d+$/.test(String(id)))
    if (groupIds.length === 0) {
      await e.reply('机器人未加入任何群')
      return true
    }

    await e.reply(`共 ${groupIds.length} 个群，开始注册所有群成员（可能需要较长时间）...`)
    setAutoSigninRunning(true)

    try {
      const result = await registerAllGroups()
      const totalMembers = result.groups.reduce((s, g) => s + g.total, 0)
      const totalSuccess = result.groups.reduce((s, g) => s + g.success, 0)
      let report = `--- 注册所有群签到报告 ---\n注册签到成功: ${totalSuccess}/${totalMembers}\n注册签到失败: ${result.groups.reduce((s, g) => s + g.failed.length, 0)}/${totalMembers}`
      for (const g of result.groups) {
        if (g.error) {
          report += `\n群 ${g.groupId}: ${g.error}`
        } else {
          report += `\n群 ${g.groupId}: 成功 ${g.success}/${g.total}` +
            (g.failed.length > 0 ? `，失败 ${g.failed.length}` : '') +
            (g.skipped > 0 ? `，无变更 ${g.skipped}` : '')
        }
      }
      await e.reply(report + this._reportFooter())
    } catch (err) {
      logger?.error(`${SIGNIN_LOG_PREFIX} 全群注册异常: ${err.message}`)
      await e.reply(`全群注册失败: ${err.message}`)
    } finally {
      setAutoSigninRunning(false)
    }
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
    if (!getSigninConfig().manualSignin) {
      await e.reply('手动签到已关闭')
      return true
    }

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
    await e.reply(result.message + this._reportFooter())
    return true
  }

  // ==================== #全部签到 ====================

  async signinAll (e) {
    if (!getSigninConfig().manualSignin) {
      await e.reply('手动签到已关闭')
      return true
    }

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
      await e.reply(report + this._reportFooter())
    } finally {
      setAutoSigninRunning(false)
    }
    return true
  }

  // ==================== #刷新自动签到 ====================

  async refreshCookieCmd (e) {
    await e.reply('正在刷新签到 cookie...')
    const result = await refreshUserCookies(e.user_id)
    await e.reply(result.message + this._reportFooter())
    return true
  }

  // ==================== #签到状态 ====================

  async signinStatus (e) {
    const { message } = await getSigninStatus(e.user_id)
    await e.reply(message)
    return true
  }

  // ==================== #删除签到 ====================

  async deleteSigninCmd (e) {
    const result = await deleteUserSigninConfigs(e.user_id)
    await e.reply(result.message)
    return true
  }

  // ==================== #删除stoken ====================

  async deleteStokenCmd (e) {
    const result = await deleteUserStoken(e.user_id)
    await e.reply(result.message)
    return true
  }

  // ==================== 自动刷新cookie（定时任务） ====================

  async autoRefreshCookies () {
    const cfg = getSigninConfig()
    if (!cfg.enable) return true

    logger?.info(`${SIGNIN_LOG_PREFIX} 定时刷新cookie开始`)
    const result = await refreshAllUserCookies()
    logger?.info(`${SIGNIN_LOG_PREFIX} 定时刷新cookie完成: ${result.message}`)

    if (cfg.notifyGroup && result.total > 0) {
      const { header, failedUsers } = buildRefreshReport(result)
      await this._sendReport(header, failedUsers)
    }
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

      // 发送签到汇总通知
      if (cfg.notifyGroup && summary.details.length > 0) {
        const { header, failedUsers } = buildSigninReport(summary)
        await this._sendReport(header, failedUsers)
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

  /** 向 master 和配置的群聊发送通知消息 */
  async _sendNotification (message) {
    const cfg = getSigninConfig()

    // 通知 master
    try {
      const masterQQ = (await import('../../../lib/config/config.js')).default?.masterQQ
      if (masterQQ && masterQQ.length > 0) {
        const friend = Bot.pickFriend(masterQQ[0])
        await friend.sendMsg(message)
      }
    } catch (err) {
      logger?.warn(`${SIGNIN_LOG_PREFIX} 发送master通知失败: ${err.message}`)
    }

    // 通知配置的群聊
    if (cfg.reportGroups) {
      const groupIds = String(cfg.reportGroups).split(/[,，\s]+/).filter(Boolean)
      for (const groupId of groupIds) {
        try {
          const group = Bot.pickGroup(groupId.trim())
          if (group) await group.sendMsg(message)
        } catch (err) {
          logger?.warn(`${SIGNIN_LOG_PREFIX} 发送群通知失败 group=${groupId}: ${err.message}`)
        }
      }
    }
  }

  /**
   * 发送结构化汇总报告（带失败用户分组与版权行）
   * @param {string} header - 报告头（含统计）
   * @param {Array<{qq: string, lines: string[]}>} failedUsers - 失败用户分组明细
   * 群聊：失败用户在通知群内用 @，否则显示 QQ 号；主人在私聊，一律用 QQ 号文本
   */
  async _sendReport (header, failedUsers) {
    const cfg = getSigninConfig()
    const footer = `\n\nCreated By TRSS-Yunzai v${yunzaiVersion} & Axiu-Plugin v${pluginVersion}`

    // 主人私聊：一律 QQ 号文本（不用 @）
    try {
      const masterQQ = (await import('../../../lib/config/config.js')).default?.masterQQ
      if (masterQQ && masterQQ.length > 0) {
        const friend = Bot.pickFriend(masterQQ[0])
        let msg = header
        for (const u of failedUsers) {
          msg += `\nQQ:${u.qq}\n${u.lines.join('\n')}`
        }
        await friend.sendMsg(msg + footer)
      }
    } catch (err) {
      logger?.warn(`${SIGNIN_LOG_PREFIX} 发送master报告失败: ${err.message}`)
    }

    // 通知配置的群聊：失败用户在群内 @，不在群内显示 QQ 号
    if (cfg.reportGroups) {
      const groupIds = String(cfg.reportGroups).split(/[,，\s]+/).filter(Boolean)
      for (const groupId of groupIds) {
        try {
          const group = Bot.pickGroup(groupId.trim())
          if (!group) continue
          // 群成员集合（判断 @ 是否有效）
          let memberMap = null
          try { memberMap = await group.getMemberMap() } catch { /* 成员拉取失败降级为 QQ 号 */ }
          const isMember = memberMap ? (qq) => memberMap.has(String(qq)) : () => false

          const segments = [{ type: 'text', text: header }]
          for (const u of failedUsers) {
            if (isMember(u.qq)) {
              segments.push({ type: 'at', qq: Number(u.qq) })
              segments.push({ type: 'text', text: '\n' + u.lines.join('\n') })
            } else {
              segments.push({ type: 'text', text: `\nQQ:${u.qq}\n${u.lines.join('\n')}` })
            }
          }
          segments.push({ type: 'text', text: footer })
          await group.sendMsg(segments)
        } catch (err) {
          logger?.warn(`${SIGNIN_LOG_PREFIX} 发送群报告失败 group=${groupId}: ${err.message}`)
        }
      }
    }
  }

  /** 报告尾版权行（用户主动命令回复用） */
  _reportFooter () {
    return `\n\nCreated By TRSS-Yunzai v${yunzaiVersion} & Axiu-Plugin v${pluginVersion}`
  }
}
