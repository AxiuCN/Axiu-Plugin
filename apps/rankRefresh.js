/** 排行榜定时刷新（miao 群排行 + Axiu 挑战排行）
 *
 *  默认**关闭**（`rankRefresh.enabled=false`，见 config/config.yaml.example）——开箱不跑重活。
 *  打开后按 `rankRefresh.schedule` 执行：
 *    1. 重排 Axiu 侧挑战排行（原神 + 星铁，各自带重置锁）
 *    2. 只刷「有 miao 排行数据的群」（键里的群号），逐群 × {gs, sr} 调 miao 的 refreshRank
 *    3. 结束时按 `rankRefresh.notifyMaster` 私聊 master 一条汇总
 *
 *  miao 缺失或 refreshRank 签名变化：只刷 Axiu 侧，汇总里写明。
 */
import { getPluginConfig } from '../components/config.js'
import { buildCopyrightText } from '../components/pluginVersion.js'
import { LOG_PREFIX } from '../components/constants.js'
import { listRankGroups, miaoAvailable, MESSAGES } from '../model/artisRank.js'

const REFRESH_LOG_PREFIX = `${LOG_PREFIX}[排行刷新] `
/** 默认刷新时间：每天 4:40（签到刷新 4:30 之后，避开同一时刻抢资源） */
const DEFAULT_SCHEDULE = '0 40 4 * * ? *'
/** 群与群之间的间隔：miao 侧要逐个 uid 拉面板，连着刷会把 bot 拖住 */
const GROUP_DELAY_MS = 300

/** Axiu 侧待重排的排行模型（rebuildAll 自带重置锁） */
const AXIU_RANK_MODULES = [
  { label: '原神挑战排行', path: '../model/gsChallengeRank.js' },
  { label: '星铁挑战排行', path: '../model/srChallengeRank.js' }
]

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

export class RankRefreshApp extends plugin {
  constructor () {
    super({
      name: '[Axiu-Plugin] 排行定时刷新',
      dsc: '定时重排 Axiu 挑战排行并刷新 miao 群排行',
      task: [
        {
          name: '排行榜定时刷新',
          fnc: () => this.refreshAll(),
          cron: getPluginConfig()?.rankRefresh?.schedule || DEFAULT_SCHEDULE
        }
      ]
    })
  }

  // ==================== 定时任务入口 ====================

  /**
   * 排行榜定时刷新
   * 未启用时任务仍注册，进入后立即返回（不做任何 Redis 访问）
   */
  async refreshAll () {
    const cfg = getPluginConfig()?.rankRefresh || {}
    if (!cfg.enabled) {
      logger?.info(`${REFRESH_LOG_PREFIX}未启用（rankRefresh.enabled=false），本次跳过`)
      return true
    }

    const startedAt = Date.now()
    logger?.info(`${REFRESH_LOG_PREFIX}开始`)

    const axiu = await this._refreshAxiuRank()
    const miao = await this._refreshMiaoRank()
    const minutes = ((Date.now() - startedAt) / 60000).toFixed(1)
    const summary = this._buildSummary({ axiu, miao, minutes })

    logger?.info(`${REFRESH_LOG_PREFIX}完成\n${summary}`)
    if (cfg.notifyMaster !== false) await this._notifyMaster(summary)
    return true
  }

  // ==================== Axiu 侧重排 ====================

  /** 重排 Axiu 侧两套挑战排行（单套失败不影响另一套） */
  async _refreshAxiuRank () {
    const result = { done: [], failed: [] }
    for (const item of AXIU_RANK_MODULES) {
      try {
        const { default: model } = await import(item.path)
        const ret = await model.rebuildAll()
        result.done.push(`${item.label} ${ret?.total ?? 0} 个 UID`)
      } catch (err) {
        result.failed.push(item.label)
        logger?.error(`${REFRESH_LOG_PREFIX}${item.label}重排失败`, err)
      }
    }
    return result
  }

  // ==================== miao 侧刷新 ====================

