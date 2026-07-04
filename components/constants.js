/** 日志前缀 */
export const LOG_PREFIX = '[Axiu-Plugin]'

/** 重启上下文 Redis 键 */
export const REDIS_KEY_RESTART = 'Yz:restart'

/** MCSManager 用户数据路径（来自 mcsmanager-plugin） */
export const MCS_USERDATA_PATH = 'data/mctool/mcsuserdata.json'

/** 默认重启配置 */
export const DEFAULT_RESTART_CONFIG = {
  restart: {
    enableMcs: true,
    useMcsManagerPluginConfig: true,
    mcsHost: '127.0.0.1',
    mcsPort: 23333,
    mcsApiKey: '',
    mcsInstanceUuid: '',
    mcsDaemonId: '',
    restartCron: []
  }
}

/** 默认入群审核配置（Map 格式） */
export function getDefaultGroupConfig() {
  return new Map()
}
