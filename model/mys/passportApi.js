/** passport API 客户端 — 从 xiaoyao-cvs-plugin model/mys/mihoyoApi.js 精简移植
 *  仅保留 passport/bbs/auth 端点，删除签到/云游戏/支付/验证码
 */

import md5 from 'md5'
import _ from 'lodash'
import fetch from 'node-fetch'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import YAML from 'yaml'
import * as mys from './passportTool.js'
import * as utils from './passportUtils.js'

const DEVICE_ID = utils.randomString(32).toUpperCase()
const DEVICE_NAME = utils.randomString(_.random(1, 10))
const LIFECYCLE_ID = randomUUID()
/** 扫码建码/轮询用的 x4 盐（DS v2），与登录侧一致 */
const QR_SALT_X4 = 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs'

/** 米游社 App 身份与各链版本号 —— 跟官方版本时只改这里（2026-11-22 实测可用）
 *  qrcode：扫码建码/轮询；stokenCookie：取 ltoken / 换 ck；exchange：换票
 */
const MYSS_APP_ID = 'bll8iq97cem8'
const QR_APP_VERSION = '2.90.1'
const STOKEN_APP_VERSION = '2.104.0'
const EXCHANGE_APP_VERSION = '2.106.2'
const EXCHANGE_PASSPORT_VERSION = '2.44.0'

/** 把 stoken 查询串规范化为 uid/stoken/mid（getLtoken 用）
 *  `;` → `&`，并把缺失的 uid 用 stuid 补齐（新版 xiaoyao 的 normalizeSTokenQuery）
 */
function normalizeSTokenQuery (cookies = '') {
  const params = new URLSearchParams(String(cookies || '').replace(/;/g, '&'))
  if (!params.get('uid') && params.get('stuid')) params.set('uid', params.get('stuid'))
  return params.toString()
}

export default class PassportApi {
  /**
   * @param {object} e 事件对象（需含 cookie、uid 等字段）
   */
  constructor (e) {
    if (e) {
      this.e = e
      this.cookie = e.cookie

      // 从 stoken YAML 构建 this.cookies（authKey/stoken/bbs 接口需要 stoken 格式 cookie）
      try {
        const file = `./plugins/Axiu-Plugin/data/stoken/${String(e.user_id)}.yaml`
        if (fs.existsSync(file) && e?.uid) {
          const ck = YAML.parse(fs.readFileSync(file, 'utf8'))
          let sk = ck?.[e.uid]
          // 按游戏 UID 键未命中时，用 cookie 中的 ltuid（米游社账号ID）关联文件条目：
          // genAuthKey 场景 e.uid 是游戏 UID（如 251094196），而 stoken 文件可能缺失该键，
          // 但同账号其他游戏角色的条目持有相同的 stuid/ltuid 与 stoken（stoken 是账号级凭证）
          if (!sk?.stoken && this.cookie) {
            const ltuid = String(this.cookie).match(/ltuid=(\d+)/)?.[1]
            if (ltuid) {
              sk = Object.values(ck || {}).find(v => String(v?.stuid) === ltuid) || sk
            }
          }
          if (sk?.stuid && sk?.stoken) {
            this.cookies = `stuid=${sk.stuid};stoken=${sk.stoken};ltoken=${sk.ltoken || ''}`
            if (sk?.mid) this.cookies += `;mid=${sk.mid}`
          }
        }
      } catch {}
      if (!this.cookies) this.cookies = e.cookie
      this.userId = String(e.user_id)
      this.isOs = false
      if (this.e?.uid) {
        this.isOs = String(this.e.uid)[0] * 1 > 5
      }
      this.apiMap = {
        apiWeb: mys.web_api,
        saltweb: mys.saltWeb,
        saltSign: mys.salt
      }
      if (this.isOs) {
        this.apiMap = {
          apiWeb: mys.os_web_api,
          saltweb: mys.saltWeb,
          saltSign: mys.salt
        }
      }
    }
  }

