import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'

const CONFIG_PATH = path.join(process.cwd(), 'plugins/Axiu-Plugin/config/config.yaml')
const MCS_USERDATA_PATH = path.join(process.cwd(), 'data/mctool/mcsuserdata.json')

function getRestartConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, 'utf8')
      const config = YAML.parse(content) || {}
      return config.restart || {}
    }
  } catch (err) {
    logger.error('[Axiu-Plugin][mcsRestart] 读取配置失败:', err)
  }
  return {}
}

function getMcsUserData(masterQQ) {
  try {
    if (fs.existsSync(MCS_USERDATA_PATH)) {
      const content = fs.readFileSync(MCS_USERDATA_PATH, 'utf8')
      const userdata = JSON.parse(content)
      const userinfo = userdata[masterQQ]
      if (userinfo && userinfo.apiKey && userinfo.baseUrl) {
        const url = new URL(userinfo.baseUrl)
        return {
          host: url.hostname,
          port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 23333),
          apiKey: userinfo.apiKey
        }
      }
    }
  } catch (err) {
    logger.error('[Axiu-Plugin][mcsRestart] 读取MCS用户数据失败:', err)
  }
  return null
}

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

    this.key = 'Yz:restart'
    const cfg = getRestartConfig()

    this.enableMcs = cfg.enableMcs === true
    this.useMcsPluginCfg = cfg.useMcsManagerPluginConfig === true

    // 实例UUID和守护进程ID必须手动填写
    this.instanceUuid = cfg.mcsInstanceUuid || ''
    this.daemonId = cfg.mcsDaemonId || ''

    // 根据配置决定面板地址和API Key的来源
    if (this.useMcsPluginCfg) {
      const masterQQ = Bot.masterQQ?.[0] || Object.keys(Bot.adapter?.qq || {})[0] || ''
      const userData = getMcsUserData(masterQQ)
      if (userData) {
        this.mcsHost = userData.host
        this.mcsPort = userData.port
        this.mcsApiKey = userData.apiKey
        logger.info('[Axiu-Plugin][mcsRestart] 已从mcsmanager-plugin用户数据读取连接信息')
      } else {
        logger.warn('[Axiu-Plugin][mcsRestart] 未找到mcsmanager-plugin用户数据，回退到配置文件')
        this.mcsHost = cfg.mcsHost || ''
        this.mcsPort = cfg.mcsPort || 0
        this.mcsApiKey = cfg.mcsApiKey || ''
      }
    } else {
      this.mcsHost = cfg.mcsHost || ''
      this.mcsPort = cfg.mcsPort || 0
      this.mcsApiKey = cfg.mcsApiKey || ''
    }

    // 定时重启cron（可选，留空则不执行定时任务）
    this.restartCron = cfg.restartCron || []
    this.task = []
    this._registerCronTasks()
  }

  _registerCronTasks() {
    if (this.restartCron.length) {
      for (const cron of this.restartCron) {
        this.task.push({
          name: '定时重启',
          cron,
          fnc: () => this.restart()
        })
      }
    }
  }

  async init() {
    Bot.once('online', this.restartMsg.bind(this))
    this.e = {
      reply: msg => Bot.sendMasterMsg(msg),
      isMaster: true,
      group_id: null,
      user_id: null,
      message_id: null,
      self_id: Bot.uin
    }
  }

  async restartMsg() {
    let restart = await redis.get(this.key)
    if (!restart) return
    await redis.del(this.key)
    restart = JSON.parse(restart)
    if (restart.isStop) return

    const time = Bot.getTimeDiff(restart.time)
    const msg = [restart.isExit ? `开机成功，距离上次停止${time}` : `重启成功，用时${time}`]
    if (restart.msg_id) msg.unshift(segment.reply(restart.msg_id))

    if (restart.group_id) {
      await Bot.sendGroupMsg(restart.bot_id, restart.group_id, msg)
    } else if (restart.user_id) {
      await Bot.sendFriendMsg(restart.bot_id, restart.user_id, msg)
    } else {
      await Bot.sendMasterMsg(msg)
    }
  }

  async restart() {
    await this.set()

    const mcsReady = this.enableMcs && this.mcsHost && this.mcsPort &&
                     this.mcsApiKey && this.instanceUuid && this.daemonId
    if (mcsReady) {
      return this.mcsRestart()
    } else {
      return this.nativeRestart()
    }
  }

  async set() {
    await this.reply(`开始重启，本次运行时长${Bot.getTimeDiff()}`)
    return redis.set(this.key, JSON.stringify({
      isExit: false,
      group_id: this.e.group_id,
      user_id: this.e.user_id,
      bot_id: this.e.self_id,
      msg_id: this.e.message_id,
      time: Date.now()
    }))
  }

  async mcsRestart() {
    const http = await import('http')
    const query = `uuid=${encodeURIComponent(this.instanceUuid)}&daemonId=${encodeURIComponent(this.daemonId)}&apikey=${encodeURIComponent(this.mcsApiKey)}`
    const options = {
      hostname: this.mcsHost,
      port: this.mcsPort,
      path: `/api/protected_instance/restart?${query}`,
      method: 'GET',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json; charset=utf-8'
      }
    }

    return new Promise((resolve) => {
      const req = http.request(options, (res) => {
        let data = ''
        res.on('data', (chunk) => data += chunk)
        res.on('end', async () => {
          try {
            const result = JSON.parse(data)
            if (result.status === 200) {
              resolve()
            } else {
              await this.reply(`MCS云崽实例重启失败（状态码 ${result.status}），回退到原生重启...`)
              await this.nativeRestart()
            }
          } catch (e) {
            await this.reply(`MCS云崽实例重启失败（响应解析异常），回退到原生重启...`)
            await this.nativeRestart()
          }
        })
      })

      req.on('error', async (err) => {
        await this.reply(`MCS云崽实例重启请求错误（${err.message}），回退到原生重启...`)
        await this.nativeRestart()
      })

      req.end()
    })
  }

  async nativeRestart() {
    const ret = await Bot.restart()
    await this.reply(`原生重启错误\n${Bot.String(ret)}`)
  }
}