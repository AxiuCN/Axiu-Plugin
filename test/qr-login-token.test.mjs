/**
 * 扫码登录的 ltoken 取值（model/qrLogin.js，第四轮 #1）
 *
 * 覆盖：扫码响应的 `tokens[]` 只有 stoken 时**不得**把 stoken 当 ltoken（旧实现里
 * `pickToken` 的「任意非空 token」兜底会返回 stoken 并短路掉 getLtoken 的正确结果）；
 * stoken 侧仍保留兜底；拿不到 ltoken / ltoken 与 stoken 相同 / 缺 cookie_token 三种
 * 失败都不得产出任何凭据。
 */
import { importMod, installFrameworkStubs, checker } from './_helper.mjs'

installFrameworkStubs()

const { default: QrLogin } = await importMod('model/qrLogin.js')
const { check, finish } = checker()

/** 造一个只替换 user.getData 的实例（不调 init()，避免构造真 QrUser） */
const makeQr = (responses = {}) => {
  const replies = []
  const qr = new QrLogin({ user_id: '10001', reply: async (msg) => { replies.push(msg) } })
  qr.user = { getData: async (endpoint, params) => (responses[endpoint] ? responses[endpoint](params) : {}) }
  qr.replies = replies
  return qr
}
const confirmed = ({ tokens = [{ name: 'stoken_v2', token: 'S' }], aid = '123456', mid = 'm1' } = {}) => ({
  data: { status: 'Confirmed', stat: 'Confirmed', tokens, user_info: { aid, uid: 'u', account_id: aid, mid } }
})
const okApi = { getLtoken: () => ({ data: { ltoken: 'L' } }), bbsGetCookie: () => ({ data: { cookie_token: 'CK' } }) }

console.log('=== pickToken：strict 不兜底 / stoken 保留兜底 ===')
{
  const qr = makeQr()
  check('strict：只有 stoken 时具名 ltoken 匹配返回 false（不跨类型兜底）',
    qr.pickToken([{ name: 'stoken', token: 'S' }], ['ltoken', 'ltoken_v2'], false) === false)
  check('具名命中优先', qr.pickToken([{ name: 'stoken', token: 'S' }, { name: 'ltoken_v2', token: 'L' }], ['ltoken', 'ltoken_v2'], false)?.token === 'L')
  check('stoken 侧兜底保留（字段名变了也能取到）',
    qr.pickToken([{ name: 'other', token: 'X' }], ['stoken_v2', 'stoken'])?.token === 'X')
}

console.log('=== _buildLoginResult：ltoken 来源 ===')
{
  const qr = makeQr(okApi)
  const out = await qr._buildLoginResult(confirmed())
  console.log(`  cookie=${out.cookie}`)
  console.log(`  stoken=${out.stoken}`)
  check('tokens 只有 stoken 时，ltoken 取自 getLtoken 接口（不是 stoken）',
    out.ltoken === 'L' && out.cookie.includes('ltoken=L') && !out.cookie.includes('ltoken=S'), JSON.stringify(out))
  check('返回的 stoken 串里 ltoken 同样是接口值',
    out.stoken.includes('ltoken=L') && !out.stoken.includes('ltoken=S'), out.stoken)

  const qr2 = makeQr(okApi)
  const out2 = await qr2._buildLoginResult(confirmed({ tokens: [{ name: 'ltoken', token: 'L-NAME' }, { name: 'stoken', token: 'S' }] }))
  check('具名 ltoken 优先于接口返回值', out2.ltoken === 'L-NAME', String(out2.ltoken))

  const qr3 = makeQr(okApi)
  const out3 = await qr3._buildLoginResult(confirmed({ tokens: [{ name: 'ltoken_v2', token: 'L-V2' }, { name: 'stoken', token: 'S' }] }))
  check('ltoken_v2 也算具名命中', out3.ltoken === 'L-V2', String(out3.ltoken))
}

console.log('=== _buildLoginResult：失败路径不得产出凭据 ===')
{
  const qr = makeQr({ getLtoken: () => ({ data: {} }), bbsGetCookie: () => ({ data: { cookie_token: 'CK' } }) })
  const out = await qr._buildLoginResult(confirmed())
  check('两处都拿不到 ltoken → 返回错误且无 cookie/stoken',
    !!out.error && !out.cookie && !out.stoken, JSON.stringify(out))

  // 伪造：具名 ltoken 的值就是 stoken（第 3 层防御）
  const qr2 = makeQr({ getLtoken: () => ({ data: { ltoken: 'S' } }), bbsGetCookie: () => ({ data: { cookie_token: 'CK' } }) })
  const out2 = await qr2._buildLoginResult(confirmed({ tokens: [{ name: 'ltoken', token: 'S' }, { name: 'stoken', token: 'S' }] }))
  check('ltoken 与 stoken 相同 → 判为未取到，错误文案点明',
    !!out2.error && !out2.cookie && /与 stoken 相同/.test(out2.error), JSON.stringify(out2))

  // 接口把 stoken 当 ltoken 返回（同一条防御）
  const qr3 = makeQr({ getLtoken: () => ({ data: { ltoken: 'S' } }), bbsGetCookie: () => ({ data: { cookie_token: 'CK' } }) })
  const out3 = await qr3._buildLoginResult(confirmed())
  check('接口返回的 ltoken 等于 stoken → 同样判为未取到',
    !!out3.error && !out3.cookie && /与 stoken 相同/.test(out3.error), JSON.stringify(out3))

  const qr4 = makeQr({ getLtoken: () => ({ data: { ltoken: 'L' } }), bbsGetCookie: () => ({ message: '登录失效' }) })
  const out4 = await qr4._buildLoginResult(confirmed())
  check('缺 cookie_token → 返回错误并保留 ck 的 message',
    !out4.cookie && /登录失效/.test(out4.error || ''), JSON.stringify(out4))

  const out5 = await makeQr(okApi)._buildLoginResult(confirmed({ tokens: [] }))
  check('缺 stoken → 返回错误且无凭据', !!out5.error && !out5.cookie, JSON.stringify(out5))
}

finish()
