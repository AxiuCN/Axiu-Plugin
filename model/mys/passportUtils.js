/** passport 工具函数 — 从 xiaoyao-cvs-plugin model/mys/utils.js 精简移植 */

import _ from 'lodash'

/**
 * Promise 版 sleep
 * @param {number} sleepms 毫秒
 */
export async function sleepAsync (sleepms) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve()
    }, sleepms)
  })
}

/**
 * 生成随机字符串
 * @param {number} length 长度
 * @param {boolean} os 是否 OS 服（字符集更大）
 */
export function randomString (length, os = false) {
  let randomStr = ''
  for (let i = 0; i < length; i++) {
    randomStr += _.sample(os ? '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
      : 'abcdefghijklmnopqrstuvwxyz0123456789')
  }
  return randomStr
}

/**
 * Cookie 字符串 → Map
 * @param {string} cookie
 * @returns {Map<string, string>}
 */
export async function getCookieMap (cookie) {
  const cookieArray = cookie.replace(/\s*/g, '').split(';')
  const cookieMap = new Map()
  for (const item of cookieArray) {
    const entry = item.replace('=', '~').split('~')
    if (!entry[0]) continue
    cookieMap.set(entry[0], entry[1])
  }
  return cookieMap || {}
}

/**
 * UID → 服务器标识
 * @param {string|number} uid 游戏 UID
 * @returns {string} server 标识
 */
export function getServer (uid) {
  switch (String(uid)[0]) {
    case '1':
    case '2':
      return 'cn_gf01' // 官服
    case '5':
      return 'cn_qd01' // B 服
    case '6':
      return 'os_usa' // 美服
    case '7':
      return 'os_euro' // 欧服
    case '8':
      return 'os_asia' // 亚服
    case '9':
      return 'os_cht' // 港澳台服
  }
  return 'cn_gf01'
}

/**
 * 星铁 UID → 服务器标识（对齐 genshin gachaLog.getServer 星铁分支）
 * @param {string|number} uid 星铁 UID
 * @returns {string} server 标识（prod_*）
 */
export function getSrServer (uid) {
  switch (String(uid).slice(0, -8)) {
    case '1':
    case '2':
      return 'prod_gf_cn' // 官服
    case '5':
      return 'prod_qd_cn' // B 服
    case '6':
      return 'prod_official_usa' // 美服
    case '7':
      return 'prod_official_euro' // 欧服
    case '8':
    case '18':
      return 'prod_official_asia' // 亚服
    case '9':
      return 'prod_official_cht' // 港澳台服
  }
  return 'prod_gf_cn'
}