  /**
   * 执行 API 请求
   * @param {string} type 端点标识
   * @param {object} data 请求参数
   */
  async getData (type, data = {}) {
    const { url, headers, body } = this.getUrl(type, data)

    if (!url) return false

    if (data.headers) {
      Object.assign(headers, data.headers)
      delete data.headers
    }

    const param = {
      headers,
      // 宿主 fetch 为自实现（undici），timeout 选项会被静默忽略，改用 AbortSignal 超时
      signal: AbortSignal.timeout(10000)
    }

    if (body) {
      param.method = 'post'
      param.body = body
    } else {
      param.method = 'get'
    }

    if (data.method) {
      param.method = data.method
    }

    let response = {}
    try {
      response = await fetch(url, param)
    } catch (error) {
      logger.error(error.toString())
      return false
    }

    if (!response.ok) {
      logger.error(`[passportApi][${type}] ${response.status} ${response.statusText}`)
      return false
    }

    let res = await response.text()
    if (res.startsWith('(')) {
      res = JSON.parse(res.replace(/\(|\)/g, ''))
    } else {
      res = JSON.parse(res)
    }

    if (!res) {
      logger.mark('passportApi 接口没有返回')
      return false
    }

    res.api = type
    return res
  }

  /**
   * 构造请求 URL / headers / body
   * @param {string} type 端点标识
   * @param {object} data 请求参数
   */
  getUrl (type, data = {}) {
    const urlMap = {
      // === 通用查询 ===
      userGameInfo: {
        // 扫码换 stoken 场景 host 固定国服：biz 恒为国服，且 isOs 判定基于 ltuid（米游社账号ID，首位常>5）会误判海外
        url: `${mys.web_api}/binding/api/getUserGameRolesByCookie`,
        query: `game_biz=${data.biz || 'hk4e_cn'}`,
        types: 'sign'
      },

      // === Passport 登录 ===
      qrCodeLogin: {
        url: `${mys.pass_api}/account/ma-cn-passport/app/createQRLogin`,
        body: {},
        types: 'qrcode'
      },
      qrCodeQuery: {
        url: `${mys.pass_api}/account/ma-cn-passport/app/queryQRLoginStatus`,
        body: { ticket: data.ticket },
        types: 'qrcode'
      },
      getTokenByGameToken: {
        url: `${mys.pass_api}/account/ma-cn-session/app/getTokenByGameToken`,
        body: {
          account_id: data.uid * 1,
          game_token: data.token
        },
        types: 'pass'
      },
      exchange: {
        // 换票接口：用 v2 stoken 换 ltoken_v2(2) / cookie_token_v2(4)（老 getCookieAccountInfoBySToken 已废弃 -464）
        url: `${mys.pass_api}/account/ma-cn-session/app/exchange`,
        body: {
          dst_token_type: data.dstTokenType || 2,
          src_token: {
            token: data.token,
            token_type: 1
          },
          mid: data.mid
        },
        types: 'exchange'
      },
      getCookieAccountInfoByGameToken: {
        url: `${mys.web_api}/auth/api/getCookieAccountInfoByGameToken`,
        query: `account_id=${data.uid}&game_token=${data.token}`
      },

      // === BBS / Auth ===
      bbsStoken: {
        url: `${this.apiMap.apiWeb}/auth/api/getMultiTokenByLoginTicket`,
        query: `login_ticket=${data.loginTicket}&token_types=3&uid=${data.loginUid}`,
        types: 'stoken'
      },
      getLtoken: {
        url: `${mys.pass_api}/account/auth/api/getLTokenBySToken`,
        query: normalizeSTokenQuery(data?.cookies),
        types: 'stokenCookie'
      },

      // === AuthKey（抽卡记录用，原神+星铁通用：game_biz 按游戏传，默认原神）===
      authKey: {
        url: `${this.apiMap.apiWeb}/binding/api/genAuthKey`,
        body: {
          auth_appid: data.auth_appid ?? 'webview_gacha',
          game_biz: data.gameBiz ?? (this.isOs ? 'hk4e_global' : 'hk4e_cn'),
          game_uid: (data.uid ?? this.e.uid) * 1,
          region: data.region ?? this.e.region
        },
        types: 'authKey'
      }
    }

    if (!urlMap[type]) return false

    let { url, query = '', body = '', types = '', sign = '' } = urlMap[type]

    if (query) url += `?${query}`
    if (body) body = JSON.stringify(body)

    const headers = this.getHeaders(types, sign, body, query)
    // 扫码接口：把本次扫码的 device 写进请求头，保证 建码/轮询 使用同一个 x-rpc-device_id
    if (types === 'qrcode' && data.device) headers['x-rpc-device_id'] = data.device
    return { url, headers, body }
  }

