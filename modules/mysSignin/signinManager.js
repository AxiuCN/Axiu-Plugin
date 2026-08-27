/** 米游社签到编排层
 *
 *  负责：注册 / 签到 / 刷新 / 状态 / 环境初始化 / 自动签到
 *  委托调用 model 层（stokenStore、QrUser、bbsToolsConfig、bbsToolsRunner）
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import YAML from 'yaml'
import stokenStore from '../../model/stokenStore.js'
import QrUser from '../../model/qrUser.js'
import { getServer } from '../../model/mys/passportUtils.js'
import {
  listUserConfigs,
  listAllRegisteredQQ,
  getNextN,
  writeUserConfig,
  refreshUserConfigCookie,
  deleteUserConfig,
  deleteUserConfigs,
  getSigninConfig,
  pluginRoot
} from '../../model/mysSignin/bbsToolsConfig.js'
import { runSingleSignin } from '../../model/mysSignin/bbsToolsRunner.js'
import { CaptchaBridge } from './captchaBridge.js'
import { SIGNIN_LOG_PREFIX } from '../../components/constants.js'
import { writeSigninLog } from '../../components/signinLogger.js'

/** 随机延迟（避免 API 限流）*/
const randomDelay = (min, max) =>
  new Promise(resolve => setTimeout(resolve, min + Math.random() * (max - min)))

// ==================== Cookie 刷新 ====================

/**
 * 用 stoken 获取新 cookie_token
 * @param {string} userId - QQ 号
 * @param {object} st - stoken 条目 ({stuid, stoken, ltoken, mid, uid})
 * @returns {Promise<{cookie: string|null, stokenInvalid: boolean}>}
 *   cookie - 完整 cookie 字符串，失败为 null
 *   stokenInvalid - 失败且判定为 stoken 失效（登录类错误）时为 true
 */
async function refreshCookie (userId, st) {
  try {
    const qrUser = new QrUser({
      user_id: userId,
      uid: st.uid,
      region: getServer(st.uid)
    })

    let cookies = `uid=${st.stuid}&stoken=${st.stoken}`
    if (st?.mid) cookies += `&mid=${st.mid}`

    const res = await qrUser.getData('bbsGetCookie', { cookies }, false)
    if (!res?.data?.cookie_token) {
      const stokenInvalid = /(登录|login)/i.test(res?.message || '')
      if (stokenInvalid) {
        logger?.warn(
          `${SIGNIN_LOG_PREFIX} bbsGetCookie stoken失效: uid=${st.uid} ` +
          `retcode=${res?.retcode} msg=${res?.message}`
        )
      } else {
        logger?.warn(
          `${SIGNIN_LOG_PREFIX} bbsGetCookie 失败: uid=${st.uid} ` +
          `retcode=${res?.retcode} msg=${res?.message}`
        )
      }
      return { cookie: null, stokenInvalid }
    }

    const ck = res.data.cookie_token
    const cookie = `ltoken=${st.ltoken};ltuid=${st.stuid};cookie_token=${ck};account_id=${st.stuid};`
    return { cookie, stokenInvalid: false }
  } catch (err) {
    logger?.error(`${SIGNIN_LOG_PREFIX} refreshCookie 异常: ${err.message}`)
    return { cookie: null, stokenInvalid: false }
  }
}

// ==================== 注册 ====================

/**
 * 为单个用户注册自动签到
 * @param {string} userId - QQ 号
 * @returns {Promise<{ok: boolean, count: number, failed: Array<string>, message: string}>}
 */
