import { fileURLToPath } from 'url'
import path from 'node:path'
import plugin from '../../../lib/plugins/plugin.js'
import { getRestartConfig } from '../components/config.js'
import { RestartManager } from '../modules/restart/RestartManager.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.join(__dirname, '..')

export class McsRestart extends plugin {
  constructor() {
    super({
      name: '[Axiu-Plugin]重启管理',
      dsc: '#重启 (MCS云崽实例)',
      event: 'message',
      priority: -Infinity,
      rule: [
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

  async restart() {
    await this.restartMgr.doRestart(this.e)
  }
}
