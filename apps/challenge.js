/** 星铁终局挑战查询 — 移植自 StarRail-plugin apps/challenge.js
 *  接入 Axiu-Plugin 过码链路（MysSrApi.checkCode → mys.req.err handler）
 *
 *  命令:
 *    *末日 / *末日幻影 — 末日幻影 (challengeType=0)
 *    *虚构 / *虚构叙事 — 虚构叙事 (challengeType=1)
 *    *忘却 / *混沌回忆 — 忘却之庭 (challengeType=2)
 *    *仲裁 / *异相仲裁 — 异相仲裁 (challengeType=3)
 *    *深渊             — 三种合一 (0+1+2)
 *    *最新深渊 / *当期深渊 — 当前最新一期
 *
 *  修饰符: 上期/本期 | 简易（跳过详细API）| 往期（仲裁三期历史）
 *
 *  配置: config.yaml → srChallenge.enabled: true/false
 */

import MysSrApi from '../model/mys/mysSrApi.js'
import { render } from '../components/render.js'
import { LOG_PREFIX } from '../components/constants.js'
import { getPluginConfig } from '../components/config.js'
import ChallengeRank from '../model/challengeRank.js'

/** 挑战类型 → 中文名映射 */
const TYPE_NAMES = ['末日幻影', '虚构叙事', '忘却之庭', '异相仲裁']

/** 挑战类型 → 请求API key 映射 */
const CHALLENGE_API_KEYS = [
  'srChallengeBoss',        // 0: 末日幻影
  'srChallengeStory',       // 1: 虚构叙事
  'srChallenge',            // 2: 忘却之庭
  'srChallengePeak'         // 3: 异相仲裁
]

const CHALLENGE_API_SIMPLE_KEYS = [
  'srChallengeBossSimple',  // 0
  'srChallengeStorySimple', // 1
  'srChallengeSimple',      // 2
  'srChallengePeakSimple'   // 3
]

export class ChallengeApp extends plugin {
  constructor () {
    super({
      name: '终局挑战',
      dsc: '星铁末日幻影、虚构叙事、忘却之庭、异相仲裁查询',
      event: 'message',
      priority: 500,
      rule: [
        // 末日幻影
        {
          reg: '^(#?星铁|[*＊])?(上期|本期)?(简易)?(末日|末日幻影)$',
          fnc: 'challengeBoss'
        },
        // 虚构叙事
        {
          reg: '^(#?星铁|[*＊])?(上期|本期)?(简易)?(虚构|虚构叙事)$',
          fnc: 'challengeStory'
        },
        // 忘却之庭 / 混沌回忆
        {
          reg: '^(#?星铁|[*＊])?(上期|本期)?(简易)?(忘却|忘却之庭|混沌|混沌回忆)$',
          fnc: 'challengeForgottenHall'
        },
        // 异相仲裁
        {
          reg: '^(#?星铁|[*＊])?(往期|上期|本期)?(简易)?(异乡|异相|异向|仲裁|异相仲裁)$',
          fnc: 'challengePeak'
        },
        // 全部深渊（三种合一）
        {
          reg: '^(#?星铁|[*＊])?(上期|本期)?(简易)?(深渊)$',
          fnc: 'challenge'
        },
        // 最新深渊
        {
          reg: '^(#?星铁|[*＊])?(最新|当期)(简易)?(深渊)$',
          fnc: 'challengeCurrent'
        },
        // 排行查看：*忘却排名, *末日排名 分数, *仲裁排行
        {
          reg: '^(#?星铁|[*＊])?(末日|虚构|忘却|混沌|仲裁|异相)(排名|排行)',
          fnc: 'challengeRank'
        },
        // 重置排行：*重置忘却排名（仅 master）
        {
          reg: '^(#?星铁|[*＊])?重置(末日|虚构|忘却|混沌|仲裁|异相)(排名|排行)',
          fnc: 'challengeRankReset',
          permission: 'master'
        },
        // 开关排行：*开启/关闭挑战排名（仅 master）
        {
          reg: '^(#?星铁|[*＊])?(开启|关闭)(挑战)(排名|排行)',
          fnc: 'challengeRankManage',
          permission: 'master'
        }
      ]
    })
  }

