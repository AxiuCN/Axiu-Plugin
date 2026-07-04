import fs from 'node:fs/promises'
import { fileURLToPath } from 'url'
import path from 'node:path'
import plugin from '../../../lib/plugins/plugin.js'
import cfg from '../../../lib/config/config.js'
import { getRestartConfig } from '../components/config.js'
import { RestartManager } from '../modules/mcsmManage/RestartManager.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.join(__dirname, '..')

let uping = false

export class McsmManage extends plugin {
  constructor() {
    super({
      name: '[Axiu-Plugin]MCSM云崽管理',
      dsc: 'MCSM云崽实例重启更新',
      event: 'message',
      priority: -Infinity,
      rule: [
        // 仅用于指令列表显示，实际拦截由 accept() 处理
        { reg: '^#重启$', fnc: 'restart', permission: 'master' },
        { reg: '^#更新日志', fnc: 'updateLog' },
        { reg: '^#(安?静)?(强制)?更新', fnc: 'update' },
        { reg: '^#全部(安?静)?(强制)?更新$', fnc: 'updateAll', permission: 'master' }
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

  init() {
    Bot.once('online', () => RestartManager.onBotOnline())
    this.e = {
      isMaster: true,
      logFnc: '[自动更新]',
      msg: '#全部静更新',
      reply: msg => Bot.sendMasterMsg(msg)
    }
    if (cfg?.bot?.update_time) this.autoUpdate()

    if (cfg?.bot?.update_cron)
      for (const i of Array.isArray(cfg.bot.update_cron)
        ? cfg.bot.update_cron
        : [cfg.bot.update_cron])
        this.task.push({
          name: '定时更新',
          cron: i,
          fnc: () => this.updateAll()
        })
  }

  // ==================== accept 拦截 ====================

  /**
   * accept() 在 loader 的 rule 匹配之前执行，优先级最高
   * 返回 'return' 阻止 rule 层继续分发到 other/ 同名插件
   */
  async accept(e) {
    // #重启（仅 master）
    if (/^#重启$/.test(e.msg)) {
      if (!e.isMaster) { e.reply('暂无权限，只有主人才能操作'); return 'return' }
      await this.restartMgr.doRestart(e)
      return 'return'
    }
    // #全部更新（仅 master）
    if (/^#全部(安?静)?(强制)?更新$/.test(e.msg)) {
      if (!e.isMaster) { e.reply('暂无权限，只有主人才能操作'); return 'return' }
      await this.updateAll(e)
      return 'return'
    }
    // #更新 / #强制更新 / #更新日志
    if (/^#(安?静)?(强制)?更新/.test(e.msg)) {
      if (e.msg.includes('日志')) {
        await this.updateLog(e)
      } else {
        if (!e.isMaster) return false
        await this.update(e)
      }
      return 'return'
    }
  }

  // ==================== 重启 ====================

  async restart(e) {
    await this.restartMgr.doRestart(e || this.e)
  }

  // ==================== 更新 ====================

  get quiet() {
    return /^#(全部)?(安?静)/.test(this.e.msg)
  }

  exec(cmd, plugin, opts = {}) {
    if (plugin) opts.cwd = `plugins/${plugin}`
    return Bot.exec(cmd, opts)
  }

  async update(e) {
    if (!this.e.isMaster) return false
    if (uping) {
      await this.e.reply('正在更新，请稍候再试')
      return false
    }

    const pluginName = await this.getPlugin()
    if (pluginName === false) return false

    uping = true
    await this.runUpdate(pluginName)

    if (this.isPkgUp) await this.updatePackage()
    if (this.isUp) await this.restart(e)
    uping = false
  }

  async getPlugin(plugin = this.e.msg.replace(/#(安?静)?(强制)?更新(日志)?/, '')) {
    if (!plugin) return ''
    for (const i of [plugin, `${plugin}-Plugin`, `${plugin}-plugin`])
      if (await Bot.fsStat(`plugins/${i}/.git`)) {
        this.typeName = i
        return i
      }
    return false
  }

  async runUpdate(plugin = '') {
    let cm = 'git pull'
    let type = '更新'
    if (!plugin) cm = `git checkout package.json && ${cm}`

    if (this.e.msg.includes('强制')) {
      type = '强制更新'
      cm = `git reset --hard ${await this.getRemoteBranch(true, plugin)} && git pull --rebase`
    }
    this.oldCommitId = await this.getCommitId(plugin)

    logger.mark(`${this.e.logFnc} 开始${type} ${this.typeName}`)
    if (!this.quiet) await this.reply(`开始${type} ${this.typeName}`)
    const ret = await this.exec(cm, plugin)

    if (ret.error && !(await this.gitErr(plugin, ret.stdout, ret.error.message))) {
      logger.mark(`${this.e.logFnc} 更新失败 ${this.typeName}`)
      return false
    }

    const time = await this.getTime(plugin)
    if (/Already up|已经是最新/.test(ret.stdout)) {
      if (!this.quiet) await this.reply(`${this.typeName} 已是最新\n最后更新时间：${time}`)
    } else {
      this.isUp = true
      if (/package\.json/.test(ret.stdout)) this.isPkgUp = true
      await this.reply(`${this.typeName} 更新成功\n更新时间：${time}`)
      await this.reply(await this.getLog(plugin))
    }

    logger.mark(`${this.e.logFnc} 最后更新时间：${time}`)
    return true
  }

  async getCommitId(...args) {
    return (await this.exec('git rev-parse --short HEAD', ...args)).stdout
  }

  async getTime(...args) {
    return (await this.exec('git log -1 --pretty=%cd --date=format:"%F %T"', ...args)).stdout
  }

  async getBranch(...args) {
    return (await this.exec('git branch --show-current', ...args)).stdout
  }

  async getRemote(branch, ...args) {
    return (await this.exec(`git config branch.${branch}.remote`, ...args)).stdout
  }

  async getRemoteBranch(string, ...args) {
    const branch = await this.getBranch(...args)
    if (!branch && string) return ''
    const remote = await this.getRemote(branch, ...args)
    if (!remote && string) return ''
    return string ? `${remote}/${branch}` : { remote, branch }
  }

  gitErrUrl(error) {
    return error.match(/'(.+?)'/g)[0].replace(/'(.+?)'/, '$1')
  }

  async gitErr(plugin, stdout, error) {
    if (/unable to access|无法访问/.test(error))
      await this.reply(`远程仓库连接错误：${this.gitErrUrl(error)}`)
    else if (
      /not found|未找到|does not (exist|appear)|不存在|Authentication failed|鉴权失败/.test(error)
    )
      await this.reply(`远程仓库地址错误：${this.gitErrUrl(error)}`)
    else if (
      /be overwritten by merge|被合并操作覆盖/.test(error) ||
      /Merge conflict|合并冲突/.test(stdout)
    )
      await this.reply(`${error}\n${stdout}\n若修改过文件请手动更新，否则发送 #强制更新${plugin}`)
    else if (/divergent branches|偏离的分支/.test(error)) {
      const ret = await this.exec('git pull --rebase', plugin)
      if (!ret.error && /Successfully rebased|成功变基/.test(ret.stdout + ret.stderr)) return true
      await this.reply(`${error}\n${stdout}\n若修改过文件请手动更新，否则发送 #强制更新${plugin}`)
    } else await this.reply(`${error}\n${stdout}\n未知错误，可尝试发送 #强制更新${plugin}`)
  }

  async updateAll(e) {
    if (uping) {
      await this.e.reply('正在更新，请稍候再试')
      return false
    }

    uping = true
    await this.runUpdate()
    const plugins = await fs.readdir('plugins')
    for (let p of plugins) {
      p = await this.getPlugin(p)
      if (p === false) continue
      await this.runUpdate(p)
    }

    if (this.isPkgUp) await this.updatePackage()
    if (this.isUp) await this.restart(e)
    uping = false
  }

  async updatePackage() {
    const cmd = 'pnpm install'
    if (process.platform === 'win32') return this.reply(`检测到依赖更新，请 #关机 后执行 ${cmd}`)
    await this.reply('开始更新依赖')
    return this.exec(cmd)
  }

  async getLog(plugin = '') {
    let cm = await this.exec('git log -100 --pretty="%h||[%cd] %s" --date=format:"%F %T"', plugin)
    if (cm.error) return this.reply(cm.error.message)

    const logAll = cm.stdout.split('\n')
    if (!logAll.length) return false

    let log = []
    for (let str of logAll) {
      str = str.split('||')
      if (str[0] === this.oldCommitId) break
      if (str[1].includes('Merge branch')) continue
      log.push(str[1])
    }
    if (log.length <= 0) return ''

    const msg = [`${plugin || 'TRSS-Yunzai'} 更新日志，共${log.length}条`, log.join('\n\n')]
    return Bot.makeForwardArray(msg)
  }

  async updateLog(e) {
    if (e) this.e = e
    const p = await this.getPlugin()
    if (p === false) return false
    return this.reply(await this.getLog(p))
  }

  // ==================== 自动更新 ====================

  autoUpdate() {
    setTimeout(
      () => this.updateAll().finally(() => this.autoUpdate()),
      cfg.bot.update_time * 60000
    )
  }
}