async function registerUser (userId) {
  const stokenData = await stokenStore.getUserStoken(userId)
  if (!stokenData || Object.keys(stokenData).length === 0) {
    return { ok: false, count: 0, failed: [], message: '请先绑定 stoken\n发送【#扫码登录】进行绑定' }
  }

  const accounts = Object.entries(stokenData)

  // 按 stuid 去重：同一米游社账号可能有多个游戏角色（原神+星铁），共用一份签到配置
  const seenStuid = new Set()
  const uniqueAccounts = []
  for (const [uid, st] of accounts) {
    if (!st?.stuid || !st?.stoken) continue
    const key = String(st.stuid)
    if (seenStuid.has(key)) {
      logger?.info(`${SIGNIN_LOG_PREFIX} 跳过重复stuid: QQ=${userId} uid=${uid} stuid=${key}`)
      continue
    }
    seenStuid.add(key)
    uniqueAccounts.push([uid, st])
  }

  let registered = 0
  const errors = []
  let accountIdx = 0

  for (const [uid, st] of uniqueAccounts) {
    accountIdx++
    const label = `账号${accountIdx}`

    if (!st?.stuid || !st?.stoken) {
      errors.push(`${label} stoken 数据不完整`)
      continue
    }

    const { cookie, stokenInvalid } = await refreshCookie(userId, st)
    if (!cookie) {
      if (stokenInvalid) {
        // stoken 已失效：自动从 stoken 存储清理该账号条目，避免后续流程重复报错
        stokenStore.deleteStokenEntry(userId, uid)
        logger?.warn(`${SIGNIN_LOG_PREFIX} 自动清理失效stoken: QQ=${userId} uid=${uid} stuid=${String(st.stuid)}`)
        errors.push(`${label} sk 已失效，已自动删除，请重新扫码绑定后重新【#注册自动签到】`)
      } else {
        errors.push(`${label} cookie 刷新失败，sk 可能已失效`)
      }
      continue
    }

    const n = getNextN(userId)
    try {
      writeUserConfig(userId, n, st, cookie)
      registered++
      logger?.info(`${SIGNIN_LOG_PREFIX} 注册成功: QQ=${userId} n=${n} uid=${uid} stuid=${String(st.stuid)}`)
    } catch (err) {
      errors.push(`${label} 写入配置失败: ${err.message}`)
    }
  }

  if (registered === 0) {
    return { ok: false, count: 0, failed: errors, message: `注册失败\n${errors.join('\n')}` }
  }

  let msg = `已注册 ${registered} 个账号`
  if (errors.length > 0) msg += `\n以下账号注册失败:\n${errors.join('\n')}`
  return { ok: true, count: registered, failed: errors, message: msg }
}

/**
 * 批量注册群成员
 * @param {string[]} memberIds - 群成员 QQ 号列表
 * @returns {Promise<{ok: boolean, total: number, success: number, skipped: number, failed: Array<string>, message: string}>}
 */
async function registerGroupMembers (memberIds) {
  let success = 0
  let skipped = 0
  const failed = []

  // 去重：同一 QQ 只处理一次
  const uniqueIds = [...new Set(memberIds.map(String))]

  for (const userId of uniqueIds) {
    // 已是注册用户则跳过，避免跨群重复创建配置
    const existing = listUserConfigs(userId)
    if (existing.length > 0) {
      skipped++
      continue
    }

    const result = await registerUser(userId)
    if (result.ok) {
      success++
    } else {
      failed.push(String(userId))
    }
    // 随机间隔避免并发 API 调用
    await randomDelay(1000, 3000)
  }

  return {
    ok: success > 0 || skipped > 0,
    total: uniqueIds.length,
    success,
    skipped,
    failed,
    message: `已为 ${success} 个成员注册签到` +
      (skipped > 0 ? `\n跳过 ${skipped} 人（已注册）` : '') +
      (failed.length > 0 ? `\n失败 ${failed.length} 人` : '')
  }
}

// ==================== 签到执行 ====================

/**
 * 为单个 QQ 执行签到（所有 _n 配置文件）
 * @param {string} userId - QQ 号
 * @param {boolean} isAuto - 是否自动签到（影响通知方式）
 * @returns {Promise<{ok: boolean, results: Array, message: string}>}
 */
