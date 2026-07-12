/** CK 自动刷新 — 猴子补丁 MysApi.prototype.getData
 *
 *  当米游社 API 返回 retcode 10001（CK 过期）时：
 *    1. 从 cookie 中提取 ltuid
 *    2. 遍历已绑定的 stoken 文件，匹配 stuid === ltuid
 *    3. 用匹配到的 stoken 调 bbsGetCookie 获取新 cookie_token
 *    4. 绑定到 genshin CK 系统
 *    5. 用新 cookie 重试原请求
 *
 *  成功 → 私聊通知 "先前ck已失效，米游社ck自动刷新成功"
 *  失败 → 私聊通知 "sk已失效，请重新扫码登陆" → 返回原始错误
 *
 *  导入方式：index.js 通过 Promise.allSettled 动态 import，无需修改入口
 */

import plugin from '../../../lib/plugins/plugin.js'
import MysApi from '../../genshin/model/mys/mysApi.js'
import stokenStore from '../model/stokenStore.js'
import QrUser from '../model/qrUser.js'
import { LOG_PREFIX } from '../components/constants.js'

// ==================== 工具函数 ====================

/** 从 cookie 字符串中提取指定字段 */
function getCookieField (cookie, field) {
  if (!cookie) return null
  const match = cookie.match(new RegExp(`${field}=([^;]*)`))
  return match ? match[1] : null
}

/**
 * 遍历所有 stoken YAML 文件，查找 stuid 匹配 ltuid 的记录
 * @param {string} ltuid 米游社通行证 ID
 * @returns {Promise<{userId: string, stoken: object} | null>}
 */
async function findStokenByLtuid (ltuid) {
  try {
    const allStokens = await stokenStore.getBingStoken()
    for (const userIdStokens of allStokens) {
      for (const [, st] of Object.entries(userIdStokens)) {
        if (String(st?.stuid) === String(ltuid)) {
          return { userId: String(st.userId), stoken: st }
        }
      }
    }
  } catch (err) {
    logger.error(`${LOG_PREFIX} [CK自动刷新] 搜索stoken失败:`, err)
  }
  return null
}

/** 通过 Bot 实例私聊通知用户 */
async function notifyUser (userId, message) {
  try {
    const bot = Bot
    const friend = bot.pickFriend(userId)
    await friend.sendMsg(message)
  } catch (err) {
    logger.warn(`${LOG_PREFIX} [CK自动刷新] 发送通知失败:`, err)
  }
}

// ==================== 并发保护 ====================

/**
 * 每个 ltuid 一个互斥锁，防止并发请求同时刷新同一个 CK
 *
 * 设计：单线程事件循环中，has()→set() 之间没有 await，不会发生竞态。
 * Map<ltuid, Promise<newCookie | null>>
 *   - 存在 = 正在刷新中，其他请求应 await 该 Promise
 *   - resolve(newCookie) = 刷新成功，通知等待者用新 cookie 重试
 *   - resolve(null)      = 刷新失败，等待者返回原始错误
 */
const _refreshLocks = new Map()

/**
 * 执行 CK 刷新（实际逻辑，由互斥锁保护）
 * @param {string} ltuid
 * @param {{userId: string, stoken: object}} found
 * @returns {Promise<string|null>} 成功返回完整 cookie，失败返回 null
 */
