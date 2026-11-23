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
const { memberInfo, memberNick, memberName, fillRankIdentity } = await importMod('components/memberName.js')

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

/* ==================== 【5】排行行：头像 + 群昵称 ==================== */

console.log('\n【5】fillRankIdentity：整群成员一次拉齐，缺的人才单拉')
const mkRankEvent = ({ map, members = {} } = {}) => ({
  group_id: 10001,
  group: {
    getMemberMap: async () => new Map(Object.entries(map || {}).map(([k, v]) => [Number(k), v])),
    pickMember (qq) {
      const hit = members[Number(qq)]
      if (!hit) throw new Error('no such member')
      return hit
    }
  }
})
{
  const rows = [{ qq: 20002 }, { qq: 30003 }]
  await fillRankIdentity(mkRankEvent({
    map: { 20002: { card: '缓存名片', nickname: '缓存昵称' }, 30003: { card: '', nickname: '缓存昵称2' } }
  }), rows)
  check('整群缓存命中时用缓存的 card/nickname',
    rows[0].nickname === '缓存名片' && rows[1].nickname === '缓存昵称2', JSON.stringify(rows.map(r => r.nickname)))
  check('头像取不到时回落 qlogo', rows[0].qqFace === 'https://q.qlogo.cn/g?b=qq&nk=20002&s=100', rows[0].qqFace)
}
{
  // 缓存里没有 → 单拉这个人（OneBot: getInfo）
  let called = 0
  const rows = [{ qq: 40004 }]
  await fillRankIdentity(mkRankEvent({
    map: {},
    members: { 40004: { card: '', nickname: '', getInfo: async () => { called++; return { card: '单拉名片' } } } }
  }), rows)
  check('缓存缺人时才单拉一次 getInfo', rows[0].nickname === '单拉名片' && called === 1, `${rows[0].nickname}/${called}`)
}
{
  // 头像：字符串 / Promise 两种返回都要接住
  const rows = [{ qq: 50005 }, { qq: 60006 }]
  await fillRankIdentity(mkRankEvent({
    map: {},
    members: {
      50005: { card: 'A', getAvatarUrl: () => 'https://a/1.png' },
      60006: { card: 'B', getAvatarUrl: async () => 'https://a/2.png' }
    }
  }), rows)
  check('getAvatarUrl 返回字符串时直接采用（不能当 Promise 调 .catch）', rows[0].qqFace === 'https://a/1.png', rows[0].qqFace)
  check('getAvatarUrl 返回 Promise 时 await 结果', rows[1].qqFace === 'https://a/2.png', rows[1].qqFace)
}
{
  const rows = [{ qq: 70007 }]
  await fillRankIdentity(mkRankEvent({
    map: {},
    members: { 70007: { card: '', getAvatarUrl: () => { throw new Error('boom') } } }
  }), rows)
  check('getAvatarUrl 抛错时回落 qlogo 且昵称仍能补上（修复前昵称赋值被整段跳过）',
    rows[0].qqFace === 'https://q.qlogo.cn/g?b=qq&nk=70007&s=100' && rows[0].nickname === '', JSON.stringify(rows[0]))
}
{
  await fillRankIdentity(mkRankEvent(), [])
  check('空列表不抛错', true)
}

/* ==================== 【6】静态约束 ==================== */

console.log('\n【6】静态约束：挑战图与两套排行都用 memberInfo / fillRankIdentity')
const { readFileSync } = await import('node:fs')
const { mod } = await import('./_helper.mjs')
const gsQuery = readFileSync(mod('modules/challenge/gsQuery.js'), 'utf8')
const gsRank = readFileSync(mod('modules/challenge/gsRank.js'), 'utf8')
const srRank = readFileSync(mod('modules/challenge/srRank.js'), 'utf8')
/** 静态检查要看代码而不是注释（注释里会引用旧写法做反例） */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
check('gsQuery 三处昵称都按 e.at 取', (gsQuery.match(/const nickname = await memberName\(e, e\.at\)/g) || []).length === 3)
check('原神排行用 fillRankIdentity', /fillRankIdentity\(e, \[\.\.\.list, selfRank\]\)/.test(stripComments(gsRank)))
check('星铁排行用 fillRankIdentity', /fillRankIdentity\(e, \[\.\.\.list, selfRank\]\)/.test(stripComments(srRank)))
check('两套排行都不再把 getAvatarUrl() 当 Promise 用（OneBot 返回字符串）',
  !/getAvatarUrl\?\.\(\)\.catch/.test(stripComments(gsRank)) && !/getAvatarUrl\?\.\(\)\.catch/.test(stripComments(srRank)))
check('两套排行都不再直接 member.getInfo 取昵称',
  !/member\.getInfo/.test(stripComments(gsRank)) && !/member\.getInfo/.test(stripComments(srRank)))

finish()