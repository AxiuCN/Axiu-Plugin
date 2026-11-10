/**
 * 星铁抽卡取凭据的口径（`model/qrUser.js` + `apps/srGachaLog.js`）
 *
 * 回归的是这条事故链：`QrUser.getCookie` 曾写死 `getUid('gs')` 并把结果反写回 `e.uid`，
 * 星铁命令走回退时会
 *   ① 把已解析好的星铁 UID 覆盖成原神 UID（region 还是按星铁算的）；
 *   ② 星铁没有 CK 时拿原神 CK 跑完并回复「更新完成」——用错账号还报成功。
 *
 * 覆盖口径：
 * - `getCookie(e)` 默认仍是原神（保持既有行为），`getCookie(e,'sr')` 取星铁且**不覆盖**调用方 uid
 * - 星铁无 CK 时返回空，不回落到原神 CK / 原神注册 UID
 * - `getCookieForUid(e, uid, game)` 按目标 UID 的 ltuid 取同账号 CK，查不到返回 null
 * - 入口级：无 stoken + 星铁无 CK → 拒绝且不触达下游取数；有 CK → 下游拿到目标 UID 与由其生成的 region
 *
 * 不联网：genshin 运行时对象、stoken 文件与抽卡服务都用内存替身。
 */
import fs from 'node:fs'
import path from 'node:path'
import { checker, importMod, installFrameworkStubs, pluginRoot } from './_helper.mjs'

const store = installFrameworkStubs()

const { default: QrUser } = await importMod('model/qrUser.js')
const { check, finish } = checker()

/* ---------------- 替身 ---------------- */

/**
 * 造 genshin 运行时用户（NoteUser 的子集）
 * @param {{gs?: string, sr?: string, gsCk?: string, srCk?: string, uids?: object}} opt
 */
const mkUser = ({ gs = '', sr = '', gsCk = '', srCk = '', uids = {} } = {}) => {
  const ckByGame = { gs: gsCk, sr: srCk }
  const uidByGame = { gs, sr }
  return {
    getUid: (game = 'gs') => uidByGame[game] || '',
    getMysUser: (game = 'gs') => (ckByGame[game] ? { ck: ckByGame[game] } : false),
    getUidData: (uid, game = 'gs') => uids[`${game}:${uid}`] || {},
    mysUsers: {
      '20001': { ck: 'SYNTHETIC_SR_CK' },
      '20002': { ck: 'SYNTHETIC_OTHER_CK' }
    }
  }
}

/** 造一个最小事件（QrUser 只读 e.user / e.runtime / e.user_id） */
const mkEvent = (user, extra = {}) => ({ user_id: '10001', user, ...extra })

/* ==================== 【1】getCookie 按游戏取 ==================== */

console.log('【1】getCookie：原神口径保持、星铁口径不串')
{
  const e = mkEvent(mkUser({ gs: '100000001', sr: '200000002', gsCk: 'GS_CK', srCk: 'SR_CK' }))
  const out = await QrUser.prototype.getCookie.call({ e }, e)
  check('默认（原神）取原神 UID 与 CK', out.uid === '100000001' && out.cookie === 'GS_CK')
  check('原神口径保持原有的 e.uid 回写（#删除stoken 等旧调用依赖）', e.uid === '100000001')
  check('e.cookie 同步写入（PassportApi 从 e.cookie 取凭据）', e.cookie === 'GS_CK')
}
{
  const e = mkEvent(mkUser({ gs: '100000001', sr: '200000002', gsCk: 'GS_CK', srCk: 'SR_CK' }), { uid: '200000002' })
  const out = await QrUser.prototype.getCookie.call({ e }, e, 'sr')
  check('星铁口径取星铁 UID 与 CK', out.uid === '200000002' && out.cookie === 'SR_CK')
  check('星铁口径不覆盖调用方已设的 e.uid', e.uid === '200000002')
}

