import { segment } from 'oicq'
import { LOG_PREFIX, REDIS_KEY_RESTART } from '../../components/constants.js'
import { restartInstance } from '../../model/McsmApi.js'

/**
 * 重启流程管理器
 * 负责：配置读取 → Redis 上下文保存 → MCSM/原生重启 → 上线通知
 */
export class RestartManager {
  /**
   * @param {object} config - restart 配置（来自 config.yaml 的 restart 字段）
   */
  constructor(config) {
    this.enableMcsm = config.enableMcsm === true
    this.mcsmHost = config.mcsmHost || ''
    this.mcsmPort = config.mcsmPort || 0
    this.mcsmApiKey = config.mcsmApiKey || ''
    this.instanceUuid = config.mcsmInstanceUuid || ''
    this.daemonId = config.mcsmDaemonId || ''
  }

  /** 检查 MCSM 连接信息是否完整 */
  get _mcsmReady() {
    return this.enableMcsm &&
      this.mcsmHost && this.mcsmPort &&
      this.mcsmApiKey && this.instanceUuid && this.daemonId
  }

  /**
   * 执行重启
   * @param {object} e - 消息事件对象（含 reply 方法）
   */
  async doRestart(e) {
    this.e = e
    await this._saveContext(e)

    if (this._mcsmReady) {
      return this._mcsmRestart()
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

  /** MCSM 面板重启 */
  async _mcsmRestart() {
    const result = await restartInstance({
      host: this.mcsmHost,
      port: this.mcsmPort,
      apiKey: this.mcsmApiKey,
      instanceUuid: this.instanceUuid,
      daemonId: this.daemonId
    })

    if (!result.success) {
      await this.e.reply(`MCSM 云崽实例重启失败（${result.error}），回退到原生重启...`)
      await this._nativeRestart()
    }
    // 成功时 MCSM 会终止进程，不需要额外操作
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
