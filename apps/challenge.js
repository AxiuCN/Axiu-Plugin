/** 终局挑战查询 & 排行（星铁 + 原神）
 *
 *  星铁查询（移植自 StarRail-plugin）:
 *    *末日 / *虚构 / *忘却 / *仲裁 / *深渊 / *最新深渊
 *    修饰符: 上期/本期 | 简易 | 往期
 *
 *  星铁排行（modules/challenge/srRank.js）:
 *    *忘却排名 / *末日排名 分数 / *仲裁排行 …
 *
 *  原神查询+排行（modules/challenge/gsQuery.js + gsRank.js）:
 *    #深渊 / #剧诗 / #幽境 — 完整自实现，一次 API 调用完成采数+渲染+上报
 *    #深渊排名 / #剧诗排名 / #幽境排名 — Redis ZSET 排行展示
 *
 *  配置: config.yaml → srChallenge.* / gsAbyss.* / gsAbyssRank.*
 */

import { render } from '../components/render.js'
import { getPluginConfig } from '../components/config.js'
import SrChallengeRank from '../model/srChallengeRank.js'
import GsChallengeRank from '../model/gsChallengeRank.js'
import { queryChallenge, recentPeak, getCurrentChallengeType } from '../modules/challenge/srQuery.js'
import { handleSrRank, handleSrRankReset, handleSrRankRebuild } from '../modules/challenge/srRank.js'
import { handleGsRank, handleGsRankReset, handleGsRankRebuild } from '../modules/challenge/gsRank.js'
import { gsSpiralAbyssQuery, gsRoleCombatQuery, gsHardChallengeQuery } from '../modules/challenge/gsQuery.js'

export class ChallengeApp extends plugin {
  constructor () {
    super({
      name: '[Axiu-Plugin] 终局挑战',
      dsc: '星铁终局挑战查询 + 星铁/原神终局挑战排行',
      event: 'message',
      priority: 1,
      rule: [
        // ===== 星铁查询 =====
        {
          reg: '^(#?星铁|[*＊])?(上期|本期)?(简易)?(末日|末日幻影)$',
          fnc: 'challengeBoss'
        },
        {
          reg: '^(#?星铁|[*＊])?(上期|本期)?(简易)?(虚构|虚构叙事)$',
          fnc: 'challengeStory'
        },
        {
          reg: '^(#?星铁|[*＊])?(上期|本期)?(简易)?(忘却|忘却之庭|混沌|混沌回忆)$',
          fnc: 'challengeForgottenHall'
        },
        {
          reg: '^(#?星铁|[*＊])?(往期|上期|本期)?(简易)?(异乡|异相|异向|仲裁|异相仲裁)$',
          fnc: 'challengePeak'
        },
        {
          reg: '^(#?星铁|[*＊])?(上期|本期)?(简易)?(深渊)$',
          fnc: 'challenge'
        },
        {
          reg: '^(#?星铁|[*＊])?(最新|当期)(简易)?(深渊)$',
          fnc: 'challengeCurrent'
        },

        // ===== 星铁排行 =====
        {
          reg: '^(#?星铁|[*＊])?(末日幻影|末日|虚构叙事|虚构|叙事|忘却之庭|忘却|混沌回忆|混沌|异相仲裁|异相|仲裁|异乡)(排名|排行)',
          fnc: 'challengeRank'
        },
        {
          reg: '^(#?星铁|[*＊])?重置(末日幻影|末日|虚构叙事|虚构|叙事|忘却之庭|忘却|混沌回忆|混沌|异相仲裁|异相|仲裁|异乡)(排名|排行)',
          fnc: 'challengeRankReset',
          permission: 'master'
        },
        {
          reg: '^(#?星铁|[*＊])?(开启|关闭)(挑战)(排名|排行)',
          fnc: 'challengeRankManage',
          permission: 'master'
        },
        {
          reg: '^(#?星铁|[*＊])?刷新(末日幻影|末日|虚构叙事|虚构|叙事|忘却之庭|忘却|混沌回忆|混沌|异相仲裁|异相|仲裁|异乡)?(排名|排行)',
          fnc: 'challengeRankRebuild',
          permission: 'master',
          log: true
        },

        // ===== 原神查询（完整自实现 → 阻断 miao-plugin） =====
        {
          reg: '^#(原神)?(上期|本期)?(深境|深渊|深境螺旋)$',
          fnc: 'gsSpiralAbyssQuery'
        },
        {
          reg: '^#(原神)?(上期|本期)?(幻想|剧诗|幻想真境剧诗)$',
          fnc: 'gsRoleCombatQuery'
        },
        {
          reg: '^#(原神)?(上期|本期)?(幽境|危战|幽境危战)(单人|单挑|组队|多人|合作|最佳|数据)?$',
          fnc: 'gsHardChallengeQuery'
        },

        // ===== 原神排行 =====
        {
          reg: '^#(原神)?(深境螺旋|深境|深渊|幻想真境剧诗|幻想|剧诗|幽境危战|幽境|危战)(单人|单挑|多人|组队|合作)?(排名|排行)',
          fnc: 'gsAbyssRank'
        },
        {
          reg: '^#(原神)?重置(深境螺旋|深境|深渊|幻想真境剧诗|幻想|剧诗|幽境危战|幽境|危战)(单人|单挑|多人|组队|合作)?(排名|排行)',
          fnc: 'gsAbyssRankReset',
          permission: 'master'
        },
        {
          reg: '^#(原神)?(开启|关闭)(深渊)(排名|排行)',
          fnc: 'gsAbyssRankManage',
          permission: 'master'
        },
        {
          reg: '^#(原神)?刷新(深境螺旋|深境|深渊|幻想真境剧诗|幻想|剧诗|幽境危战|幽境|危战)(单人|单挑|多人|组队|合作)?(排名|排行)',
          fnc: 'gsAbyssRankRebuild',
          permission: 'master',
          log: true
        }
      ]
    })
  }

