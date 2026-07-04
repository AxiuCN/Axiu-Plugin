import { fileURLToPath } from 'url'
import path from 'node:path'
import plugin from '../../../lib/plugins/plugin.js'
import { getGroupApproveConfig } from '../components/config.js'
import { handleRequest } from '../modules/groupApprove/ApproveManager.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.join(__dirname, '..')

export class autoGroupApprove extends plugin {
  constructor() {
    super({
      name: '[Axiu-Plugin] 自动入群审核',
      dsc: '根据黑白名单自动处理加群申请，否则@其他管理员',
      event: 'request.group.add',
      priority: 10
    })
    this.groupConfig = getGroupApproveConfig(pluginRoot)
  }

  async accept(e) {
    await handleRequest({ e, groupConfig: this.groupConfig })
  }
}
