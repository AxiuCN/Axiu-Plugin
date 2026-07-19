/** 星铁终局挑战查询 — 移植自 StarRail-plugin apps/challenge.js
 *  接入 Axiu-Plugin 过码链路（MysSrApi.checkCode → mys.req.err handler）
 *
 *  命令:
 *    #末日 / #末日幻影 — 末日幻影 (challengeType=0)
 *    #虚构 / #虚构叙事 — 虚构叙事 (challengeType=1)
 *    #忘却 / #混沌回忆 — 忘却之庭 (challengeType=2)
 *    #仲裁 / #异相仲裁 — 异相仲裁 (challengeType=3)
 *    #深渊             — 三种合一 (0+1+2)
 *    #最新深渊 / #当期深渊 — 当前最新一期
 *
 *  修饰符: 上期/本期 | 简易（跳过详细API）| 往期（仲裁三期历史）
 */

import plugin from '../../../../lib/plugins/plugin.js'
import MysSrApi from '../model/mys/mysSrApi.js'
import { render } from '../components/render.js'
import { LOG_PREFIX } from '../components/constants.js'

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
          reg: '^#?(星铁)?(上期|本期)?(简易)?(末日|末日幻影)$',
          fnc: 'challengeBoss'
        },
        // 虚构叙事
        {
          reg: '^#?(星铁)?(上期|本期)?(简易)?(虚构|虚构叙事)$',
          fnc: 'challengeStory'
        },
        // 忘却之庭 / 混沌回忆
        {
          reg: '^#?(星铁)?(上期|本期)?(简易)?(忘却|忘却之庭|混沌|混沌回忆)$',
          fnc: 'challengeForgottenHall'
        },
        // 异相仲裁
        {
          reg: '^#?(星铁)?(往期|上期|本期)?(简易)?(异乡|异相|异向|仲裁|异相仲裁)$',
          fnc: 'challengePeak'
        },
        // 全部深渊（三种合一）
        {
          reg: '^#?(星铁)?(上期|本期)?(简易)?(深渊)$',
          fnc: 'challenge'
        },
        // 最新深渊
        {
          reg: '^#?(星铁)?(最新|当期)(简易)?(深渊)$',
          fnc: 'challengeCurrent'
        }
      ]
    })
  }

  // ==================== 核心查询 ====================

  /**
   * 查询挑战数据
   * @param {object} e - 消息 event
   * @param {number} challengeType - 0=末日, 1=虚构, 2=忘却, 3=仲裁
   * @param {boolean} [all] - 是否跳过 uid/ck 读取（批量查询时已提前获取）
   * @param {string} [uid] - 预获取的 uid
   * @param {string} [ck] - 预获取的 ck
   */
  async queryChallenge (e, challengeType, all, uid, ck) {
    this.e.isSr = true
    this.isSr = true
    const simple = this.e.msg.match('简易')
    const last = this.e.msg.match('上期')
    const recent = this.e.msg.match('往期')

    // 获取 uid + cookie（批量查询时外部已提前获取）
    if (all !== true) {
      uid = await this._userUid(e)
      if (!uid) return false
      ck = await this._userCk(e, uid)
      if (!ck) return false
    }

    // schedule_type: 1=本期, 2=上期, 3=第三期（仲裁专用）
    let scheduleType = '1'
    if (last) scheduleType = '2'
    if ((recent || last) && challengeType === 3) scheduleType = '3'

    const api = new MysSrApi(uid, ck)

    // 获取设备指纹
    let deviceFp = await api.getData('getFp')
    if (deviceFp?.retcode !== 0) return false
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
      if (simpleRes?.retcode !== 0) return false
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
      data.all_floor_detail = _.map(data.all_floor_detail, (floor) => ({
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
      data.peak_records.mob_records = _.map(data.peak_records.mob_records, (record) => ({
        ...record,
        ...(record.challenge_time && {
          challengeTime: this._timeFormat(record.challenge_time, true)
        })
      }))
    }

    // 末日幻影、虚构叙事：计算两边节点总分
    if ([0, 1].includes(challengeType)) {
      data.all_floor_detail = _.map(data.all_floor_detail, (floor) => {
        if (floor.node_1.score != null) {
          let totalScore = parseInt(floor.node_1.score)
          if (floor.node_2 && floor.node_2.score != null) totalScore += parseInt(floor.node_2.score)
          if (floor.node_3 && floor.is_tierce) totalScore += parseInt(floor.node_3.score)
          return { ...floor, score: totalScore.toString() }
        }
        return floor
      })
    }

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

    data.mob_records = _.map(data.mob_records, (r) => ({
      ...r,
      ...(r.challenge_time && { challengeTime: this._timeFormat(r.challenge_time, true) })
    }))

    return data
  }

  // ==================== 各模式命令 ====================

  async challengeForgottenHall (e) {
    await e.reply('正在获取忘却之庭数据，请稍后……')
    const res = await this.queryChallenge(e, 2)
    if (!res) return false
    await render('challenge/SR', 'index', res)
  }

  async challengeStory (e) {
    await e.reply('正在获取虚构叙事数据，请稍后……')
    const res = await this.queryChallenge(e, 1)
    if (!res) return false
    await render('challenge/SR', 'index', res)
  }

  async challengeBoss (e) {
    await e.reply('正在获取末日幻影数据，请稍后……')
    const res = await this.queryChallenge(e, 0)
    if (!res) return false
    await render('challenge/SR', 'index', res)
  }

  async challengePeak (e) {
    await e.reply('正在获取异相仲裁数据，请稍后……')
    let tplFile = 'index_peak'
    const res = await this.queryChallenge(e, 3)
    if (!res) return false

    if (e.msg.match('往期')) {
      tplFile = 'peak_recent'
      const records = res.data.challenge_peak_records
      res.present = this._recentPeak(records[0])
      res.last = this._recentPeak(records[1])
      res.early = this._recentPeak(records[2])
    }

    await render('challenge/SR', tplFile, res)
  }

  async challenge (e) {
    await e.reply('正在获取全部深渊数据，请稍后……')

    const uid = await this._userUid(e)
    if (!uid) return false
    const ck = await this._userCk(e, uid)
    if (!ck) return false

    const results = await Promise.all([
      this.queryChallenge(e, 2, true, uid, ck), // 忘却
      this.queryChallenge(e, 1, true, uid, ck), // 虚构
      this.queryChallenge(e, 0, true, uid, ck)  // 末日
    ])

    if (!results[0] || !results[1] || !results[2]) return false

    await render('challenge/SR', 'index_all', {
      hall: results[0],
      story: results[1],
      boss: results[2]
    })
  }

  async challengeCurrent (e) {
    await e.reply('正在获取最新深渊数据，请稍后……')
    const res = await this.queryChallenge(e, this._getCurrentChallengeType())
    if (!res) return false
    await render('challenge/SR', 'index', res)
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

  /** 获取 SR UID */
  async _userUid (e) {
    // 优先从消息中提取
    const match = e.msg.match(/\d{9,10}/)
    if (match) return match[0]

    // 降级：通过 genshin MysInfo 获取
    try {
      const MysInfo = (await import('../../../genshin/model/mys/mysInfo.js')).default
      const uid = await MysInfo.getUid(e, false)
      if (uid) return uid
    } catch (err) {
      logger.debug(`${LOG_PREFIX}[challenge] MysInfo.getUid 失败: ${err.message}`)
    }

    await e.reply('找不到UID，请发送 #刷新ck 或 #扫码登录 绑定角色')
    return false
  }

  /** 获取 SR Cookie */
  async _userCk (e, uid) {
    try {
      const MysInfo = (await import('../../../genshin/model/mys/mysInfo.js')).default
      const result = await MysInfo.checkUidBing(uid, 'sr')
      const ck = result?.ck
      if (ck) return ck
    } catch (err) {
      logger.debug(`${LOG_PREFIX}[challenge] checkUidBing 失败: ${err.message}`)
    }

    await e.reply(`UID:${uid} 当前尚未绑定Cookie，请发送 #扫码登录 绑定`)
    return false
  }
}
