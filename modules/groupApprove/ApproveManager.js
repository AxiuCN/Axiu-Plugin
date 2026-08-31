import { segment } from 'oicq'
import { LOG_PREFIX } from '../../components/constants.js'

/**
 * 从加群申请备注中提取答案文本
 * 支持 "答案：xxx" / "答案: xxx" 格式，未匹配时返回原始备注
 * @param {string} comment - 申请备注
 * @returns {string} 提取后的答案（小写、去首尾空格）
 */
export function extractAnswer(comment) {
  const match = comment.match(/答案[：:]\s*(.+)/)
  if (match) return match[1].trim().toLowerCase()
  return comment.trim().toLowerCase()
}

/**
 * 检查机器人是否在指定群内拥有管理员/群主权限
 * 优先通过 pickMember().getInfo()，失败时降级为 getMemberMap()
 * @param {object} group - 群对象（来自事件对应的 bot 实例）
 * @param {string|number} botUin - 当前事件对应的机器人账号
 * @returns {Promise<boolean>}
 */
export async function checkBotIsAdmin(group, botUin) {
  try {
    const member = await group.pickMember(botUin).getInfo()
    if (member && (member.role === 'owner' || member.role === 'admin')) {
      return true
    }
  } catch (err) {
    logger.error(`${LOG_PREFIX} 获取机器人自身信息失败:`, err)
  }

  // 降级方案
  try {
    const memberMap = await group.getMemberMap()
    const botMember = memberMap.get(botUin)
    if (botMember && (botMember.role === 'owner' || botMember.role === 'admin')) {
      return true
    }
  } catch (err2) {
    logger.error(`${LOG_PREFIX} 降级获取成员信息也失败:`, err2)
  }

  return false
}

/**
 * 获取群内除机器人外的所有管理员 QQ 号
 * @param {object} group - 群对象
 * @param {string|number} botUin - 当前事件对应的机器人账号
 * @returns {Promise<string[]>}
 */
export async function getOtherAdmins(group, botUin) {
  try {
    const memberMap = await group.getMemberMap()
    const admins = []
    for (const [uid, member] of memberMap) {
      if ((member.role === 'admin' || member.role === 'owner') && String(uid) !== String(botUin)) {
        admins.push(uid)
      }
    }
    return admins
  } catch (err) {
    logger.error(`${LOG_PREFIX} 获取群${group.gid || '?'}管理员列表失败:`, err)
    return []
  }
}

/**
 * 处理单次加群申请
 * @param {object} options
 * @param {object} options.e - 事件对象（request.group.add）
 * @param {Map<string, {whitelistAnswers: string[], blacklistAnswers: string[]}>} options.groupConfig - 群配置 Map
 */
export async function handleRequest({ e, groupConfig }) {
  const groupId = e.group_id
  const applicantId = e.user_id
  const comment = e.comment || ''

  const rawAnswer = extractAnswer(comment)
  // 使用事件对应的 bot 实例（多 Bot 场景各账号独立判定），而非全局 Bot
  const botUin = e.self_id || e.bot?.uin || Bot.uin
  const group = e.group || (e.bot?.pickGroup ? e.bot.pickGroup(groupId) : Bot.pickGroup(groupId))
  if (!group) return

  // 检查机器人权限
  const botIsAdmin = await checkBotIsAdmin(group, botUin)
  if (!botIsAdmin) {
    logger.warn(`${LOG_PREFIX} 机器人在群${groupId}无管理员权限，无法处理申请`)
    const admins = await getOtherAdmins(group, botUin)
    if (admins.length > 0) {
      const atList = admins.map(id => segment.at(id))
      const msg = [
        ...atList,
        `\n【机器人无管理员权限】无法自动处理入群申请，请管理员手动处理。\n申请人：${applicantId}\n验证信息：${comment || '无'}`
      ]
      await group.sendMsg(msg).catch(err =>
        logger.error(`${LOG_PREFIX} 群内通知失败:`, err))
    }
    return
  }

  // 匹配黑白名单
  const cfg = groupConfig.get(String(groupId)) || { whitelistAnswers: [], blacklistAnswers: [] }
  const whitelist = cfg.whitelistAnswers || []
  const blacklist = cfg.blacklistAnswers || []

  const isWhitelist = whitelist.some(
    answer => answer.trim().toLowerCase() === rawAnswer
  )
  const isBlacklist = blacklist.some(
    answer => answer.trim().toLowerCase() === rawAnswer
  )

  if (isWhitelist) {
    try {
      await e.approve(true)
      logger.info(`${LOG_PREFIX} 同意用户${applicantId}加入群${groupId}`)
    } catch (err) {
      logger.error(`${LOG_PREFIX} 同意用户${applicantId}入群失败:`, err)
    }
  } else if (isBlacklist) {
    try {
      await e.approve(false, '无关人员，谢绝入内')
      logger.info(`${LOG_PREFIX} 拒绝用户${applicantId}加入群${groupId}`)
      await group.sendMsg(
        `[自动入群审核]\n用户 ${applicantId} 已被拒绝，其入群问答为\n${rawAnswer || '无'}`
      )
    } catch (err) {
      logger.error(`${LOG_PREFIX} 拒绝用户${applicantId}失败:`, err)
    }
  } else {
    // 未命中，通知管理员人工审核
    logger.info(`${LOG_PREFIX} 用户${applicantId}申请加入群${groupId}，答案不匹配，通知管理员`)
    const admins = await getOtherAdmins(group, botUin)
    if (admins.length === 0) {
      logger.warn(`${LOG_PREFIX} 群${groupId}没有其他管理员`)
      return
    }
    const atList = admins.map(id => segment.at(id))
    const msg = [
      ...atList,
      `\n【入群申请待人工审核】\n申请人：${applicantId}\n入群问答：${rawAnswer || '无'}\n请管理员处理`
    ]
    await group.sendMsg(msg).catch(err =>
      logger.error(`${LOG_PREFIX} 群内通知管理员失败:`, err))
  }
}