async function signinForUser (userId, isAuto = false) {
  const configs = listUserConfigs(userId)
  if (configs.length === 0) {
    return { ok: false, results: [], message: `QQ=${userId}: 未注册签到` }
  }

  const signinCfg = getSigninConfig()
  const results = []

  for (const cfg of configs) {
    // 过码重试循环
    let lastResult = null
    for (let retry = 0; retry <= signinCfg.captchaRetries; retry++) {
      if (retry > 0) {
        logger?.info(
          `${SIGNIN_LOG_PREFIX} 过码重试: QQ=${userId} n=${cfg.n} 第${retry}次`
        )
      }

      const bridge = new CaptchaBridge()
      lastResult = await runSingleSignin({
        configPath: cfg.path,
        userId,
        profileN: cfg.n,
        captchaBridge: bridge
      })

      // statusCode 3 表示触发过码需要重试
      if (lastResult.statusCode !== 3) break
    }

    results.push({
      userId,
      n: cfg.n,
      ...lastResult
    })

    // 多配置文件间加随机延迟
    if (configs.length > 1) {
      await randomDelay(2000, 5000)
    }
  }

  const allOk = results.every(r => r.ok)
  const msg = formatUserSigninResult(userId, results)

  return { ok: allOk, results, message: msg }
}

/**
 * 为所有注册用户执行签到
 * @param {boolean} isAuto - 是否自动签到
 * @param {function} onProgress - 进度回调 ({userId, ok, message})
 * @returns {Promise<{total: number, success: number, details: Array}>}
 */
async function signinForAll (isAuto = true, onProgress) {
  const qqList = listAllRegisteredQQ()
  if (qqList.length === 0) {
    return { total: 0, success: 0, details: [] }
  }

  let success = 0
  const details = []

  for (const userId of qqList) {
    const result = await signinForUser(userId, isAuto)
    const userOk = result.results.every(r => r.ok)
    if (userOk) success++

    details.push({ userId, ...result })

    if (onProgress) {
      await onProgress({ userId, ok: userOk, message: result.message })
    }

    // 用户间随机延迟 3-10 秒
    await randomDelay(3000, 10000)
  }

  return {
    total: qqList.length,
    success,
    details
  }
}

// ==================== Cookie 刷新 ====================

/**
 * 刷新指定 QQ 的所有签到配置文件的 cookie
 * @param {string} userId - QQ 号
 * @returns {Promise<{ok: boolean, count: number, message: string, failed: Array<{n: number, reason: string}>}>}
 */
async function refreshUserCookies (userId) {
  const stokenData = await stokenStore.getUserStoken(userId)
  if (!stokenData || Object.keys(stokenData).length === 0) {
    return { ok: false, count: 0, message: '请先绑定 stoken', failed: [] }
  }

  const configs = listUserConfigs(userId)
  if (configs.length === 0) {
    return { ok: false, count: 0, message: '未注册签到，请先发送【#注册自动签到】', failed: [] }
  }

  let refreshed = 0
  const failed = []

  for (const cfg of configs) {
    // 从配置文件中读取 stuid 匹配 stoken
    try {
      const cfgData = fs.existsSync(cfg.path)
        ? YAML.parse(fs.readFileSync(cfg.path, 'utf8'))
        : null

      if (!cfgData?.account?.stuid) {
        failed.push({ n: cfg.n, reason: '配置文件异常' })
        continue
      }

      const stuid = String(cfgData.account.stuid)
      // 在 stokenData 中匹配 stuid
      const st = Object.values(stokenData).find(
        s => String(s?.stuid) === stuid
      )

      if (!st) {
        failed.push({ n: cfg.n, reason: '未找到匹配的 stoken' })
        continue
      }

      const { cookie, stokenInvalid } = await refreshCookie(userId, st)
      if (!cookie) {
        if (stokenInvalid) {
          // sk（stoken）已失效：自动删除该签到配置文件，避免每日自动刷新/签到持续失败空转
          deleteUserConfig(userId, cfg.n)
          logger?.warn(`${SIGNIN_LOG_PREFIX} 自动删除失效sk配置: QQ=${userId} n=${cfg.n} stuid=${stuid} (stoken失效)`)
          failed.push({ n: cfg.n, reason: 'sk 已失效，已自动删除签到配置，请重新扫码绑定后重新【#注册自动签到】' })
        } else {
          failed.push({ n: cfg.n, reason: 'cookie 刷新失败' })
        }
        continue
      }

      refreshUserConfigCookie(cfg.path, st, cookie)
      refreshed++
      logger?.info(`${SIGNIN_LOG_PREFIX} 刷新cookie成功: QQ=${userId} n=${cfg.n}`)
    } catch (err) {
      failed.push({ n: cfg.n, reason: err.message })
    }
  }

  if (refreshed === 0) {
    return {
      ok: false, count: 0, failed,
      message: '刷新失败\n' + failed.map(f => `账号${f.n} ${f.reason}`).join('\n')
    }
  }

  let msg = `已刷新 ${refreshed} 个账号的 cookie`
  if (failed.length > 0) msg += '\n失败:\n' + failed.map(f => `账号${f.n} ${f.reason}`).join('\n')
  return { ok: true, count: refreshed, failed, message: msg }
}

