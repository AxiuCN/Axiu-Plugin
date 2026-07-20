import GT_Manual from './GT-Manual/GT-Manual.js'
import chokidar from 'chokidar'
import YAML from 'yaml'
import fs from 'node:fs'

/** 配置文件 */
class Cfg {
  constructor () {
    /** 默认设置 */
    this.defSetPath = './plugins/Axiu-Plugin/defSet'
    this.defSet = {}

    /** 用户设置 */
    this.configPath = './plugins/Axiu-Plugin/config'
    this.config = {}

    /** 监听文件 */
    this.watcher = { config: {}, defSet: {} }
  }

  get api(){ return this.getConfig('config')?.api || {} }

  /** 默认配置 */
  getdefSet (app) {
    return this.getYaml(app, 'defSet')
  }

  /** 用户配置 */
  getConfig (app) {
    if (app === 'config') {
      // config.yaml 为三层结构，defSet/config.yaml 是锅巴模板（含 ${变量}），不可合并
      let cfg = this.getYaml(app, 'config')
      if (!cfg) cfg = this.getYamlExample(app)
      return cfg || {}
    }
    return { ...this.getdefSet(app), ...this.getYaml(app, 'config') }
  }

  /** 设置配置 */
  setConfig (app, obj) {
    if (app === 'config') {
      // config.yaml 由锅巴通过模板替换写入，此处做简单兜底
      return this.setYaml(app, 'config', obj)
    }
    const defSet = this.getdefSet(app)
    const config = this.getConfig(app)
    return this.setYaml(app, 'config', { ...defSet, ...config, ...obj })
  }

  /** 读取 .example 回退配置 */
  getYamlExample (app) {
    const file = `${this.configPath}/${app}.yaml.example`
    try {
      return YAML.parse(fs.readFileSync(file, 'utf8'))
    } catch (error) {
      logger.error(`[${app}] 读取.example失败 ${error}`)
      return false
    }
  }

  /** 将对象写入YAML文件 */
  setYaml(app, type, Object) {
    let file = this.getFilePath(app, type);
    try {
      fs.writeFileSync(file, YAML.stringify(Object), 'utf8');
    } catch (error) {
      logger.error(`[${app}] 写入失败 ${error}`);
      return false;
    }
  }

  /**
   * 获取配置yaml
   * @param app 配置文件名称
   * @param type 默认配置-defSet，用户配置-config
   */
  getYaml (app, type) {
    let file = this.getFilePath(app, type)

    if (this[type][app]) return this[type][app]

    try {
      this[type][app] = YAML.parse(
        fs.readFileSync(file, 'utf8')
      )
    } catch (error) {
      logger.error(`[${app}] 格式错误 ${error}`)
      return false
    }

    this.watch(file, app, type)

    return this[type][app]
  }

  getFilePath (app, type) {
    if (type == 'defSet') return `${this.defSetPath}/${app}.yaml`
    else return `${this.configPath}/${app}.yaml`
  }

  /** 监听配置文件 */
  watch (file, app, type = 'defSet') {
    if (this.watcher[type][app]) return

    const watcher = chokidar.watch(file)
    watcher.on('change', path => {
      delete this[type][app]
      logger.mark(`[修改配置文件][${type}][${app}]`)
      if (this[`change_${app}`]) {
        this[`change_${app}`]()
      }
    })

    this.watcher[type][app] = watcher
  }

  copyPath () {
    if (!fs.existsSync(this.configPath)) fs.mkdirSync(this.configPath)

    // 从 .example 文件复制运行时配置（非 defSet，defSet 是锅巴模板含 ${变量}）
    try {
      const exampleFiles = fs.readdirSync(this.configPath).filter(f => f.endsWith('.yaml.example'))
      for (const exampleFile of exampleFiles) {
        const targetFile = exampleFile.replace('.example', '')
        if (!fs.existsSync(`${this.configPath}/${targetFile}`)) {
          fs.copyFileSync(`${this.configPath}/${exampleFile}`, `${this.configPath}/${targetFile}`)
        }
      }
    } catch {}

    // 兜底：defSet 中 .yaml 文件（如 group_config.yaml）
    let yamlfiles = fs.readdirSync(`${this.defSetPath}`).filter(file => file.endsWith('.yaml'))
    for (let item of yamlfiles) {
      if (!fs.existsSync(`${this.configPath}/${item}`)) {
        fs.copyFileSync(`${this.defSetPath}/${item}`, `${this.configPath}/${item}`)
      }
    }
  }

  startGT () {
    let apiCfg = this.api
    if (apiCfg.startApi && apiCfg.Port && apiCfg.Address) new GT_Manual().load()
  }
}

export default new Cfg()
