/** stoken/cookie YAML 持久化 — 从 xiaoyao-cvs-plugin model/gsCfg.js 精简移植 */

import YAML from 'yaml'
import fs from 'node:fs'
import { promisify } from 'node:util'
import lodash from 'lodash'

const plugin = 'Axiu-Plugin'
const _path = process.cwd()

class StokenStore {
  /** 通用 YAML 读取 */
  getfileYaml (path, name) {
    this.cpCfg('config', 'config')
    return YAML.parse(
      fs.readFileSync(path + name + '.yaml', 'utf8')
    )
  }

  /** 首次启动复制默认配置 */
  cpCfg (app, name) {
    if (!fs.existsSync(`./plugins/${plugin}/config`)) {
      fs.mkdirSync(`./plugins/${plugin}/config`)
    }
    const set = `./plugins/${plugin}/config/${name}.yaml`
    if (!fs.existsSync(set)) {
      fs.copyFileSync(`./plugins/${plugin}/defSet/${app}/${name}.yaml`, set)
    }
  }

  /** 读取单个用户的 stoken */
  async getUserStoken (userId) {
    try {
      const ck = YAML.parse(
        fs.readFileSync(`plugins/${plugin}/data/stoken/${userId}.yaml`, 'utf8')
      )
      return ck || {}
    } catch (ex) {
      return {}
    }
  }

  /** 读取全部用户绑定的 stoken */
  async getBingStoken () {
    const ck = []
    const dir = `plugins/${plugin}/data/stoken/`
    if (!fs.existsSync(dir)) return ck
    const files = fs.readdirSync(dir).filter(file => file.endsWith('.yaml'))

    const readFile = promisify(fs.readFile)
    const promises = files.map((v) => readFile(`${dir}${v}`, 'utf8'))
    const res = await Promise.all(promises)
    res.forEach((v) => {
      const tmp = YAML.parse(v)
      ck.push(tmp)
    })
    return ck
  }

  /** 读取单个用户的 cookie（主账号） */
  getBingCookie (userId) {
    const file = `./data/MysCookie/${userId}.yaml`
    try {
      let ck = fs.readFileSync(file, 'utf-8')
      ck = YAML.parse(ck)
      for (const item in ck) {
        if (!ck[item].isMain) continue
        const login_ticket = ck[item]?.login_ticket
        ck = ck[item].ck
        return { ck, item, login_ticket }
      }
    } catch (error) {
      return {}
    }
  }

  /** 保存/合并 stoken 数据 */
  saveBingStoken (userId, data) {
    const file = `./plugins/${plugin}/data/stoken/${userId}.yaml`
    if (lodash.isEmpty(data)) {
      fs.existsSync(file) && fs.unlinkSync(file)
    } else {
      // 确保目录存在
      const dir = `./plugins/${plugin}/data/stoken/`
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

      fs.exists(file, (exists) => {
        if (!exists) {
          fs.writeFileSync(file, '', 'utf8')
        }
        let ck = fs.readFileSync(file, 'utf-8')
        const yaml = YAML.stringify(data)
        ck = YAML.parse(ck)
        if (ck?.uid || !ck) {
          fs.writeFileSync(file, yaml, 'utf8')
        } else {
          if (!ck[Object.keys(data)[0]]) {
            ck = YAML.stringify(ck)
            fs.writeFileSync(file, yaml + ck, 'utf8')
          } else {
            ck[Object.keys(data)[0]] = data[Object.keys(data)[0]]
            fs.writeFileSync(file, YAML.stringify(ck), 'utf8')
          }
        }
      })
    }
  }
}

export default new StokenStore()