  /** 检查功能是否开启 */
  _isEnabled () {
    const cfg = getPluginConfig()
    return cfg?.srChallenge?.enabled !== false
  }

  /** 检查排行功能是否开启 */
  _isRankEnabled () {
    const cfg = getPluginConfig()
    return cfg?.srChallengeRank?.enabled !== false
  }

  /**
   * 上报排行数据（仅在群聊 + 详细 API 成功时）
   * @param {object} data - 格式化后的 data
   * @param {string} uid
   * @param {number} challengeType
   * @param {string} scheduleType
   * @param {boolean} isDetailedSuccess - 详细 API 是否返回 0
   */
  _reportRanking (data, uid, challengeType, scheduleType, isDetailedSuccess) {
    if (!this.e.isGroup || !isDetailedSuccess) return
    if (!this._isRankEnabled()) return
    const scheduleId = ChallengeRank.getScheduleId(data, challengeType, scheduleType)
    const qq = this.e.user_id
    ChallengeRank.report(uid, qq, this.e.group_id, challengeType, data, scheduleId).catch(
      err => logger?.error(`${LOG_PREFIX}[排行] 上报失败`, err)
    )
  }

  /** 获取用户认证（uid + ck），失败时已发送错误消息，调用方直接 return true */
  async _getUserAuth (e) {
    // 确保 MysInfo.getUid 查询 sr 而非 gs
    e.isSr = true

    // 获取 UID
    let uid = e.uid
    if (!uid || !/(18|[1-9])[0-9]{8}/.test(uid)) {
      const msgMatch = e.msg.match(/\d{9,10}/)
      if (msgMatch) {
        uid = msgMatch[0]
      } else {
        // 设置 noTips 阻止 genshin MysInfo.getUid 发"请先#绑定uid"
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

    // 获取 Cookie
    try {
      const MysInfo = (await import('../../genshin/model/mys/mysInfo.js')).default
      const result = await MysInfo.checkUidBing(uid, 'sr')
      const ck = result?.ck
      if (ck) return { uid, ck }
    } catch {}

    await e.reply('尚未绑定Cookie，请发送 #扫码登录 绑定账号后重试')
    return null
  }

  // ==================== 核心查询 ====================

  /**
   * 查询挑战数据
   * @param {object} e - 消息 event
   * @param {number} challengeType - 0=末日, 1=虚构, 2=忘却, 3=仲裁
   * @param {object} auth - { uid, ck }，批量查询时外部传入
   */
  async queryChallenge (e, challengeType, auth) {
    this.e.isSr = true
    this.isSr = true
    const simple = this.e.msg.match('简易')
    const last = this.e.msg.match('上期')
    const recent = this.e.msg.match('往期')

    const uid = auth.uid
    const ck = auth.ck

    // schedule_type: 1=本期, 2=上期, 3=第三期（仲裁专用）
    let scheduleType = '1'
    if (last) scheduleType = '2'
    if ((recent || last) && challengeType === 3) scheduleType = '3'

    const api = new MysSrApi(uid, ck)

    // 获取设备指纹
    let deviceFp = await api.getData('getFp')
    if (!deviceFp?.data?.device_fp) return null
    deviceFp = deviceFp?.data?.device_fp

    let challengeData, res, simpleRes

    // 先查详细 API（非简易模式）
    if (!simple) {
      const requestType = CHALLENGE_API_KEYS[challengeType]
      res = await api.getData(requestType, { deviceFp, schedule_type: scheduleType })
      res = await api.checkCode(this.e, res, requestType, { deviceFp, schedule_type: scheduleType })
    }

    // 简易模式 / 详细出验证码 → 降级查简易
    if (simple || res?.retcode !== 0) {
      const simpleRequestType = CHALLENGE_API_SIMPLE_KEYS[challengeType]
      simpleRes = await api.getData(simpleRequestType, { deviceFp, schedule_type: scheduleType })
      simpleRes = await api.checkCode(this.e, simpleRes, simpleRequestType, { deviceFp, schedule_type: scheduleType })
      if (simpleRes?.retcode !== 0) return null
    }

    if (!simple && res?.retcode === 0) {
      challengeData = res
    } else if (simple && simpleRes?.retcode === 0) {
      challengeData = simpleRes
    } else {
      challengeData = simpleRes
      logger.warn(`${LOG_PREFIX} 星铁${TYPE_NAMES[challengeType]}详细信息出现验证码，仅显示最后一层`)
    }

    const data = { ...challengeData.data }

    // 根据 scheduleType 选择对应 group（末日/虚构的 groups 含本期+上期）
    if (data.groups && data.groups.length > 1) {
      const activeGroup = scheduleType === '1'
        ? data.groups.find(g => g.status === 'New')
        : data.groups.find(g => g.status === 'End')
      if (activeGroup) data.groups = [activeGroup]
    }

    // 往期仲裁 → 返回原始数据由 challengePeak 处理
    if (recent && challengeType === 3) {
      return { data, uid, challengeType, type: scheduleType }
    }

    // 最新模式标记
    data.currentType = this._getCurrentChallengeType()

    // 时间格式化
    if ([0, 1].includes(challengeType)) {
      // 末日幻影、虚构叙事：时间在 groups[0]
      data.beginTime = this._timeFormat(data.groups[0].begin_time)
      data.endTime = this._timeFormat(data.groups[0].end_time)
    } else if (challengeType === 2) {
      // 忘却之庭：时间在顶层
      data.beginTime = this._timeFormat(data.begin_time)
      data.endTime = this._timeFormat(data.end_time)
    } else {
      // 异相仲裁
      data.peak_records = last
        ? data.challenge_peak_records[1]
        : data.challenge_peak_records[0]
      data.beginTime = this._timeFormat(data.peak_records.group.begin_time)
      data.endTime = this._timeFormat(data.peak_records.group.end_time)
    }

    // 楼层数据格式化
    if (challengeType !== 3) {
      data.all_floor_detail = data.all_floor_detail.map(floor => ({
        ...floor,
        node_1: {
          ...floor.node_1,
          ...(floor.node_1.challenge_time && {
            challengeTime: this._timeFormat(floor.node_1.challenge_time, true)
          })
        },
        ...(floor.node_2 && {
          node_2: {
            ...floor.node_2,
            ...(floor.node_2.challenge_time && {
              challengeTime: this._timeFormat(floor.node_2.challenge_time, true)
            })
          }
        }),
        ...(floor.node_3 && {
          node_3: {
            ...floor.node_3,
            ...(floor.node_3.challenge_time && {
              challengeTime: this._timeFormat(floor.node_3.challenge_time, true)
            })
          }
        })
      }))
    } else {
      // 异相仲裁 — 王棋
      if (data.peak_records.boss_record) {
        data.peak_records.boss_record.challengeTime =
          this._timeFormat(data.peak_records.boss_record.challenge_time, true)
      }
      // 异相仲裁 — 骑士
      data.peak_records.mob_records = data.peak_records.mob_records.map(record => ({
        ...record,
        ...(record.challenge_time && {
          challengeTime: this._timeFormat(record.challenge_time, true)
        })
      }))
    }

    // 末日幻影、虚构叙事：计算两边节点总分
    if ([0, 1].includes(challengeType)) {
      data.all_floor_detail = data.all_floor_detail.map(floor => {
        if (floor.node_1.score != null) {
          let totalScore = parseInt(floor.node_1.score)
          if (floor.node_2 && floor.node_2.score != null) totalScore += parseInt(floor.node_2.score)
          if (floor.node_3 && floor.is_tierce) totalScore += parseInt(floor.node_3.score)
          return { ...floor, score: totalScore.toString() }
        }
        return floor
      })
    }

    this._reportRanking(data, uid, challengeType, scheduleType, !simple && res?.retcode === 0)

    return { data, uid, challengeType, type: scheduleType }
  }

  // ==================== 仲裁往期格式化 ====================

  _recentPeak (record) {
    const data = { ...record }
    data.beginTime = this._timeFormat(data.group.begin_time)
    data.endTime = this._timeFormat(data.group.end_time)

    if (data.boss_record) {
      data.boss_record.challengeTime = this._timeFormat(data.boss_record.challenge_time, true)
    }

    data.mob_records = data.mob_records.map(r => ({
      ...r,
      ...(r.challenge_time && { challengeTime: this._timeFormat(r.challenge_time, true) })
    }))

    return data
  }

  // ==================== 各模式命令 ====================

  async challengeForgottenHall (e) {
    if (!this._isEnabled()) return false
    const auth = await this._getUserAuth(e)
    if (!auth) return true

    await e.reply('正在获取忘却之庭数据，请稍后……')
    const res = await this.queryChallenge(e, 2, auth)
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
    const res = await this.queryChallenge(e, 1, auth)
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
    const res = await this.queryChallenge(e, 0, auth)
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
    const res = await this.queryChallenge(e, 3, auth)
    if (!res) return true

    if (e.msg.match('往期')) {
      tplFile = 'peak_recent'
      const records = res.data.challenge_peak_records
      res.present = this._recentPeak(records[0])
      res.last = this._recentPeak(records[1])
      res.early = this._recentPeak(records[2])
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
      this.queryChallenge(e, 2, auth), // 忘却
      this.queryChallenge(e, 1, auth), // 虚构
      this.queryChallenge(e, 0, auth)  // 末日
    ])

    if (!results[0] || !results[1] || !results[2]) return true

    const img = await render('challenge/SR', 'index_all', {
      hall: results[0],
      story: results[1],
      boss: results[2]
    })
    if (img) await e.reply(img)
    return true
  }

  async challengeCurrent (e) {
    if (!this._isEnabled()) return false
    const auth = await this._getUserAuth(e)
    if (!auth) return true

    await e.reply('正在获取最新深渊数据，请稍后……')
    const res = await this.queryChallenge(e, this._getCurrentChallengeType(), auth)
    if (!res) return true
    const img = await render('challenge/SR', 'index', res)
    if (img) await e.reply(img)
    return true
  }

  // ==================== 排行命令 ====================

  /** 挑战类型别名 → challengeType */
  _resolveChallengeAlias (text) {
    if (/末日/.test(text)) return 0
    if (/虚构|叙事/.test(text)) return 1
    if (/忘却|混沌/.test(text)) return 2
    if (/仲裁|异相|异乡/.test(text)) return 3
    return -1
  }

  /**
   * *忘却排名 [维度] — 查看本群排行
   * 支持指定维度：*忘却排名 分数、*末日排名 轮数
   */
  async challengeRank (e) {
    if (!e.isGroup) {
      await e.reply('排行功能仅限群聊使用')
      return true
    }
    if (!this._isRankEnabled()) {
      await e.reply('挑战排行功能已关闭，请联系管理员开启')
      return true
    }

    const challengeType = this._resolveChallengeAlias(e.msg)
    if (challengeType < 0) return true

    // 解析维度（消息中剔除挑战类型关键词后剩余部分）
    const typeNames = ['末日', '末日幻影', '虚构', '虚构叙事', '叙事', '忘却', '忘却之庭', '混沌', '混沌回忆', '仲裁', '异相仲裁', '异相', '异乡']
    let rest = e.msg
    for (const name of typeNames) {
      rest = rest.replace(name, '')
    }
    rest = rest.replace(/^(#?星铁|[*＊])/, '').replace(/^(排名|排行)/, '').trim()
    const dimension = ChallengeRank.resolveDimensionAlias(rest) || ChallengeRank.getDefaultDimension(challengeType)

    // 获取群配置
    const groupCfg = await ChallengeRank.getGroupCfg(e.group_id)
    if (groupCfg.status === 0) {
      await e.reply('本群挑战排行已关闭')
      return true
    }

    // 获取排行人数上限
    const cfg = getPluginConfig()
    const topN = cfg?.srChallengeRank?.rankNumber || 20

    const typeName = ChallengeRank.getTypeName(challengeType)
    // 获取当前赛季 scheduleId（与上报时一致）
    const scheduleId = await ChallengeRank.getCurrentScheduleId(challengeType, e.group_id)
    if (!scheduleId) {
      await e.reply(`本群暂无${typeName}排行数据，请先发送挑战查询命令（如 *${['末日', '虚构', '忘却', '仲裁'][challengeType]}）上报数据`)
      return true
    }
    const dims = ChallengeRank.getDimensions(challengeType)
    const dimDef = dims.find(d => d.key === dimension)
    const dimLabel = dimDef?.label || dimension

    // 查询排行
    const list = await ChallengeRank.getRank(e.group_id, challengeType, dimension, scheduleId, topN)
    if (!list.length) {
      await e.reply(`本群暂无${typeName}排行数据，请先发送挑战查询命令（如 *${['末日', '虚构', '忘却', '仲裁'][challengeType]}）上报数据`)
      return true
    }

    // 获取查询者自己的排名
    const selfRank = e.uid
      ? await ChallengeRank.getRankForUid(e.uid, e.group_id, challengeType, dimension, scheduleId)
      : null
    const totalCount = await ChallengeRank.getRankCount(e.group_id, challengeType, dimension, scheduleId)

    // 获取 QQ 身份信息（头像、昵称）— 参考 miao-plugin ProfileRank
    const pickMember = (qq) => {
      if (!qq) return null
      try { return e.group.pickMember(qq) } catch { return null }
    }

    await Promise.all(list.map(async (item) => {
      const member = pickMember(item.qq)
      if (member) {
        try {
          item.qqFace = await member.getAvatarUrl?.().catch(() => null) || `https://q.qlogo.cn/g?b=qq&nk=${item.qq}&s=100`
        } catch { item.qqFace = `https://q.qlogo.cn/g?b=qq&nk=${item.qq}&s=100` }
        item.nickname = member.card || member.name || ''
      }
    }))

    if (selfRank) {
      const member = pickMember(selfRank.qq)
      if (member) {
        try {
          selfRank.qqFace = await member.getAvatarUrl?.().catch(() => null) || `https://q.qlogo.cn/g?b=qq&nk=${selfRank.qq}&s=100`
        } catch { selfRank.qqFace = `https://q.qlogo.cn/g?b=qq&nk=${selfRank.qq}&s=100` }
        selfRank.nickname = member.card || member.name || ''
      }
    }

    // 获取赛季元信息
    const seasonMeta = await ChallengeRank.getSeasonMeta(challengeType, e.group_id)

    // 渲染排行
    const renderData = {
      title: `*${typeName}·${dimLabel}排行`,
      challengeType,
      dimension,
      dimLabel,
      list,
      selfRank,
      totalCount,
      groupId: e.group_id,
      topN,
      beginTime: seasonMeta?.beginTime || '',
      endTime: seasonMeta?.endTime || '',
      periodNumber: seasonMeta?.periodNumber || null
    }
    const img = await render('challenge/SR', 'rank', renderData)
    if (img) await e.reply(img)
    return true
  }

  /**
   * *重置忘却排名 — 重置本群某类型排行（仅 master）
   */
  async challengeRankReset (e) {
    const challengeType = this._resolveChallengeAlias(e.msg)
    if (challengeType < 0) return true

    const typeName = ChallengeRank.getTypeName(challengeType)
    await ChallengeRank.resetRank(e.group_id, challengeType)
    await e.reply(`已重置本群${typeName}排行数据`)
    return true
  }

  /**
   * *开启/关闭挑战排名 — 开关本群排行功能（仅 master）
   */
  async challengeRankManage (e) {
    const enable = e.msg.includes('开启')
    const status = enable ? 1 : 0
    await ChallengeRank.setGroupStatus(e.group_id, status)
    await e.reply(`已${enable ? '开启' : '关闭'}本群挑战排行功能`)
    return true
  }

  // ==================== 工具方法 ====================

  /**
   * 获取当前挑战类型：0=末日, 1=虚构, 2=混沌
   * 基于 2024-06-24 第一期末日幻影，每 2 周轮换
   */
  _getCurrentChallengeType () {
    const firstTime = new Date('2024-06-24T04:00:00')
    const diff = Date.now() - firstTime.getTime()
    if (diff < 0) {
      logger.error(`${LOG_PREFIX} 系统时间早于第一期末日幻影时间`)
      return 0
    }
    // 每 14 天一个周期，取 mod 3
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 14)) % 3
  }

  /**
   * 时间格式化（原生 Date 替代 moment）
   * @param {{year, month, day, hour, minute}} timeObj
   * @param {boolean} [includeTime] - 是否包含时分
   */
  _timeFormat (timeObj, includeTime) {
    if (!timeObj) return ''
    const { year, month, day, hour, minute } = timeObj
    const pad = (n) => String(n).padStart(2, '0')
    const date = `${year}.${pad(month)}.${pad(day)}`
    if (includeTime) return `${date} ${pad(hour || 0)}:${pad(minute || 0)}`
    return date
  }
}