console.log('\n【2】星铁没有 CK 时不借用原神凭据')
{
  const e = mkEvent(mkUser({ gs: '100000001', sr: '200000002', gsCk: 'GS_CK', srCk: '' }), { uid: '200000002' })
  e.runtime = { user: { _regUid: '100000001' } }
  const out = await QrUser.prototype.getCookie.call({ e }, e, 'sr')
  check('星铁无 CK 时 CK 为空（修复前会拿到原神 CK）', !out.cookie)
  check('星铁无 CK 时不回落到原神注册 UID', out.uid === '200000002' && e.uid === '200000002')
}
{
  // 关键区分用例：星铁连 UID 都没有时，不能拿原神注册 UID / 原神 CK 顶替
  const e = mkEvent(mkUser({ gs: '100000001', sr: '', gsCk: 'GS_CK', srCk: '' }), { uid: '500000003' })
  e.runtime = { user: { _regUid: '100000001' } }
  const out = await QrUser.prototype.getCookie.call({ e }, e, 'sr')
  check('星铁无 UID 时不借用原神注册 UID', out.uid === '' && !out.cookie, `uid=${out.uid} ck=${out.cookie}`)
  check('星铁无 UID 时不改动调用方的目标 uid', e.uid === '500000003', String(e.uid))
}
{
  // 关键区分用例：账号的星铁 UID 与调用方目标不同，星铁口径不得反写覆盖目标
  const e = mkEvent(mkUser({ gs: '100000001', sr: '200000002', gsCk: 'GS_CK', srCk: 'SR_CK' }), { uid: '500000003' })
  const out = await QrUser.prototype.getCookie.call({ e }, e, 'sr')
  check('星铁口径取的是账号自身的星铁 UID', out.uid === '200000002' && out.cookie === 'SR_CK')
  check('但绝不覆盖调用方的目标 uid（修复前会被改成账号 UID）', e.uid === '500000003', String(e.uid))
}
{
  // 完全没有 getMysUser/getUid 的旧运行时：只有 mysUser 属性
  const e = mkEvent({ getUid: () => '100000001', mysUser: { ck: 'GS_MYSUSER_CK' } })
  const out = await QrUser.prototype.getCookie.call({ e }, e)
  check('旧运行时仅提供 mysUser 属性时沿用（原神）', out.cookie === 'GS_MYSUSER_CK' && out.uid === '100000001')
}

/* ==================== 【3】getCookieForUid 按目标 UID 定位账号 ==================== */

console.log('\n【3】getCookieForUid：按目标 UID 的 ltuid 取同账号 CK')
{
  const user = mkUser({ uids: { 'sr:200000002': { ltuid: '20001' }, 'sr:500000003': { ltuid: '20002' } } })
  const e = mkEvent(user)
  const hit = await QrUser.prototype.getCookieForUid.call({ e }, e, '200000002', 'sr')
  check('目标 UID 命中时取该账号 CK', hit?.uid === '200000002' && hit?.cookie === 'SYNTHETIC_SR_CK')
  const other = await QrUser.prototype.getCookieForUid.call({ e }, e, '500000003', 'sr')
  check('不同 UID 取到各自账号的 CK（不串号）', other?.cookie === 'SYNTHETIC_OTHER_CK')
  const miss = await QrUser.prototype.getCookieForUid.call({ e }, e, '999999999', 'sr')
  check('目标 UID 不在用户名下时返回 null（绝不顶替）', miss === null)
  check('uid 为空时直接返回 null', await QrUser.prototype.getCookieForUid.call({ e }, e, '', 'sr') === null)
  const noApi = await QrUser.prototype.getCookieForUid.call({ e }, mkEvent({}), '200000002', 'sr')
  check('运行时没有 getUidData 时返回 null 而不是抛错', noApi === null)
}

/* ==================== 【4】入口级：绝不静默用错账号 ==================== */

console.log('\n【4】*更新星铁抽卡记录：无凭据则拒绝，有凭据则按目标 UID 取数')
const { srGachaLog: SrApp } = await importMod('apps/srGachaLog.js')

/** stoken 目录指向空临时目录，保证走「无 stoken」分支 */
const stokenDir = path.join(pluginRoot, 'data', 'stoken')
const stokenBackup = fs.existsSync(stokenDir) ? path.join(pluginRoot, 'test', '.test-tmp', 'stoken-bak') : null
if (stokenBackup) {
  fs.rmSync(stokenBackup, { recursive: true, force: true })
  fs.cpSync(stokenDir, stokenBackup, { recursive: true })
  fs.rmSync(stokenDir, { recursive: true, force: true })
}

/** 拦截抽卡服务，记录是否被调用 */
const { StarRailGachaService } = await importMod('model/srGacha.js')
const rawUpdate = StarRailGachaService.prototype.updateByCookie
let serviceCalls = []
StarRailGachaService.prototype.updateByCookie = async function (args) {
  serviceCalls.push(args)
  return { pools: [{ name: '群星跃迁', total: 0, totalDraws: 0, pity: 0, kept: false, merged: false }], added: 0 }
}

