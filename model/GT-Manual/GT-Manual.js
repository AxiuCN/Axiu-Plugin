import express from 'express'
import gsCfg from '../gsCfg.js'
import _ from 'lodash'

let tmp = {}
let isRegister = {}
let result = {}
const Path = 'https://img-hut.top/gt/'
export default class GT_Manual {
  constructor() {
    this.cfg = gsCfg.api
    this.app = express()
  }

  load () {
    // 【安全修复】原代码未指定监听地址，默认监听所有网络接口（0.0.0.0）
    // 公网环境下 GT-Manual 服务直接暴露，现改为仅监听本地回环地址
    // 需通过反向代理访问时，在配置中将 bindHost 设为 0.0.0.0
    // this.app.listen(this.cfg.Port)
    this.app.listen(this.cfg.Port, this.cfg.bindHost || '127.0.0.1')

    // 【安全修复】已禁用 express.static(process.cwd())
    // 原代码将 Yunzai 根目录作为静态文件服务根目录，导致 config/*.yaml、
    // 插件源码、node_modules 等全部可通过 HTTP 访问。
    // 不需要替换：GT-Manual HTML 页面引用的 CSS/JS 均来自外部 CDN
    // （https://img-hut.top/gt/），无需本地静态文件服务。
    // this.app.use(express.static(process.cwd()))
    this.app.use(express.urlencoded({ extended: false }))
    this.app.use(express.json())
    this.app.get('/GTest/:key', this.index)
    this.app.post('/GTest/register', this.register)
    this.app.get('/GTest/register/:key', this.get_register)
    this.app.post('/GTest/validate/:key', this.validate)
    this.app.get('/GTest/validate/:key', this.get_validate)
    this.app.use(this.invalid)
    this.app.use(this.error)
    logger.mark(`[loveMys]手动接口启动, ${this.cfg.Address}/GTest/register`)
  }

  index (req, res, next) {
    let { key } = req.params
    if (!key || !isRegister[key]) return next('验证信息不存在或已失效。')
    res.send(`<!DOCTYPE html>
<html>
  <head>
    <title>GTest</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
    <link rel="stylesheet" href="${Path}style.css">
  </head>
  <body>
    <h1></h1><br>
    <div id="captcha" key="${key}">
      <button id="btn"><span>点击验证</span></button>
      <div id="wait" class="show">
        <div class="progress"></div>
      </div>
    </div>
    <footer id="footer">
      <p class="copyright">Copyright GT-Manual</p>
    </footer>
    <script src="${Path}jquery.min.js"></script>
    <script src="${Path}gt.js"></script>
    <script src="${Path}script.js"></script>
  </body>
</html>`)
  }

  /** 验证信息, post传mys接口res.data */
  register (req, res, next) {
    let key; let { gt, challenge } = req.body || {}
    if (!gt || !challenge) return next('0')
    for (let i = 0; i < 10; i++) {
      key = _.sampleSize('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 6).join('')
      if (isRegister[key] || result[key]) continue
      break
    }
    tmp[key] = req.body
    isRegister[key] = 1
    /** 未点击2分钟后删除 */
    setTimeout(() => delete tmp[key] && delete isRegister[key], 120000)
    GT_Manual.send(res, {
      link: `${gsCfg.api.Address}/GTest/${key}`,
      result: `${gsCfg.api.Address}/GTest/validate/${key}`
    })
  }

  /** 浏览器获取gt参数 */
  get_register (req, res, next) {
    let { key } = req.params
    if (!key || !tmp[key]) return next('该验证信息已被使用，若非本人操作请重新获取')
    res.send(tmp[key] || {})
    delete tmp[key]
  }

  /** 浏览器返回validate */
  validate (req, res, next) {
    let { key } = req.params
    if (!key || !req.body) return next('0')
    result[key] = req.body
    setTimeout(() => delete result[key], 30000)
    GT_Manual.send(res, {})
    delete isRegister[key]
  }

  /** 获取验证结果validate */
  get_validate (req, res, next) {
    let { key } = req.params
    if (!key) return next('0')
    GT_Manual.send(res, result[key] || null)
  }

  static send (res, data, message = 'OK') {
    res.send({
      status: Number(!data),
      message,
      data
    })
  }

  invalid (req, res) {
    if (!res.finished) res.status(404).end()
  }

  error (err, req, res, next) {
    let message = err?.message || (err && err !== '0' && `${err}`) || 'Invalid request'
    if (!res.finished) res.send({ status: 1, message })
  }
}