// ==================== 删除签到/删除stoken ====================

/**
 * 删除指定 QQ 的所有签到配置文件（#删除签到）
 * @param {string} userId - QQ 号
 * @returns {{ok: boolean, count: number, message: string}}
 */
async function deleteUserSigninConfigs (userId) {
  const configs = listUserConfigs(userId)
  if (configs.length === 0) {
    return { ok: false, count: 0, message: '未注册签到，无需删除' }
  }
  const deleted = deleteUserConfigs(userId)
  logger?.info(`${SIGNIN_LOG_PREFIX} 删除签到配置: QQ=${userId} 共${deleted}个`)
  return {
    ok: true,
    count: deleted,
    message: `已删除 ${deleted} 个签到配置\n如需继续签到请重新发送【#注册自动签到】`
  }
}

/**
 * 删除指定 QQ 的全部 stoken（#删除stoken）
 * 遍历 stoken 文件所有条目逐个删除（同 stoken 合并删除），文件清空后删除文件本身
 * @param {string} userId - QQ 号
 * @returns {{ok: boolean, count: number, message: string}}
 */
async function deleteUserStoken (userId) {
  const stokenData = await stokenStore.getUserStoken(userId)
  const uids = Object.keys(stokenData)
  if (uids.length === 0) {
    return { ok: false, count: 0, message: '未绑定 stoken' }
  }

  let deleted = 0
  for (const uid of uids) {
    if (stokenStore.deleteStokenEntry(userId, uid)) deleted++
  }
  logger?.info(`${SIGNIN_LOG_PREFIX} 删除stoken: QQ=${userId} 删除${deleted}个条目`)
  return {
    ok: true,
    count: deleted,
    message: `已删除 ${deleted} 个 stoken 条目\n删除后需重新发送【#扫码登录】绑定`
  }
}

/**
 * 刷新所有已注册用户的签到 cookie
 * 每日 4:30 自动执行，确保 5:00 签到前 cookie 有效
 * @returns {Promise<{total: number, success: number, failedUsers: Array<{userId: string, failed: Array<{n: number, reason: string}>}>, message: string}>}
 */
async function refreshAllUserCookies () {
  const qqList = listAllRegisteredQQ()
  if (qqList.length === 0) {
    logger?.info(`${SIGNIN_LOG_PREFIX} 无已注册用户，跳过刷新`)
    return { total: 0, success: 0, failedUsers: [], message: '无已注册用户' }
  }

  logger?.info(`${SIGNIN_LOG_PREFIX} 开始批量刷新cookie: ${qqList.length} 个用户`)
  let success = 0
  const failedUsers = []

  for (const userId of qqList) {
    const result = await refreshUserCookies(userId)
    if (result.ok) {
      success++
    } else if (result.failed?.length > 0) {
      failedUsers.push({ userId, failed: result.failed })
    }
    await randomDelay(2000, 5000)
  }

  logger?.info(
    `${SIGNIN_LOG_PREFIX} 批量刷新cookie完成: ${success}/${qqList.length} 成功`
  )
  return {
    total: qqList.length,
    success,
    failedUsers,
    message: `刷新完成: ${success}/${qqList.length} 成功` +
      (failedUsers.length > 0 ? `\n失败:\n${failedUsers.map(u => `QQ=${u.userId}: ${u.failed.map(f => `账号${f.n} ${f.reason}`).join('; ')}`).join('\n')}` : '')
  }
}

