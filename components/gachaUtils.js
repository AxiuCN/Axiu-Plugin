/** 抽卡记录通用工具 — gsGachaLog / srGachaLog 共用
 *  - 原子频率锁（SET NX EX）
 *  - NoteUser UID 查找
 *  - authkey 获取（原神/星铁通用，gameBiz 参数化）
 */

import QrUser from '../model/qrUser.js'
import { LOG_PREFIX } from './constants.js'

/** 原子占锁（SET NX EX）：任务开始前调用，防并发重复请求 */
export async function tryAcquireGachaLock (lockKey) {
  const lockEx = 5 * 60
  const ok = await redis.set(lockKey, JSON.stringify({ expire: Date.now() / 1000 + lockEx }), {
    EX: lockEx,
    NX: true
  })
  return ok === 'OK'
}

/** 读取锁剩余秒数（容错：旧格式/损坏值返回 0） */
export async function gachaLockRemaining (lockKey) {
  try {
    const lockData = await redis.get(lockKey)
    if (!lockData) return 0
    const expire = JSON.parse(lockData).expire
    if (typeof expire !== 'number') return 0
    return Math.ceil(expire - Date.now() / 1000)
  } catch {
    return 0
  }
}

/** 通过 NoteUser 获取指定游戏的绑定 UID */
export async function getUidFromNoteUser (e, game = 'gs') {
  try {
    const NoteUser = (await import('../../genshin/model/mys/NoteUser.js')).default
    const user = await NoteUser.create(e.user_id || e)
    const uid = game === 'sr' ? user?.getUid?.('sr') : user?.uid
    return uid || null
  } catch {
    return null
  }
}

/**
 * 获取 authkey（优先 stoken→passportApi，降级 Redis 缓存）
 * @param {object} e - 事件对象（含 uid/region）
 * @param {string} gameBiz - 游戏 biz（原神 'hk4e_cn' / 星铁 'hkrpg_cn'）
 * @returns {Promise<string|null>}
 */
export async function getAuthKey (e, gameBiz = 'hk4e_cn') {
  // 方式1：通过 stoken → passportApi（genAuthKey 通用端点，game_biz 参数化）
  try {
    const user = new QrUser(e)
    await user.cookie(e)
    const res = await user.getData('authKey', {
      auth_appid: 'webview_gacha',
      gameBiz,
      uid: e.uid,
      region: e.region
    })
    if (res?.data) {
      return res.data.authkey
    }
  } catch (err) {
    logger?.error(`${LOG_PREFIX}[抽卡] stoken获取authkey失败: ${err.message}`)
  }

  // 方式2：Redis 缓存（之前通过 URL 提交过的）
  if (e.uid) {
    try {
      const GachaLog = (await import('../../genshin/model/gachaLog.js')).default
      const gacha = new GachaLog(e)
      gacha.uid = e.uid
      const cached = await redis.get(`${gacha.urlKey}${gacha.uid}`)
      if (cached) return cached
    } catch {}
  }

  return null
}