  /** 逐群 × {gs, sr} 调 miao 的 refreshRank（只刷有排行数据的群，单群失败不中断） */
  async _refreshMiaoRank () {
    const result = { available: false, reasons: [], groups: 0, done: 0, failed: [] }

    if (!(await miaoAvailable())) {
      result.reasons.push(MESSAGES.noMiao)
      logger?.warn(`${REFRESH_LOG_PREFIX}miao-plugin 不可用，本次只刷新 Axiu 侧排行`)
      return result
    }

    let refreshRank = null
    try {
      const mod = await import('../../miao-plugin/apps/profile/ProfileRank.js')
      refreshRank = mod?.refreshRank
      if (typeof refreshRank !== 'function') throw new Error('未导出 refreshRank')
    } catch (err) {
      result.reasons.push('miao-plugin 的 refreshRank 不可用')
      logger?.warn(`${REFRESH_LOG_PREFIX}加载 miao 的 refreshRank 失败，本次只刷新 Axiu 侧排行：${err?.message ?? err}`)
      return result
    }

    result.available = true
    const groups = await listRankGroups()
    result.groups = groups.length

    for (const gid of groups) {
      for (const isSr of [false, true]) {
        try {
          const event = this._buildRankEvent(gid, isSr)
          // miao 的 refreshRank 只在「非 master」分支访问 this.e.member，这里把 this 兜成 { e: event } 更稳
          await refreshRank.call({ e: event }, event)
          result.done++
        } catch (err) {
          result.failed.push(`${gid}/${isSr ? 'sr' : 'gs'}`)
          logger?.warn(`${REFRESH_LOG_PREFIX}群 ${gid} ${isSr ? '星铁' : '原神'}排行刷新失败：${err?.message ?? err}`)
        }
      }
      await sleep(GROUP_DELAY_MS)
    }
    return result
  }

  /**
   * 合成 miao refreshRank 需要的最小事件对象
   * @param {string} groupId
   * @param {boolean} isSr
   * @returns {object} { group_id, group, isSr, isMaster, reply, runtime }
   */
  _buildRankEvent (groupId, isSr) {
    let group = null
    try {
      group = Bot.pickGroup(String(groupId))
    } catch { /* 取不到群（不在该群等）：miao 侧成员表为空，等价空跑 */ }
    return {
      group_id: String(groupId),
      group,
      isSr,
      isMaster: true,
      reply: async () => {},
      runtime: {}
    }
  }

  // ==================== 汇总与通知 ====================

  /** 组装刷新汇总文本（口径参考 apps/mysSignin.js 的报告格式，文案独立） */
  _buildSummary ({ axiu, miao, minutes }) {
    const lines = ['--- 排行定时刷新汇总 ---', `耗时: ${minutes} 分钟`]

    const axiuDesc = [
      ...axiu.done.map(t => `成功（${t}）`),
      ...axiu.failed.map(t => `失败（${t}）`)
    ]
    lines.push(`Axiu 侧: ${axiuDesc.length ? axiuDesc.join('；') : '无'}`)

    if (!miao.available) {
      lines.push(`miao 侧: 未刷新（${miao.reasons.join('；') || '不可用'}）`)
    } else {
      lines.push(`miao 侧: 扫到 ${miao.groups} 个有数据的群，成功 ${miao.done} 次，失败 ${miao.failed.length} 次`)
      if (miao.failed.length) lines.push(`失败群: ${miao.failed.join('、')}`)
    }

    lines.push('', buildCopyrightText())
    return lines.join('\n')
  }

  /** 私聊 master 汇总（取主人口径与 apps/mysSignin.js 一致） */
  async _notifyMaster (text) {
    try {
      const masterQQ = (await import('../../../lib/config/config.js')).default?.masterQQ
      if (!masterQQ?.length) {
        logger?.warn(`${REFRESH_LOG_PREFIX}未取到 masterQQ，汇总未发送`)
        return
      }
      await Bot.pickFriend(masterQQ[0]).sendMsg(text)
    } catch (err) {
      logger?.warn(`${REFRESH_LOG_PREFIX}私聊 master 汇总失败：${err?.message ?? err}`)
    }
  }
}