async function doRefreshCk (ltuid, found) {
  logger.info(
    `${LOG_PREFIX} [CK自动刷新] 检测到ck失效 ltuid:${ltuid}，尝试从stoken刷新...`
  )

  // 调 bbsGetCookie 获取新 cookie_token
  const qrUser = new QrUser({
    user_id: found.userId,
    uid: found.stoken.uid
  })

  let cookies = `uid=${found.stoken.stuid}&stoken=${found.stoken.stoken}`
  if (found.stoken?.mid) cookies += `&mid=${found.stoken.mid}`

  const refreshRes = await qrUser.getData(
    'bbsGetCookie',
    { cookies },
    false // 不重复初始化 cookie
  )

  if (!refreshRes?.data?.cookie_token) {
    logger.warn(
      `${LOG_PREFIX} [CK自动刷新] 刷新失败 ltuid:${ltuid}:`,
      refreshRes?.message || refreshRes?.retcode
    )
    await notifyUser(found.userId, 'sk已失效，请重新扫码登陆')
    return null
  }

  const ck = refreshRes.data.cookie_token
  const fullCookie =
    `ltoken=${found.stoken.ltoken};ltuid=${found.stoken.stuid};` +
    `cookie_token=${ck};account_id=${found.stoken.stuid};`

  // 绑定到 genshin CK 系统
  try {
    const UserCk = (await import('../../genshin/model/user.js')).default
    const fakeE = {
      user_id: found.userId,
      ck: fullCookie,
      reply: () => {} // no-op：bing() 内部会发送多条回复，我们统一用自己的通知
    }
    await new UserCk(fakeE).bing()
    logger.info(`${LOG_PREFIX} [CK自动刷新] 绑定成功 ltuid:${found.stoken.stuid}`)
  } catch (err) {
    logger.error(`${LOG_PREFIX} [CK自动刷新] 绑定失败: ${err.message}`)
    await notifyUser(found.userId, 'sk已失效，请重新扫码登陆')
    return null
  }

  await notifyUser(found.userId, '先前ck已失效，米游社ck自动刷新成功')
  return fullCookie
}

// ==================== 猴子补丁 ====================

/** 保存原始 getData */
const _MysApiGetData = MysApi.prototype.getData

/**
 * 拦截 MysApi.prototype.getData，在 CK 过期时尝试自动刷新
 *
 * 并发语义：
 *   同一 ltuid 的多个并发请求中，只有第一个执行刷新，其余等待其结果。
 *   刷新成功 → 所有等待者用新 cookie 各自重试
 *   刷新失败 → 所有等待者返回原始错误
 */
MysApi.prototype.getData = async function (type, data, cached) {
  const res = await _MysApiGetData.call(this, type, data, cached)

  // 仅拦截 CK 过期（retcode 10001 且 message 含 login）
  if (!res || Number(res.retcode) !== 10001) return res
  if (!/(登录|login)/i.test(res.message)) return res

  // 防止递归：已刷新过一次不再重复
  if (this._ckRefreshing) return res

  // 从当前 cookie 提取 ltuid
  const ltuid =
    getCookieField(this.cookie, 'ltuid') ||
    getCookieField(this.cookie, 'account_id')
  if (!ltuid) return res

  // 查找匹配的 stoken（先查，无匹配则不走锁逻辑）
  const found = await findStokenByLtuid(ltuid)
  if (!found) return res

  // === 并发保护：检查是否已有进行中的刷新 ===
  const existingLock = _refreshLocks.get(ltuid)
  if (existingLock) {
    // 已有其他请求在刷新，等待其结果
    logger.info(
      `${LOG_PREFIX} [CK自动刷新] ltuid:${ltuid} 已有刷新进行中，等待...`
    )
    const newCookie = await existingLock
    if (newCookie) {
      this.cookie = newCookie
      this._ckRefreshing = true
      return await _MysApiGetData.call(this, type, data, cached)
    }
    return res
  }

  // === 无进行中刷新 → 当前请求负责刷新 ===
  let resolveLock
  const lockPromise = new Promise(resolve => { resolveLock = resolve })
  _refreshLocks.set(ltuid, lockPromise)

  try {
    const newCookie = await doRefreshCk(ltuid, found)
    resolveLock(newCookie) // 通知所有等待者

    if (newCookie) {
      // 用新 cookie 重试当前请求
      this._ckRefreshing = true
      this.cookie = newCookie
      return await _MysApiGetData.call(this, type, data, cached)
    }
    return res
  } finally {
    _refreshLocks.delete(ltuid)
  }
}

// ==================== 注册 ====================

export class CkAutoRefresh extends plugin {
  constructor () {
    super({
      name: '[Axiu-Plugin] CK自动刷新',
      dsc: '米游社CK失效时自动从stoken刷新',
      priority: 1
    })
  }
}