  // ==================== 配置检查 ====================

  _isEnabled () {
    return getPluginConfig()?.srChallenge?.enabled !== false
  }

  _isRankEnabled () {
    return getPluginConfig()?.srChallengeRank?.enabled !== false
  }

  _isGsRankEnabled () {
    return getPluginConfig()?.gsAbyssRank?.enabled !== false
  }

  // ==================== 排行上报（星铁） ====================

  _reportRanking (data, uid, challengeType, scheduleType, isDetailedSuccess) {
    if (!this.e.isGroup || !isDetailedSuccess || !this._isRankEnabled()) return
    // 群开关关闭时该群不再参与上报（否则关闭群查询仍计入全局榜，__S__Rank 语义为"参与开关"）
    SrChallengeRank.getGroupCfg(this.e.group_id).then(cfg => {
      if (cfg?.status === 0) return
      const scheduleId = SrChallengeRank.getScheduleId(data, challengeType, scheduleType)
      const qq = this.e.at || this.e.user_id
      // scheduleType '1'=当期，'2'=上期，'3'=往期（仅当期更新 current 指针）
      SrChallengeRank.report(uid, qq, this.e.group_id, challengeType, data, scheduleId, scheduleType === '1').catch(
        err => logger?.error('[Axiu-Plugin][排行] 上报失败', err)
      )
    }).catch(() => {})
  }

  // ==================== 星铁查询 ====================

  async _getUserAuth (e) {
    e.isSr = true
    let uid = e.uid
    if (!uid || !/(18|[1-9])[0-9]{8}/.test(uid)) {
      const msgMatch = e.msg.match(/\d{9,10}/)
      if (msgMatch) {
        uid = msgMatch[0]
      } else {
        const prevNoTips = e.noTips
        e.noTips = true
        try {
          const MysInfo = (await import('../../genshin/model/mys/mysInfo.js')).default
          uid = await MysInfo.getUid(e, true)
        } catch {}
        e.noTips = prevNoTips
      }
    }
    if (!uid) {
      await e.reply('未绑定星铁UID，请发送 #扫码登录 绑定账号后重试')
      return null
    }
    try {
      const MysInfo = (await import('../../genshin/model/mys/mysInfo.js')).default
      const result = await MysInfo.checkUidBing(uid, 'sr')
      const ck = result?.ck
      if (ck) return { uid, ck }
    } catch {}
    await e.reply('尚未绑定Cookie，请发送 #扫码登录 绑定账号后重试')
    return null
  }

