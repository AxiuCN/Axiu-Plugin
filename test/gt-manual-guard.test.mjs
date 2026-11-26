/**
 * 手动过码 HTTP 接口的入参守卫（`model/GT-Manual/GT-Manual.js`）
 *
 * 回归的是「普通对象当 map」引出的两个真问题（CodeQL 报的是 reflected-xss，根因在这里）：
 * - `isRegister[key]` / `tmp[key]` / `result[key]` 用 `{}` 时，`constructor`、`__proto__`
 *   这些原型链上的名字一律被判为真值，守卫形同虚设；`GET /GTest/register/constructor`
 *   会把 `Object` 构造函数喂给 `res.send` 而抛错。
 * - `POST /GTest/validate/__proto__` 能改掉 `result` 的原型，之后任意 key 的
 *   `get_validate` 都会取到同一份伪造结果。
 *
 * 现在三处 map 换成无原型对象，四个路由再各自过 `KEY_RE`（6 位字母，与 register 的
 * key 生成规则对齐）。套件直接调 handler，不监听端口、不联网。
 */
import { checker, importMod, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
const { default: GT_Manual } = await importMod('model/GT-Manual/GT-Manual.js')
const { check, finish } = checker()

/** 最小 res 替身：记录 send 的内容 */
const mkRes = () => {
  const out = { sent: undefined, finished: false }
  out.send = (v) => { out.sent = v; return out }
  out.status = () => out
  out.end = () => out
  return out
}
/** next 替身：记录被拒时的消息（有值即表示进了错误分支） */
const mkNext = () => { const calls = []; return { calls, fn: (m) => calls.push(m) } }

const gt = new GT_Manual()

console.log('=== 原型链名字必须被挡在门外 ===')
for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
  const res = mkRes()
  const nx = mkNext()
  gt.index({ params: { key: bad } }, res, nx.fn)
  check(`index 拒绝 ${bad}（不进 res.send）`, nx.calls.length === 1 && res.sent === undefined, String(res.sent))

  const res2 = mkRes()
  const nx2 = mkNext()
  gt.get_register({ params: { key: bad } }, res2, nx2.fn)
  check(`get_register 拒绝 ${bad}`, nx2.calls.length === 1 && res2.sent === undefined, String(res2.sent))

  const res3 = mkRes()
  const nx3 = mkNext()
  gt.get_validate({ params: { key: bad } }, res3, nx3.fn)
  check(`get_validate 拒绝 ${bad}`, nx3.calls.length === 1, String(res3.sent))
}

console.log('\n=== validate 不能改掉 result 的原型 ===')
{
  const res = mkRes()
  const nx = mkNext()
  gt.validate({ params: { key: '__proto__' }, body: { validate: 'FORGED' } }, res, nx.fn)
  check('validate 拒绝 __proto__', nx.calls.length === 1, String(res.sent))

  // 真正的伪造形态：把目标 key 直接写进 body，冒充 result 的原型成员
  const resForged = mkRes()
  const nxForged = mkNext()
  gt.validate({ params: { key: '__proto__' }, body: { ABCDEF: { validate: 'FORGED' } } }, resForged, nxForged.fn)
  check('validate 拒绝带 key 名的 __proto__ 载荷', nxForged.calls.length === 1, String(resForged.sent))

  const probe = mkRes()
  gt.get_validate({ params: { key: 'ABCDEF' } }, probe, () => {})
  check('未注册的 key 取不到伪造结果', probe.sent?.data === null, JSON.stringify(probe.sent))
}

console.log('\n=== 正常流程不被误伤 ===')
{
  const resReg = mkRes()
  gt.register({ body: { gt: 'G', challenge: 'C' } }, resReg, () => {})
  const link = resReg.sent?.data?.link || ''
  const key = (link.match(/\/GTest\/([A-Za-z]+)$/) || [])[1]
  check('register 返回 6 位字母 key', /^[A-Za-z]{6}$/.test(key || ''), String(link))

  const resIdx = mkRes()
  gt.index({ params: { key } }, resIdx, () => {})
  check('合法 key 正常渲染页面', typeof resIdx.sent === 'string' && resIdx.sent.includes(`key="${key}"`), String(resIdx.sent).slice(0, 60))

  const resG = mkRes()
  gt.get_register({ params: { key } }, resG, () => {})
  check('合法 key 取回 gt/challenge', resG.sent?.gt === 'G' && resG.sent?.challenge === 'C', JSON.stringify(resG.sent))

  const resG2 = mkRes()
  const nxG2 = mkNext()
  gt.get_register({ params: { key } }, resG2, nxG2.fn)
  check('一次性：再取被拒', nxG2.calls.length === 1 && resG2.sent === undefined, JSON.stringify(resG2.sent))

  const resV = mkRes()
  gt.validate({ params: { key }, body: { validate: 'V' } }, resV, () => {})
  const resGV = mkRes()
  gt.get_validate({ params: { key } }, resGV, () => {})
  check('validate 正常写入并可读回', resGV.sent?.data?.validate === 'V', JSON.stringify(resGV.sent))

  const resIdx2 = mkRes()
  const nxIdx2 = mkNext()
  gt.index({ params: { key } }, resIdx2, nxIdx2.fn)
  check('validate 之后该 key 不再可进入页面', nxIdx2.calls.length === 1, String(resIdx2.sent))
}

console.log('\n=== 非 6 位字母的 key 一律拒绝（长度/字符越界） ===')
for (const bad of ['', 'ABC', 'ABCDEFG', 'ABC1EF', 'ABC-EF', '../etc']) {
  const res = mkRes()
  const nx = mkNext()
  gt.index({ params: { key: bad } }, res, nx.fn)
  check(`index 拒绝 ${JSON.stringify(bad)}`, nx.calls.length === 1 && res.sent === undefined)
}

finish()