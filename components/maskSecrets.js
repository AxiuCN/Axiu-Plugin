/** 日志脱敏工具
 *  - maskSecrets：递归替换对象中的敏感字段值（Cookie/stoken/token/口令等）
 *  - maskUrl：脱敏 URL 查询串中的敏感参数（stoken/login_ticket/game_token/authkey 等）
 *  用于日志输出前过滤，防止高权限凭据写入日志
 */

const SECRET_KEY_RE = /(cookie|stoken|ltoken|token|password|authorization|secret|login_ticket|game_token)|(api[_-]?key)/i

/** URL 查询串中需要脱敏的参数名（凭据/临时票据类） */
const SECRET_URL_PARAMS = [
  'stoken', 'ltoken', 'cookie_token', 'login_ticket', 'game_token', 'authkey', 'stuid'
]

/**
 * 递归脱敏对象中所有敏感字段值
 * @param {*} value - 任意值（对象/数组/字符串/数字）
 * @returns {*} 脱敏后的副本，无敏感字段泄露
 */
export function maskSecrets (value) {
  if (Array.isArray(value)) {
    return value.map(v => maskSecrets(v))
  }
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY_RE.test(k) ? '[MASKED]' : maskSecrets(v)
    }
    return out
  }
  return value
}

/**
 * 脱敏 URL 字符串中的敏感查询参数
 * @param {string} url - 完整 URL（可能含 ?stoken=xxx&...）
 * @returns {string} 敏感参数值已替换为 [MASKED] 的 URL
 */
export function maskUrl (url) {
  if (typeof url !== 'string' || !url.includes('?')) return url
  try {
    const u = new URL(url)
    for (const p of SECRET_URL_PARAMS) {
      if (u.searchParams.has(p)) u.searchParams.set(p, '[MASKED]')
    }
    return u.toString()
  } catch {
    // URL 解析失败时保守处理：所有查询值脱敏
    return url.replace(/=([^&]*)/g, '=[MASKED]')
  }
}