  async challengeForgottenHall (e) {
    if (!this._isEnabled()) return false
    const auth = await this._getUserAuth(e)
    if (!auth) return true
    await e.reply('正在获取忘却之庭数据，请稍后……')
    const res = await queryChallenge(this, 2, auth)
    if (!res) return true
    const img = await render('challenge/SR', 'index', res)
    if (img) await e.reply(img)
    return true
  }

  async challengeStory (e) {
    if (!this._isEnabled()) return false
    const auth = await this._getUserAuth(e)
    if (!auth) return true
    await e.reply('正在获取虚构叙事数据，请稍后……')
    const res = await queryChallenge(this, 1, auth)
    if (!res) return true
    const img = await render('challenge/SR', 'index', res)
    if (img) await e.reply(img)
    return true
  }

  async challengeBoss (e) {
    if (!this._isEnabled()) return false
    const auth = await this._getUserAuth(e)
    if (!auth) return true
    await e.reply('正在获取末日幻影数据，请稍后……')
    const res = await queryChallenge(this, 0, auth)
    if (!res) return true
    const img = await render('challenge/SR', 'index', res)
    if (img) await e.reply(img)
    return true
  }

  async challengePeak (e) {
    if (!this._isEnabled()) return false
    const auth = await this._getUserAuth(e)
    if (!auth) return true
    await e.reply('正在获取异相仲裁数据，请稍后……')
    let tplFile = 'index_peak'
    const res = await queryChallenge(this, 3, auth)
    if (!res) return true
    if (e.msg.match('往期')) {
      tplFile = 'peak_recent'
      const records = res.data.challenge_peak_records
      res.present = recentPeak(records[0])
      res.last = recentPeak(records[1])
      res.early = recentPeak(records[2])
    }
    const img = await render('challenge/SR', tplFile, res)
    if (img) await e.reply(img)
    return true
  }

  async challenge (e) {
    if (!this._isEnabled()) return false
    const auth = await this._getUserAuth(e)
    if (!auth) return true
    await e.reply('正在获取全部深渊数据，请稍后……')
    const results = await Promise.all([
      queryChallenge(this, 2, auth),
      queryChallenge(this, 1, auth),
      queryChallenge(this, 0, auth)
    ])
    if (!results[0] || !results[1] || !results[2]) return true
    const img = await render('challenge/SR', 'index_all', {
      hall: results[0], story: results[1], boss: results[2]
    })
    if (img) await e.reply(img)
    return true
  }

  async challengeCurrent (e) {
    if (!this._isEnabled()) return false
    const auth = await this._getUserAuth(e)
    if (!auth) return true
    await e.reply('正在获取最新深渊数据，请稍后……')
    const res = await queryChallenge(this, getCurrentChallengeType(), auth)
    if (!res) return true
    const img = await render('challenge/SR', 'index', res)
    if (img) await e.reply(img)
    return true
  }

  // ==================== 星铁排行 ====================

  async challengeRank (e) {
    return handleSrRank(this, e)
  }

  async challengeRankReset (e) {
    return handleSrRankReset(this, e)
  }

  async challengeRankRebuild (e) {
    return handleSrRankRebuild(this, e)
  }

  async challengeRankManage (e) {
    const enable = e.msg.includes('开启')
    const status = enable ? 1 : 0
    await SrChallengeRank.setGroupStatus(e.group_id, status)
    await e.reply(`已${enable ? '开启' : '关闭'}本群挑战排行功能`)
    return true
  }

  // ==================== 原神排行 ====================

  async gsAbyssRank (e) {
    return handleGsRank.call(this, e)
  }

  async gsAbyssRankReset (e) {
    return handleGsRankReset.call(this, e)
  }

  async gsAbyssRankRebuild (e) {
    return handleGsRankRebuild(e)
  }

  async gsAbyssRankManage (e) {
    const enable = e.msg.includes('开启')
    const status = enable ? 1 : 0
    await GsChallengeRank.setGroupStatus(e.group_id, status)
    await e.reply(`已${enable ? '开启' : '关闭'}本群深渊排行功能`)
    return true
  }

  // ==================== 原神查询（完整自实现 → 阻断 miao-plugin） ====================

  async gsSpiralAbyssQuery (e) { return gsSpiralAbyssQuery(e) }
  async gsRoleCombatQuery (e) { return gsRoleCombatQuery(e) }
  async gsHardChallengeQuery (e) { return gsHardChallengeQuery(e) }
}