  /**
   * 构造请求头
   * @param {string} type 端点类型（bbs / sign / stoken / pass / authKey）
   * @param {boolean} sign 是否加签
   * @param {string} body 请求体 JSON
   * @param {string} query 查询字符串
   */
  getHeaders (type = 'bbs', sign, body = {}, query = '') {
    let header = {}

    switch (type) {
      case 'bbs':
        header = {
          Cookie: this.cookies,
          'x-rpc-channel': 'miyousheluodi',
          'x-rpc-auto_test': true,
          'x-rpc-device_id': DEVICE_ID,
          'x-rpc-app_version': mys.APP_VERSION,
          'x-rpc-device_model': 'Mi 10',
          'x-rpc-device_name': DEVICE_NAME,
          'x-rpc-client_type': '2',
          DS: (sign ? this.getDs2('', body, mys.salt2) : this.getDs(mys.salt)),
          Referer: 'https://app.mihoyo.com',
          'x-rpc-sys_version': '12',
          Host: 'bbs-api.mihoyo.com',
          'User-Agent': 'okhttp/4.8.0'
        }
        break

      case 'sign':
        header = {
          'accept-language': 'zh-CN,zh;q=0.9,ja-JP;q=0.8,ja;q=0.7,en-US;q=0.6,en;q=0.5',
          'x-rpc-device_id': DEVICE_ID,
          'User-Agent': `Mozilla/5.0 (iPhone; CPU iPhone OS 14_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) miHoYoBBS/${mys.APP_VERSION}`,
          Referer: 'https://act.mihoyo.com/bbs/event/signin-ys/index.html',
          Host: 'api-takumi.mihoyo.com',
          'x-rpc-channel': 'appstore',
          'x-rpc-app_version': mys.APP_VERSION,
          'x-requested-with': 'com.mihoyo.hyperion',
          'x-rpc-client_type': '5',
          'Content-Type': 'application/json;charset=UTF-8',
          DS: this.getDs(),
          Cookie: this.cookie
        }
        break

      case 'stoken':
        header = {
          'x-rpc-device_id': 'zxcvbnmasadfghjk123456',
          'Content-Type': 'application/json;charset=UTF-8',
          'x-rpc-client_type': '',
          'x-rpc-app_version': '',
          DS: '',
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) miHoYoBBS/%s',
          Referer: 'cors',
          'Accept-Encoding': 'gzip, deflate, br',
          'x-rpc-channel': 'appstore'
        }
        break

      case 'pass':
        header = {
          'x-rpc-device_id': DEVICE_ID,
          'x-rpc-app_id': MYSS_APP_ID,
          'x-rpc-device_name': DEVICE_NAME,
          'x-rpc-device_fp': '38d7ee0e96649',
          'x-rpc-device_model': utils.randomString(16),
          'x-rpc-app_version': mys.APP_VERSION,
          'x-rpc-game_biz': 'bbs_cn',
          'x-rpc-sys_version': '11',
          'x-rpc-aigis': '',
          'Content-Type': 'application/json;',
          'x-rpc-client_type': '2',
          DS: this.getDs2('', body, mys.passSalt),
          'x-rpc-sdk_version': '1.3.1.2',
          'User-Agent': 'okhttp/4.8.0',
          Connection: 'Keep-Alive',
          'Accept-Encoding': 'gzip, deflate, br',
          'x-rpc-channel': 'appstore',
          Cookie: this.cookies || ''
        }
        break

      case 'qrcode':
        // 扫码建码/轮询：必须用米游社 App 身份（app_id=bll8iq97cem8、game_biz=bbs_cn）。
        // 用其它 app_id 建码时，换票虽然能成功，但会话不属于米游社 App，
        // 社区签到等 App 侧接口会判 -100 登录失效（实测）
        header = {
          'User-Agent': `Mozilla/5.0 miHoYoBBS/${QR_APP_VERSION} Capture/2.2.0`,
          Accept: '*/*',
          'Accept-Language': 'zh-cn',
          'Content-Type': 'application/json; charset=UTF-8',
          DS: this.getDs2('', body, QR_SALT_X4),
          'x-rpc-app_id': MYSS_APP_ID,
          'x-rpc-client_type': '3',
          'x-rpc-app_version': QR_APP_VERSION,
          'x-rpc-sdk_version': QR_APP_VERSION,
          'x-rpc-account_version': QR_APP_VERSION,
          'x-rpc-game_biz': 'bbs_cn',
          'x-rpc-device_id': DEVICE_ID
        }
        break

      case 'stokenCookie': {
        // 换 ck / 取 ltoken：伪装 Hyperion 客户端（新版 xiaoyao）
        // Cookie 由 query（uid/stoken/mid）自动构造，stuid 用 uid 回填
        let stokenCookie = query
        try {
          const params = new URLSearchParams(query)
          stokenCookie = [
            params.get('stoken') ? `stoken=${params.get('stoken')}` : '',
            params.get('uid') ? `stuid=${params.get('uid')}` : '',
            params.get('mid') ? `mid=${params.get('mid')}` : ''
          ].filter(Boolean).join(';')
        } catch {
          stokenCookie = String(query || '').replace(/&/g, ';')
        }
        header = {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Hyperion/550 CFNetwork/3860.500.112 Darwin/25.4.0',
          'x-rpc-app_version': STOKEN_APP_VERSION,
          'x-rpc-app_id': MYSS_APP_ID,
          'x-rpc-aigis': '',
          'x-rpc-game_biz': 'bbs_cn',
          'x-rpc-sys_version': '12',
          'x-rpc-device_id': DEVICE_ID,
          'x-rpc-device_fp': utils.randomString(13, true),
          'x-rpc-device_name': DEVICE_NAME,
          'x-rpc-device_model': utils.randomString(16, true),
          'x-rpc-client_type': '2',
          DS: this.getDs2('', '', mys.passSalt),
          Cookie: stokenCookie
        }
        break
      }

      case 'authKey':
        header = {
          'x-rpc-app_version': mys.APP_VERSION,
          'User-Agent': 'okhttp/4.8.0',
          'x-rpc-client_type': '5',
          Referer: 'https://app.mihoyo.com',
          Origin: 'https://webstatic.mihoyo.com',
          Cookie: this.cookies,
          DS: this.getDs(this.isOs ? mys.osSalt : mys.saltWeb),
          'x-rpc-sys_version': '12',
          'x-rpc-channel': 'mihoyo',
          'x-rpc-device_id': DEVICE_ID,
          'x-rpc-device_name': DEVICE_NAME,
          'x-rpc-device_model': 'Mi 10',
          Host: 'api-takumi.mihoyo.com'
        }
        if (this.isOs) {
          Object.assign(header, {
            'x-rpc-app_version': '2.18.1',
            app_version: '2.18.1',
            client_type: '2',
            'x-rpc-client_type': '2',
            Origin: 'https://app.hoyolab.com',
            X_Requested_With: 'com.mihoyo.hoyolab',
            Referer: 'https://app.hoyolab.com',
            Host: 'api-os-takumi.mihoyo.com',
            'x-rpc-channel': 'hoyolab'
          })
        }
        break

      case 'exchange':
        // 换票接口专属头（与实测通过的 MiyoQian 一致）：DS 用 passSalt 对 body 加签
        header = {
          'content-type': 'application/json',
          DS: this.getDs2('', body, mys.passSalt),
          'User-Agent': `Mozilla/5.0 (Linux; Android 12; Unspecified Device) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/103.0.5060.129 Mobile Safari/537.36 miHoYoBBS/${EXCHANGE_APP_VERSION}`,
          'x-rpc-app_version': EXCHANGE_APP_VERSION,
          'x-rpc-client_type': '2',
          'x-rpc-app_id': MYSS_APP_ID,
          'x-rpc-device_id': DEVICE_ID,
          'x-rpc-device_name': 'Mihoyo Capture',
          'x-rpc-device_model': 'Mi 14',
          'x-rpc-game_biz': 'bbs_cn',
          'x-rpc-sdk_version': EXCHANGE_PASSPORT_VERSION,
          'x-rpc-account_version': EXCHANGE_PASSPORT_VERSION,
          'x-rpc-lifecycle_id': LIFECYCLE_ID
        }
        break

      default:
        header = {}
        break
    }

    return header
  }

  /** DS 签名 v1 — md5(salt + t + r) */
  getDs (salt = mys.saltWeb) {
    const randomStr = utils.randomString(6)
    const timestamp = Math.floor(Date.now() / 1000)
    const sign = md5(`salt=${salt}&t=${timestamp}&r=${randomStr}`)
    return `${timestamp},${randomStr},${sign}`
  }

  /** DS 签名 v2 — md5(salt + t + r + b + q) */
  getDs2 (q = '', b, salt) {
    const i = Math.floor(Date.now() / 1000)
    const r = _.random(100001, 200000)
    const add = `&b=${b}&q=${q}`
    const c = md5('salt=' + salt + '&t=' + i + '&r=' + r + add)
    return `${i},${r},${c}`
  }
}
