/** HTML 渲染工具 — 参照 ProfileImg-Plugin components/render.js
 *  复用 Yunzai 框架 lib/puppeteer/puppeteer.js 截图
 */

import path from 'node:path'
import fs from 'node:fs'
import puppeteer from '../../../lib/puppeteer/puppeteer.js'

const pluginRoot = path.join(process.cwd(), 'plugins/Axiu-Plugin')

/**
 * 渲染 HTML 模板为图片并返回 segment.image
 * @param {string} app - 模板子目录（如 "qrCode"）
 * @param {string} tpl - 模板文件名（如 "index"）
 * @param {object} data - 模板参数（含 url 等变量）
 * @param {string} imgType - 图片格式 "jpeg" | "png"
 * @returns {object|false} segment.image 或 false
 */
export async function render (app, tpl, data = {}, imgType = 'jpeg') {
  data._plugin = 'Axiu-Plugin'
  data._res_path = `../../../../../plugins/Axiu-Plugin/resources/`

  if (imgType === 'png') {
    data.omitBackground = true
  }
  data.imgType = imgType

  // 创建缓存目录
  const dataDir = path.join(process.cwd(), 'data', 'html', 'Axiu-Plugin', app, tpl)
  fs.mkdirSync(dataDir, { recursive: true })

  data.saveId = data.saveId || data.save_id || tpl
  data.tplFile = `./plugins/Axiu-Plugin/resources/${app}/${tpl}.html`
  data.pluResPath = data._res_path
  data.pageGotoParams = { waitUntil: 'networkidle0' }

  // 注入布局文件路径
  data.elemLayout = path.join(pluginRoot, 'resources', 'common', 'layout', 'elem.html')
  data.defaultLayout = path.join(pluginRoot, 'resources', 'common', 'layout', 'default.html')

  // 注入系统版权信息
  data.sys = {
    copyright: 'Created By Yunzai-Bot & Axiu-Plugin'
  }

  return await puppeteer.screenshot(`Axiu-Plugin/${app}/${tpl}`, data)
}
