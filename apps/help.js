/** 帮助 — 参考 LinkFlow-Plugin apps/help.js
 *
 *  #Axiu帮助 / #阿修帮助 → 渲染帮助图（按权限过滤 master 分组）
 */

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { render } from '../components/render.js'
import { pluginVersion, yunzaiVersion } from '../components/pluginVersion.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.join(__dirname, '..')

export class HelpApp extends plugin {
  constructor () {
    super({
      name: '[Axiu-Plugin] 帮助',
      dsc: '查看 Axiu-Plugin 帮助',
      event: 'message',
      priority: 500,
      rule: [
        { reg: /^#(axiu|Axiu|阿修)(帮助|菜单|指令|命令|help)$/i, fnc: 'help' },
      ],
    })
  }

  async help (e) {
    try {
      // 带时间戳动态 import，help-cfg.js 修改后即时生效
      const helpPath = path.join(pluginRoot, 'resources/help/help-cfg.js')
      const helpUrl = pathToFileURL(helpPath)
      helpUrl.searchParams.set('t', Date.now())
      const { helpCfg, helpList } = await import(helpUrl.href)

      // 过滤 master 分组
      const helpGroup = []
      for (const group of helpList) {
        if (group.auth === 'master' && !e.isMaster) continue
        helpGroup.push({
          group: group.group,
          list: group.list.map((item) => ({ title: item.title, desc: item.desc })),
        })
      }

      const data = {
        helpCfg: {
          title: helpCfg.title || 'Axiu-Plugin 帮助',
          subTitle: `${helpCfg.subTitle || '阿修插件'} v${pluginVersion}`,
        },
        helpGroup,
        version: pluginVersion,
        yunzaiVersion,
      }

      const img = await render('help', 'index', data, 'jpeg')
      if (!img) return e.reply('[Axiu-Plugin] 帮助图生成失败，请重试。')
      return e.reply(img)
    } catch (err) {
      logger.error('[Axiu-Plugin] 帮助图生成失败:', err)
      return e.reply('[Axiu-Plugin] 帮助图生成失败，请重试。')
    }
  }
}
