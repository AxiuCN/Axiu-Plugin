import { fileURLToPath } from 'url'
import path from 'node:path'
import chokidar from 'chokidar'
import plugin from '../../../lib/plugins/plugin.js'
import { getGroupApproveConfig } from '../components/groupConfig.js'
import { handleRequest } from '../modules/groupApprove/ApproveManager.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.join(__dirname, '..')
const GROUP_CONFIG_PATH = path.join(pluginRoot, 'config', 'group_config.yaml')

export class autoGroupApprove extends plugin {
  constructor() {
    super({
      name: '[Axiu-Plugin] 自动入群审核',
      dsc: '根据黑白名单自动处理加群申请，否则@其他管理员',
      event: 'request.group.add',
      priority: 10
    })
    this.groupConfig = getGroupApproveConfig(pluginRoot)
    // 监听群配置文件变更：锅巴保存后即时重载，无需重启
    this._watchGroupConfig()
  }

  /** 监听 group_config.yaml，变更时重载黑白名单（chokidar 5s 防抖由库自带） */
  _watchGroupConfig() {
    try {
      this._watcher = chokidar.watch(GROUP_CONFIG_PATH, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
      })
      this._watcher.on('change', () => {
        this.groupConfig = getGroupApproveConfig(pluginRoot)
        logger?.info('[Axiu-Plugin] 入群审核配置已重载')
      })
      this._watcher.on('unlink', () => {
        this.groupConfig = getGroupApproveConfig(pluginRoot)
        logger?.info('[Axiu-Plugin] 入群审核配置文件已删除，使用默认配置')
      })
    } catch (err) {
      logger?.warn('[Axiu-Plugin] 群配置监听启动失败:', err?.message)
    }
  }

  async accept(e) {
    await handleRequest({ e, groupConfig: this.groupConfig })
  }
}
