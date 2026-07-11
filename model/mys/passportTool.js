/** passport API 常量 — 从 xiaoyao-cvs-plugin model/mys/mysTool.js 精简移植 */

export const APP_VERSION = '2.70.1'
export const mhyVersion = '2.11.1'
export const salt = 'S9Hrn38d2b55PamfIR9BNA3Tx9sQTOem' // k2
export const salt2 = 'LyD1rXqMv2GJhnwdvCBjFOKGiKuLY3aO' // x6
export const saltWeb = 'sjdNFJB7XxyDWGIAk0eTV8AOCfMJmyEo' // lk2
export const oldsalt = 'z8DRIUjNDT7IT5IZXvrUAxyupA1peND9'
export const passSalt = 'JwYDpKvLj6MrMqqYU6jTKF17KNO2PXoS'
export const osSalt = '' // OS 服盐值（暂未使用）
export const osSaltWeb = '' // OS 浏览帖子盐值

// API Base URL
export const web_api = 'https://api-takumi.mihoyo.com'
export const os_web_api = 'https://api-os-takumi.mihoyo.com'
export const os_hk4_api = 'https://hk4e-api-os.hoyoverse.com'
export const hk4_api = 'https://hk4e-api.mihoyo.com'
export const hk4_sdk = 'https://hk4e-sdk.mihoyo.com'
export const bbs_api = 'https://bbs-api.mihoyo.com'
export const pass_api = 'https://passport-api.mihoyo.com'

export const app_id = 2

/** RSA 公钥 — 用于密码登录加密（暂未使用，保留供后续扩展） */
export const publicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDDvekdPMHN3AYhm/vktJT+YJr7cI5DcsNKqdsx5DZX0gDuWFuIjzdwButrIYPNmRJ1G8ybDIF7oDW2eEpm5sMbL9zs
9ExXCdvqrn51qELbqj0XxtMTIpaCHFSI50PfPpTFV9Xt/hmyVwokoOXFlAEgCn+Q
CgGs52bFoYMtyi+xEQIDAQAB
-----END PUBLIC KEY-----`