const mkApp = () => new SrApp()
const run = async (e) => {
  serviceCalls = []
  const replies = []
  e.reply = async (m) => { replies.push(String(m)) }
  await mkApp().srGachaLog(e)
  return { replies, calls: serviceCalls }
}

// 4.1 星铁无 CK、原神有 CK → 拒绝
{
  const e = mkEvent(mkUser({ gs: '100000001', sr: '200000002', gsCk: 'GS_CK', srCk: '' }), { msg: '*更新星铁抽卡记录', uid: '200000002' })
  const { replies, calls } = await run(e)
  check('星铁无 CK 时拒绝执行（不回退原神 CK）', calls.length === 0, JSON.stringify(calls))
  check('提示带上目标 UID 与行动项', /未获取到星铁 UID 200000002 的账号 cookie/.test(replies[0] || ''), replies[0])
  check('不再出现修复前的「更新完成（暂无新抽卡数据）」', !replies.some(r => /更新完成/.test(r)), replies.join(' | '))
}

// 4.2 星铁有 CK、显式目标 UID → 用目标 UID 与目标 region
{
  const user = mkUser({
    gs: '100000001',
    sr: '200000002',
    gsCk: 'GS_CK',
    srCk: 'SR_CK',
    uids: { 'sr:200000002': { ltuid: '20001' } }
  })
  const e = mkEvent(user, { msg: '*更新星铁抽卡记录', uid: '200000002' })
  const { calls } = await run(e)
  check('有 CK 时正常进入取数', calls.length === 1, JSON.stringify(calls))
  check('下游拿到的是星铁 UID', calls[0]?.uid === '200000002', String(calls[0]?.uid))
  check('下游拿到星铁 CK 而不是原神 CK', calls[0]?.cookie === 'SYNTHETIC_SR_CK', String(calls[0]?.cookie))
  check('region 由最终 UID 生成（官服）', calls[0]?.region === 'prod_gf_cn', String(calls[0]?.region))
}

// 4.3 消息里显式带另一个星铁 UID → 按该 UID 取同账号 CK，uid/region 都跟着它
{
  const user = mkUser({
    gs: '100000001',
    sr: '200000002',
    gsCk: 'GS_CK',
    srCk: 'SR_CK',
    uids: { 'sr:200000002': { ltuid: '20001' }, 'sr:500000003': { ltuid: '20002' } }
  })
  const e = mkEvent(user, { msg: '*更新星铁抽卡记录 500000003' })
  const { calls } = await run(e)
  check('显式目标 UID 被采用（修复前会被覆盖成当前账号 UID）', calls[0]?.uid === '500000003', String(calls[0]?.uid))
  check('显式目标 UID 取到它自己账号的 CK', calls[0]?.cookie === 'SYNTHETIC_OTHER_CK', String(calls[0]?.cookie))
  // 5 开头是 B 服：region 必须跟着目标 UID 变，不能沿用上一个 UID 的官服区域
  check('region 跟着目标 UID 变成 B 服（不是官服）', calls[0]?.region === 'prod_qd_cn', String(calls[0]?.region))
}

// 4.4 显式目标 UID 不属于任何已绑定账号 → 拒绝
{
  const user = mkUser({
    gs: '100000001',
    sr: '200000002',
    gsCk: 'GS_CK',
    srCk: 'SR_CK',
    uids: { 'sr:200000002': { ltuid: '20001' } }
  })
  const e = mkEvent(user, { msg: '*更新星铁抽卡记录 500000003' })
  const { calls, replies } = await run(e)
  check('目标 UID 未绑定时拒绝（不借用当前账号 CK）', calls.length === 0, JSON.stringify(calls))
  check('拒绝提示指出具体 UID', /未获取到星铁 UID 500000003 的账号 cookie/.test(replies[0] || ''), replies[0])
}

/* ---------------- 还原 ---------------- */
StarRailGachaService.prototype.updateByCookie = rawUpdate
if (stokenBackup && fs.existsSync(stokenBackup)) {
  fs.rmSync(stokenDir, { recursive: true, force: true })
  fs.cpSync(stokenBackup, stokenDir, { recursive: true })
  fs.rmSync(stokenBackup, { recursive: true, force: true })
}

finish()