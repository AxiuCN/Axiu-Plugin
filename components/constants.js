/** 日志前缀 */
export const LOG_PREFIX = '[Axiu-Plugin]'

/** 重启上下文 Redis 键 */
export const REDIS_KEY_RESTART = 'Yz:axiu:restart'

/** 默认重启配置 */
export const DEFAULT_RESTART_CONFIG = {
  restart: {
    enableMcsm: true,
    mcsmHost: '127.0.0.1',
    mcsmPort: 23333,
    mcsmApiKey: '',
    mcsmInstanceUuid: '',
    mcsmDaemonId: '',
    restartCron: []
  }
}

/** 默认入群审核配置（Map 格式） */
export function getDefaultGroupConfig() {
  return new Map()
}