// ==================== 环境初始化 ====================

/**
 * 初始化签到环境
 * @returns {Promise<{ok: boolean, message: string}>}
 */
async function initEnvironment () {
  const signinCfg = getSigninConfig()
  const pythonCmd = signinCfg.pythonCommand
  const parts = []

  // 1. 检查 Python
  try {
    const pyVer = execSync(`"${pythonCmd}" --version 2>&1`, {
      encoding: 'utf8', timeout: 10000, windowsHide: true
    }).trim()
    parts.push(`Python: ${pyVer}`)
  } catch {
    return {
      ok: false,
      message: `Python 不可用\n命令: ${pythonCmd}\n请在锅巴后台配置 signin.pythonCommand`
    }
  }

  // 2. 拉取 MihoyoBBSTools 子模块
  try {
    const submodulePath = 'tool/MihoyoBBSTools'
    execSync(`git submodule update --init -- ${submodulePath}`, {
      encoding: 'utf8', cwd: pluginRoot, timeout: 60000, windowsHide: true
    })
    parts.push('子模块 MihoyoBBSTools 已就绪')
  } catch (err) {
    parts.push(`子模块更新警告: ${err.message}`)
  }

  // 3. 安装 Python 依赖
  try {
    const reqPath = `${pluginRoot}/tool/MihoyoBBSTools/MihoyoBBSTools/requirements.txt`
    execSync(`"${pythonCmd}" -m pip install -r "${reqPath}" 2>&1`, {
      encoding: 'utf8', timeout: 120000, windowsHide: true
    })
    parts.push('Python 依赖安装完成')
  } catch (err) {
    parts.push(`依赖安装警告: ${err.message}`)
  }

  // 4. 确保 MihoyoBBSTools config 目录存在
  const BBS_TOOLS_CONFIG_DIR = path.join(pluginRoot, 'tool', 'MihoyoBBSTools', 'MihoyoBBSTools', 'config')
  if (!fs.existsSync(BBS_TOOLS_CONFIG_DIR)) {
    fs.mkdirSync(BBS_TOOLS_CONFIG_DIR, { recursive: true })
    parts.push('签到配置目录已创建')
  }

  return { ok: true, message: parts.join('\n') }
}

// ==================== 状态查询 ====================

/**
 * 获取用户签到状态
 * @param {string} userId - QQ 号
 * @returns {Promise<{bound: boolean, profiles: Array, message: string}>}
 */
async function getSigninStatus (userId) {
  const stokenData = await stokenStore.getUserStoken(userId)
  const hasStoken = stokenData && Object.keys(stokenData).length > 0

  const configs = listUserConfigs(userId)
  const profiles = []

  for (const cfg of configs) {
    try {
      const raw = fs.readFileSync(cfg.path, 'utf8')
      // 简单提取签到开关信息
      const hasGenshin = raw.includes('genshin:') && raw.includes('checkin: true')
      const hasSR = raw.includes('honkai_sr:') && raw.includes('checkin: true')
      const hasZZZ = raw.includes('zzz:') && raw.includes('checkin: true')
      const hasBBS = raw.includes('mihoyobbs:') &&
        raw.includes('enable: true') &&
        raw.includes('checkin: true')
      profiles.push({ n: cfg.n, games: { genshin: hasGenshin, sr: hasSR, zzz: hasZZZ }, bbs: hasBBS })
    } catch {
      profiles.push({ n: cfg.n, games: {}, bbs: false })
    }
  }

  let msg = ''
  if (!hasStoken) {
    msg = '尚未绑定 stoken\n发送【#扫码登录】进行绑定'
  } else if (profiles.length === 0) {
    msg = `已绑定 ${Object.keys(stokenData).length} 个米游社账号\n尚未注册签到，发送【#注册自动签到】`
  } else {
    msg = `已绑定 ${Object.keys(stokenData).length} 个账号，已注册 ${profiles.length} 个签到配置`
    for (const p of profiles) {
      const games = []
      if (p.games.genshin) games.push('原神')
      if (p.games.sr) games.push('星铁')
      if (p.games.zzz) games.push('绝区零')
      msg += `\n  #${p.n}: ${games.join('/') || '无游戏'} ${p.bbs ? '+社区' : ''}`
    }
  }

  return { bound: hasStoken, profiles, message: msg }
}

