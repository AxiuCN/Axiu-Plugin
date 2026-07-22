/**
 * 原神终局挑战自动上报 — hook miao-plugin 的 MysApi.getData
 *
 * 对标 ark-plugin stygian-init.js：不注册查询命令（避免和 miao-plugin 抢 #深渊/#剧诗/#幽境），
 * 通过猴子补丁在 miao-plugin 查询成功后自动提取数据写入 Redis 排行。
 *
 * 仅 patch spiralAbyss / role_combat / hard_challenge 三个 Genshin 终局 API。
 */

import GsChallengeRank from '../../model/gsChallengeRank.js'
import { getPluginConfig } from '../../components/config.js'
import { LOG_PREFIX } from '../../components/constants.js'

/** API type → challengeType 映射 */
const TYPE_MAP = { spiralAbyss: 0, role_combat: 1, hard_challenge: 2 }

let _hooked = false

export async function ensureGsAutoReport () {
  if (_hooked) return
  _hooked = true

  try {
    const { MysApi } = await import('#miao.models')
    if (!MysApi?.prototype?.getData) {
      logger?.warn(`${LOG_PREFIX}[原神排行] 未找到 miao-plugin MysApi，跳过自动上报钩子`)
      _hooked = false
      return
    }

    const _originalGetData = MysApi.prototype.getData

    MysApi.prototype.getData = async function (type, data, cached) {
      const res = await _originalGetData.call(this, type, data, cached)

      // 仅处理三个 Genshin 终局 API
      if (!TYPE_MAP.hasOwnProperty(type) || !res || res.retcode !== 0) {
        return res
      }

      // 仅群聊 + 排行开启时上报
      try {
        const e = this.e || this._e
        if (!e?.isGroup) return res

        const cfg = getPluginConfig()
        if (cfg?.gsAbyssRank?.enabled === false) return res

        const challengeType = TYPE_MAP[type]
        const qq = e.at || e.user_id

        // role_combat / hard_challenge 返回数组 data[n]，取当前期
        let reportData = res.data
        if (Array.isArray(reportData)) {
          reportData = reportData[0] || {}
        }

        const scheduleId = GsChallengeRank.getScheduleId(reportData, challengeType)
        GsChallengeRank.report(
          this.uid, qq, e.group_id, challengeType, reportData, scheduleId
        ).catch(err => logger?.debug(`${LOG_PREFIX}[原神排行] 上报忽略:`, err?.message))
      } catch {}

      return res
    }

    logger?.mark(`${LOG_PREFIX}[原神排行] 已挂载 miao-plugin MysApi 自动上报钩子`)
  } catch {
    logger?.debug(`${LOG_PREFIX}[原神排行] miao-plugin 未加载，跳过自动上报钩子`)
    _hooked = false
  }
}
