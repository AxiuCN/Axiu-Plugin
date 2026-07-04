import { fileURLToPath } from 'url'
import path from 'node:path'
import plugin from '../../../lib/plugins/plugin.js'
import { getRestartConfig } from '../components/config.js'
import { RestartManager } from '../modules/restart/RestartManager.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.join(__dirname, '..')

export class McsmRestart extends plugin {
  constructor() {
    super({
      name: '[Axiu-Plugin]重启管理',
      dsc: '#重启 (MCSM云崽实例)',
      event: 'message',
      priority: -Infinity,
      rule: [
        // 仅用于指令列表显示，实际拦截由 accept() 处理
        { reg: '^#重启$', fnc: 'restart', permission: 'master' }
      ]
    })

    const config = getRestartConfig(pluginRoot)
    this.restartMgr = new RestartManager(config)
    this.task = this._buildCronTasks(config.restartCron || [])
  }

  _buildCronTasks(restartCron) {
    if (!restartCron.length) return []
    return restartCron.map(cron => ({
      name: '定时重启',
      cron,
      fnc: () => this.restart()
    }))
  }

  async init() {
    Bot.once('online', () => RestartManager.onBotOnline())
    this.e = {
      reply: msg => Bot.sendMasterMsg(msg),
      isMaster: true,
      group_id: null,
      user_id: null,
      message_id: null,
      self_id: Bot.uin
    }
  }

  /**
   * accept() 在 loader 的 rule 匹配之前执行，优先级最高
   * 匹配 #重启 后返回 'return' 阻止 rule 层继续分发
   */
  async accept(e) {
    if (!/^#重启$/.test(e.msg)) return
    if (!e.isMaster) {
      e.reply('暂无权限，只有主人才能操作')
      return 'return'
    }
    await this.restartMgr.doRestart(e)
    return 'return'
  }

  async restart() {
    await this.restartMgr.doRestart(this.e)
  }
}
