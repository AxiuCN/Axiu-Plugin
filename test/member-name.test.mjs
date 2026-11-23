/**
 * 群成员昵称取值（`components/memberName.js`）
 *
 * 背景：挑战图右上角与群排行展示的是「数据所属的那个人」——`@某人 #危战` 查的是被 @ 的人的
 * UID，昵称也必须取那个人的。这条链路上踩过两个坑：
 *
 * ① 取的是发命令的人（`e.sender`），@ 别人时名字对不上 → 现在按 `e.at` 取。
 * ② 取资料的对象形状按错协议端写：
 *    - **OneBot v11（本项目在用）**：`pickMember(qq)` 是「缓存字段 + `getInfo()`」的普通对象，
 *      **没有 `info` / `renew`**；缓存未命中时 `card` / `nickname` 都是空的。
 *    - **icqq**：有 `info` 取值器与 `renew()`，但缓存未命中时 `info` 返回 undefined。
 *    只认其中一种就会静默退化成 QQ 号 / 空昵称。
 *
 * 这里把两种形状都钉住：OneBot 走 `getInfo()`，icqq 走 `info` / `renew()`。
 */
import { checker, importMod } from './_helper.mjs'

const { check, finish } = checker()
const { memberInfo, memberNick, memberName } = await importMod('components/memberName.js')

/** OneBot v11 形状：缓存字段 + getInfo() */
const mkOneBotMember = ({ card = '', nickname = '', info = null, throws = false } = {}) => ({
  user_id: 20002,
  card,
  nickname,
  getInfo: async () => {
    if (throws) throw new Error('get_group_member_info failed')
    return info
  }
})

/** icqq 形状：info 取值器 + renew()（没有 getInfo） */
const mkIcqqMember = ({ card, info, renew } = {}) => ({
  get card () { return card },
  info,
  renew: renew ?? (async () => info)
})

/* ==================== 【1】OneBot v11：缓存 → getInfo() ==================== */

console.log('【1】OneBot v11：缓存命中直接用，未命中走 getInfo()')
{
  let called = false
  const member = { user_id: 1, card: '群名片', nickname: '群昵称', getInfo: async () => { called = true; return null } }
  check('缓存命中时用 card、不发起 getInfo', await memberNick(member) === '群名片' && !called)
}
check('缓存只有 nickname 时用 nickname', await memberNick(mkOneBotMember({ nickname: '群昵称' })) === '群昵称')
check('缓存为空时走 getInfo()（旧实现按 icqq 写，这里永远取不到）',
  await memberNick(mkOneBotMember({ info: { card: '拉取名片', nickname: '拉取昵称' } })) === '拉取名片')
check('getInfo 里 card 为空时回落 nickname',
  await memberNick(mkOneBotMember({ info: { card: '', nickname: '拉取昵称' } })) === '拉取昵称')
check('getInfo 抛错（成员已退群）返回空串', await memberNick(mkOneBotMember({ throws: true })) === '')

/* ==================== 【2】icqq：info / renew ==================== */

console.log('\n【2】icqq 形状：info 取值器为空时 renew 一次')
check('icqq 的 info 直接命中', await memberNick(mkIcqqMember({ info: { card: '名片', nickname: '昵称' } })) === '名片')
check('renew() 拿到资料', await memberNick(mkIcqqMember({ card: '', info: null, renew: async () => ({ card: '', nickname: 'renew 昵称' }) })) === 'renew 昵称')
check('renew 抛错按无昵称处理', await memberNick({ get card () { return '' }, renew: async () => { throw new Error('MemberNotExists') } }) === '')

/* ==================== 【3】边界 ==================== */

console.log('\n【3】边界')
check('member 为空返回空串', await memberNick(null) === '')
check('memberInfo 取不到资料时返回空对象/null（不抛）', (await memberInfo(mkOneBotMember({}))) === null)

/* ==================== 【4】memberName：@ 谁取谁 ==================== */

console.log('\n【4】memberName：@ 别人时取被 @ 的人，不取发命令的人')
const mkEvent = ({ sender = { card: '发送者', nickname: 'sender' }, members = {} } = {}) => ({
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

check('@ 别人 → 取被 @ 的人的名片',
  await memberName(mkEvent({ members: { 20002: mkOneBotMember({ card: '被艾特的人' }) } }), 20002) === '被艾特的人')
check('缓存未命中 → getInfo 拿到也算', await memberName(mkEvent({
  members: { 20002: mkOneBotMember({ info: { card: '拉取到的名片' } }) }
}), 20002) === '拉取到的名片')
check('没 @（qq 与发送者一致）→ 取发送者名片', await memberName(mkEvent(), 10001) === '发送者')
check('没传 qq → 取发送者名片', await memberName(mkEvent(), undefined) === '发送者')
check('被 @ 的人不在群里 → 空串（不退化成发送者名字）', await memberName(mkEvent(), 20002) === '')
check('私聊（无 group）且 @ 人 → 空串', await memberName({ user_id: 10001, sender: { card: 'S' } }, 20002) === '')

/* ==================== 【5】静态约束 ==================== */

console.log('\n【5】静态约束：挑战图与排行都用 memberInfo / memberName')
const { readFileSync } = await import('node:fs')
const { mod } = await import('./_helper.mjs')
const gsQuery = readFileSync(mod('modules/challenge/gsQuery.js'), 'utf8')
const gsRank = readFileSync(mod('modules/challenge/gsRank.js'), 'utf8')
/** 静态检查要看代码而不是注释（注释里会引用旧写法做反例） */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
check('gsQuery 三处昵称都按 e.at 取', (gsQuery.match(/const nickname = await memberName\(e, e\.at\)/g) || []).length === 3)
check('gsRank 用 memberInfo 取昵称且不再出现 member.getInfo 直连',
  !/member\.getInfo/.test(stripComments(gsRank)) && (gsRank.match(/memberInfo\(member\)/g) || []).length >= 1)
// OneBot 的 getAvatarUrl() 返回字符串，写成「对返回值直接 .catch」会抛 TypeError 并跳过昵称赋值
check('排行头像不直接把 getAvatarUrl() 当 Promise 用',
  !/getAvatarUrl\?\.\(\)\.catch/.test(stripComments(gsRank)))

finish()