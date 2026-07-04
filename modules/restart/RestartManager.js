import fs from 'node:fs'
import { segment } from 'oicq'
import { LOG_PREFIX, REDIS_KEY_RESTART, MCS_USERDATA_PATH } from '../../components/constants.js'
import { restartInstance } from '../../model/McsApi.js'

/**
 * 重启流程管理器
 * 负责：凭证解析 → Redis 上下文保存 → MCS/原生重启 → 上线通知
 */
export class RestartManager {
  /**
   * @param {object} config - restart 配置（来自 config.yaml 的 restart 字段）
   */
  constructor(config) {
    this.enableMcs = config.enableMcs === true
    this.useMcsPluginCfg = config.useMcsManagerPluginConfig === true
    this.instanceUuid = config.mcsInstanceUuid || ''
    this.daemonId = config.mcsDaemonId || ''

    // 凭证来源选择
    if (this.useMcsPluginCfg) {
      const masterQQ = this._getMasterQQ()
      const userData = this._getMcsUserData(masterQQ)
      if (userData) {
        this.mcsHost = userData.host
        this.mcsPort = userData.port
        this.mcsApiKey = userData.apiKey
        logger.info(`${LOG_PREFIX}[restart] 已从 mcsmanager-plugin 用户数据读取连接信息`)
      } else {
        logger.warn(`${LOG_PREFIX}[restart] 未找到 mcsmanager-plugin 用户数据，回退到配置文件`)
        this._fillFromConfig(config)
      }
    } else {
      this._fillFromConfig(config)
    }
  }

  _fillFromConfig(config) {
    this.mcsHost = config.mcsHost || ''
    this.mcsPort = config.mcsPort || 0
    this.mcsApiKey = config.mcsApiKey || ''
  }

  _getMasterQQ() {
    return Bot.masterQQ?.[0] || Object.keys(Bot.adapter?.qq || {})[0] || ''
  }

  _getMcsUserData(masterQQ) {
    try {
      if (fs.existsSync(MCS_USERDATA_PATH)) {
        const userdata = JSON.parse(fs.readFileSync(MCS_USERDATA_PATH, 'utf8'))
        const userinfo = userdata[masterQQ]
        if (userinfo?.apiKey && userinfo?.baseUrl) {
          const url = new URL(userinfo.baseUrl)
          return {
            host: url.hostname,
            port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 23333),
            apiKey: userinfo.apiKey
          }
        }
      }
    } catch (err) {
      logger.error(`${LOG_PREFIX}[restart] 读取 MCS 用户数据失败:`, err)
    }
    return null
  }

  /** 检查 MCS 连接信息是否完整 */
  get _mcsReady() {
    return this.enableMcs &&
      this.mcsHost && this.mcsPort &&
      this.mcsApiKey && this.instanceUuid && this.daemonId
  }

  /**
   * 执行重启
   * @param {object} e - 消息事件对象（含 reply 方法）
   */
  async doRestart(e) {
    this.e = e
    await this._saveContext(e)

    if (this._mcsReady) {
      return this._mcsRestart()
    } else {
      return this._nativeRestart()
    }
  }

  /** 将重启上下文写入 Redis，供 bot 重新上线后读取 */
  async _saveContext(e) {
    await e.reply(`开始重启，本次运行时长${Bot.getTimeDiff()}`)
    return redis.set(REDIS_KEY_RESTART, JSON.stringify({
      isExit: false,
      group_id: e.group_id,
      user_id: e.user_id,
      bot_id: e.self_id,
      msg_id: e.message_id,
      time: Date.now()
    }))
  }

  /** MCS 面板重启 */
  async _mcsRestart() {
    const result = await restartInstance({
      host: this.mcsHost,
      port: this.mcsPort,
      apiKey: this.mcsApiKey,
      instanceUuid: this.instanceUuid,
      daemonId: this.daemonId
    })

    if (!result.success) {
      await this.e.reply(`MCS 云崽实例重启失败（${result.error}），回退到原生重启...`)
      await this._nativeRestart()
    }
    // 成功时 MCS 会终止进程，不需要额外操作
  }

  /** 框架原生重启 */
  async _nativeRestart() {
    const ret = await Bot.restart()
    await this.e.reply(`原生重启错误\n${Bot.String(ret)}`)
  }

  /**
   * Bot 上线后调用：读取 Redis 上下文，发送重启完成通知
   * 应在 Bot.once('online', ...) 中绑定
   */
  static async onBotOnline() {
    let raw = await redis.get(REDIS_KEY_RESTART)
    if (!raw) return
    await redis.del(REDIS_KEY_RESTART)

    let context
    try {
      context = JSON.parse(raw)
    } catch {
      return
    }
    if (context.isStop) return

    const elapsed = Bot.getTimeDiff(context.time)
    const msg = [context.isExit ? `开机成功，距离上次停止${elapsed}` : `重启成功，用时${elapsed}`]
    if (context.msg_id) msg.unshift(segment.reply(context.msg_id))

    if (context.group_id) {
      await Bot.sendGroupMsg(context.bot_id, context.group_id, msg)
    } else if (context.user_id) {
      await Bot.sendFriendMsg(context.bot_id, context.user_id, msg)
    } else {
      await Bot.sendMasterMsg(msg)
    }
  }
}