// ==================== 格式化 ====================

/**
 * 格式化单个用户的签到结果
 * @param {string} userId - QQ 号
 * @param {Array} results - 签到结果数组
 * @returns {string}
 */
function formatUserSigninResult (userId, results) {
  const okCount = results.filter(r => r.ok).length
  const failCount = results.filter(r => !r.ok).length
  let msg = `签到完成: 成功 ${okCount} 个账号`
  if (failCount > 0) msg += ` / 失败 ${failCount} 个账号`

  for (const r of results) {
    if (r.ok) continue
    msg += `\n账号${r.n}: ${r.message || '未知错误'}`
  }
  return msg
}

/**
 * 构建自动签到汇总报告（结构化：头部统计 + 失败用户分组）
 * @param {{total: number, success: number, details: Array}} summary
 * @returns {{header: string, failedUsers: Array<{qq: string, lines: string[]}>}}
 */
function buildSigninReport (summary) {
  if (summary.total === 0) return { header: '没有已注册的签到用户', failedUsers: [] }

  const failedUsers = summary.details
    .filter(d => d.results?.some(r => !r.ok))
    .map(d => ({
      qq: String(d.userId),
      lines: (d.results || [])
        .filter(r => !r.ok)
        .map(r => `账号${r.n}: ${r.message || '未知错误'}`)
    }))

  return {
    header: `--- 自动签到报告 ---\n签到成功: ${summary.success}/${summary.total} 用户\n签到失败: ${failedUsers.length}/${summary.total} 用户`,
    failedUsers
  }
}

/**
 * 格式化全部签到汇总报告（兼容旧文本调用）
 * @param {{total: number, success: number, details: Array}} summary
 * @returns {string}
 */
function formatSummaryReport (summary) {
  const { header, failedUsers } = buildSigninReport(summary)
  let msg = header
  for (const u of failedUsers) {
    msg += `\n@${u.qq}\n${u.lines.join('\n')}`
  }
  return msg
}

/**
 * 构建自动刷新Cookie汇总报告
 * @param {{total: number, success: number, failedUsers: Array<{userId: string, failed: Array<{n: number, reason: string}>}>}} result
 * @returns {{header: string, failedUsers: Array<{qq: string, lines: string[]}>}}
 */
function buildRefreshReport (result) {
  if (result.total === 0) return { header: '无已注册用户，未执行刷新', failedUsers: [] }

  const failedUsers = result.failedUsers.map(u => ({
    qq: String(u.userId),
    lines: u.failed.map(f => `账号${f.n} ${f.reason}`)
  }))

  return {
    header: `--- 自动刷新Cookie报告 ---\n刷新Cookie成功: ${result.success}/${result.total}\n刷新Cookie失败: ${failedUsers.length}/${result.total}`,
    failedUsers
  }
}

// ==================== 自动签到锁 ====================

let _autoSigninRunning = false

function isAutoSigninRunning () { return _autoSigninRunning }
function setAutoSigninRunning (v) { _autoSigninRunning = v }

export {
  SIGNIN_LOG_PREFIX,
  refreshCookie,
  registerUser,
  registerGroupMembers,
  signinForUser,
  signinForAll,
  refreshUserCookies,
  refreshAllUserCookies,
  deleteUserSigninConfigs,
  deleteUserStoken,
  initEnvironment,
  getSigninStatus,
  formatUserSigninResult,
  formatSummaryReport,
  buildSigninReport,
  buildRefreshReport,
  isAutoSigninRunning,
  setAutoSigninRunning
}
