/** 米游社 v2 cookie 组装
 *
 *  扫码登录、#刷新ck、签到刷新、星铁 CK 刷新四条链的凭据格式必须一致：
 *  全 v2 字段（`*_v2`）+ 同值的旧名字段（`ltuid` / `account_id` / `ltoken` / `cookie_token`）。
 *  米游社侧只认 v2，插件内部与 genshin 侧仍按旧名解析，所以两者都要写。
 */

/**
 * 拼米游社 v2 cookie
 * @param {{stuid: string|number, mid?: string, ltoken: string, cookieToken: string}} p
 *   stuid - 米游社账号 id（ltuid / account_id 同值）
 *   mid - 账号 mid；老条目可能没有，为空时 `*_mid_v2` / `mid` 字段整体省略
 *   ltoken / cookieToken - exchange 换票（dst=2 / dst=4）得到的凭据
 * @returns {string} 以 `;` 结尾的 cookie 串
 */
export function buildV2Cookie ({ stuid, mid = '', ltoken, cookieToken }) {
  return [
    `account_id_v2=${stuid}`,
    mid ? `account_mid_v2=${mid}` : '',
    `cookie_token_v2=${cookieToken}`,
    mid ? `ltmid_v2=${mid}` : '',
    `ltoken_v2=${ltoken}`,
    `ltuid_v2=${stuid}`,
    `account_id=${stuid}`,
    `ltuid=${stuid}`,
    mid ? `mid=${mid}` : '',
    `ltoken=${ltoken}`,
    `cookie_token=${cookieToken}`
  ].filter(Boolean).join(';') + ';'
}