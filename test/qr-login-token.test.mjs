/**
 * 扫码登录的换票口径（model/qrLogin.js）
 *
 * 老 getLTokenBySToken / getCookieAccountInfoBySToken 已废弃（-464「请使用最新版本产品/链接」），
 * 改为 exchange 换票：dst_token_type=2 → ltoken_v2，dst_token_type=4 → cookie_token_v2。
 *
 * 覆盖：pickToken 不跨类型兜底；非 v2_ stoken 直接报错；任一票换不到都不得产出凭据。
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
const confirmed = ({ tokens = [{ name: 'stoken_v2', token: 'v2_S' }], aid = '123456', mid = 'm1' } = {}) => ({
  data: { status: 'Confirmed', stat: 'Confirmed', tokens, user_info: { aid, uid: 'u', account_id: aid, mid } }
})
/** exchange 桩：dst=2 给 ltoken，dst=4 给 cookie_token */
const okExchange = (ltoken = 'L', cookieToken = 'CK') => ({
  exchange: (params) => (params.dstTokenType === 2
    ? { data: { token: { token: ltoken } } }
    : { data: { token: { token: cookieToken } } })
})

console.log('=== pickToken：strict 不兜底 / stoken 保留兜底 ===')
{
  const qr = makeQr()
  check('strict：只有 stoken 时具名 ltoken 匹配返回 false（不跨类型兜底）',
    qr.pickToken([{ name: 'stoken', token: 'S' }], ['ltoken', 'ltoken_v2'], false) === false)
  check('具名命中优先', qr.pickToken([{ name: 'stoken', token: 'S' }, { name: 'ltoken_v2', token: 'L' }], ['ltoken', 'ltoken_v2'], false)?.token === 'L')
  check('stoken 侧兜底保留（字段名变了也能取到）',
    qr.pickToken([{ name: 'other', token: 'X' }], ['stoken_v2', 'stoken'])?.token === 'X')
}

console.log('=== _buildLoginResult：exchange 换票 ===')
{
  const qr = makeQr(okExchange())
  const out = await qr._buildLoginResult(confirmed())
  console.log(`  cookie=${out.cookie}`)
  console.log(`  stoken=${out.stoken}`)
  check('dst=2 换到 ltoken_v2，dst=4 换到 cookie_token_v2',
    out.ltoken === 'L' && out.cookie.includes('ltoken_v2=L') && out.cookie.includes('cookie_token_v2=CK'),
    JSON.stringify(out))
  check('cookie 带兼容旧别名（ltuid/account_id）',
    out.cookie.includes('ltuid=123456') && out.cookie.includes('account_id=123456'), out.cookie)
  check('返回的 stoken 串里 ltoken 是换票值',
    out.stoken.includes('ltoken=L') && out.stoken.includes('stoken=v2_S'), out.stoken)
}

console.log('=== _buildLoginResult：失败路径不得产出凭据 ===')
{
  const qr = makeQr(okExchange())
  const out = await qr._buildLoginResult(confirmed({ tokens: [{ name: 'stoken', token: 'S' }] }))
  check('非 v2_ stoken → 直接报错且无 cookie/stoken',
    !!out.error && /不是 v2_ 格式/.test(out.error) && !out.cookie && !out.stoken, JSON.stringify(out))

  const qr2 = makeQr(okExchange('', 'CK'))
  const out2 = await qr2._buildLoginResult(confirmed())
  check('换不到 ltoken_v2 → 返回错误且无凭据',
    !!out2.error && !out2.cookie && !out2.stoken, JSON.stringify(out2))

  const qr3 = makeQr({ exchange: (params) => (params.dstTokenType === 2 ? { data: { token: { token: 'L' } } } : { message: '登录失效' }) })
  const out3 = await qr3._buildLoginResult(confirmed())
  check('换不到 cookie_token_v2 → 返回错误并保留 message',
    !out3.cookie && /登录失效/.test(out3.error || ''), JSON.stringify(out3))

  const out4 = await makeQr(okExchange())._buildLoginResult(confirmed({ tokens: [] }))
  check('缺 stoken → 返回错误且无凭据', !!out4.error && !out4.cookie, JSON.stringify(out4))
}

finish()
