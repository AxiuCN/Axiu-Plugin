/**
 * 群成员昵称取值（`components/memberName.js`）
 *
 * 背景：挑战图右上角与群排行展示的是「数据所属的那个人」——`@某人 #危战` 查的是被 @ 的人的
 * UID，昵称也必须取那个人的。旧实现有两处错：
 * ① 图里固定用 `e.sender`（发命令的人），@ 别人时名字对不上；
 * ② 排行用 `member.getInfo?.()`，而 icqq 的 `Member` 根本没有 `getInfo`（只有 `card` 取值器
 *    与 `renew()`），于是昵称恒为空 → 「群排行昵称从未生效」。
 *
 * 这里用假的 member 对象把两条路径都钉住，并保留「旧写法拿不到」的反向断言。
 */
import { checker, importMod } from './_helper.mjs'

const { check, finish } = checker()
const { memberNick, memberName } = await importMod('components/memberName.js')

/** 造一个 icqq 风格的最小 member */
const mkMember = ({ card, info, renew } = {}) => ({
  get card () { return card },
  renew: renew ?? (async () => info)
})

/* ==================== 【1】memberNick：走 card 取值器 ==================== */

console.log('【1】memberNick：优先 card（群名片，缺省群昵称），不依赖不存在的 getInfo')
check('card 直接命中时不发起请求', await memberNick({ get card () { return '阿修' }, renew: async () => { throw new Error('不该调用') } }) === '阿修')
check('card 为空时用 renew() 拉一次资料', await memberNick(mkMember({ card: '', info: { card: '群名片', nickname: '群昵称' } })) === '群名片')
check('资料里 card 为空时回落 nickname', await memberNick(mkMember({ card: '', info: { card: '', nickname: '群昵称' } })) === '群昵称')
check('renew 抛错按无昵称处理（成员已退群）', await memberNick({ get card () { return '' }, renew: async () => { throw new Error('MemberNotExists') } }) === '')
check('member 为空返回空串', await memberNick(null) === '')
// 回归锚：旧实现只认 getInfo，这种对象在 icqq 里就是「取不到」
check('没有 getInfo 的对象也能取到昵称（旧写法永远为空）',
  await memberNick(mkMember({ card: '有名字' })) === '有名字')

/* ==================== 【2】memberName：@ 谁取谁 ==================== */

console.log('\n【2】memberName：@ 别人时取被 @ 的人，不取发命令的人')
const mkEvent = ({ at, sender = { card: '发送者', nickname: 'sender' }, members = {} } = {}) => ({
  at,
  user_id: 10001,
  sender,
  group: {
    pickMember (qq) {
      const hit = members[Number(qq)]
      if (!hit) throw new Error('no such member')
      return hit
    }
  }
})

const ev = mkEvent({
  members: { 20002: mkMember({ card: '被艾特的人' }) }
})
check('@ 别人 → 取被 @ 的人的群名片', await memberName(ev, 20002) === '被艾特的人')

check('没 @（qq 与发送者一致）→ 取发送者名片', await memberName(mkEvent({ members: {} }), 10001) === '发送者')
check('没传 qq → 取发送者名片', await memberName(mkEvent(), undefined) === '发送者')

const evUnknown = mkEvent({ members: {} })
check('被 @ 的人不在群里 → 空串（不退化成发送者名字）', await memberName(evUnknown, 20002) === '')

check('私聊（无 group）且 @ 人 → 空串', await memberName({ at: 20002, user_id: 10001, sender: { card: 'S' } }, 20002) === '')

const evRenew = mkEvent({ members: { 30003: mkMember({ card: '', info: { card: '冷启动名片' } }) } })
check('成员资料未缓存 → renew 后拿到名片', await memberName(evRenew, 30003) === '冷启动名片')

/* ==================== 【3】静态约束：调用方不再用 getInfo ==================== */

console.log('\n【3】静态约束：挑战图与排行都用 memberName / memberNick')
const { readFileSync } = await import('node:fs')
const { mod } = await import('./_helper.mjs')
const gsQuery = readFileSync(mod('modules/challenge/gsQuery.js'), 'utf8')
const gsRank = readFileSync(mod('modules/challenge/gsRank.js'), 'utf8')
check('gsQuery 三处昵称都按 e.at 取', (gsQuery.match(/const nickname = await memberName\(e, e\.at\)/g) || []).length === 3)
check('gsRank 不再出现 member.getInfo', !/member\.getInfo/.test(gsRank) && (gsRank.match(/memberNick\(member\)/g) || []).length === 2)

finish()