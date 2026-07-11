/** HTML 渲染工具 — 从 xiaoyao-cvs-plugin components/Common.js 适配
 *  复用 Yunzai 框架 lib/puppeteer/puppeteer.js 截图
 */

import { LOG_PREFIX } from './constants.js'

/** 插件资源根路径 */
const RESOURCE_PATH = process.cwd() + '/plugins/Axiu-Plugin/resources/'

/**
 * 渲染 HTML 模板为图片并回复
 * @param {string} path 模板路径（如 "qrCode/index"）
 * @param {object} params 模板参数
 * @param {object} cfg 配置 { e, render?, scale? }
 */
export async function renderImg (path, params, cfg = {}) {
  const paths = path.split('/')
  const { e, scale = 1 } = cfg

  // 获取框架 puppeteer 渲染函数
  let screenshotFn = cfg.render
  if (!screenshotFn) {
    try {
      const puppeteer = await import('../../../lib/puppeteer/puppeteer.js')
      screenshotFn = puppeteer.screenshot || puppeteer.default?.screenshot
    } catch (err) {
      logger.error(`${LOG_PREFIX} 无法加载 puppeteer: ${err.message}`)
      await e.reply('渲染模块加载失败，请联系管理员')
      return false
    }
  }

  if (!screenshotFn) {
    await e.reply('渲染服务不可用')
    return false
  }

  const layoutPath = RESOURCE_PATH + 'common/layout/'

  try {
    const base64 = await screenshotFn(paths[0], paths[1], {
      ...params,
      _layout_path: RESOURCE_PATH,
      _tpl_path: RESOURCE_PATH + 'common/tpl/',
      defaultLayout: layoutPath + 'default.html',
      elemLayout: layoutPath + 'elem.html',
      sys: {
        scale: scale,
        copyright: 'Created By Yunzai-Bot & Axiu-Plugin'
      }
    })

    if (base64) {
      const ret = await e.reply(base64)
      return cfg.retMsgId ? ret : true
    }
    return false
  } catch (err) {
    logger.error(`${LOG_PREFIX} 渲染失败: ${err.message}`)
    await e.reply('图片渲染失败，请稍后再试')
    return false
  }
}
