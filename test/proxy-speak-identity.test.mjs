/**
 * 代发言注入事件的身份字段（`apps/proxySpeak.js` 的 `_buildProxyEvent`）
 *
 * 背景：`#代` 用 `{...e}` 浅拷贝原事件。genshin 的 `NoteUser.create(e)` 会优先取
 * `e.originalUserId`（`model/mys/NoteUser.js:88`），`mainUserId` 还参与主子账户绑定判定
 * （`model/user.js:622/664/708`）——两者都是「上一个身份」的残留，带进注入事件就会
 * 仍按原用户建档（报告中已用真实模型控制复现）。`e.user` 不必清：`Runtime.init` 会重建。
 *
 * 覆盖口径：
 * - 注入事件里 `originalUserId` / `mainUserId` 必须被清掉
 * - `user_id` 换目标、`original_msg` 等既有清理不回退，且不改坏原事件
 * - `sender` 昵称取群名片/群昵称，取不到才回落 QQ 号（`member.info` 缓存未命中时是 undefined，
 *   直接兜成 QQ 号会让代发言的牌面变成纯数字）
 * - 静态约束：源码在 `{ ...e }` 之后必须显式删除这两个字段
 *
 * 不联网、不分发：只测事件构造（不触碰真实 loader）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { checker, importMod, installFrameworkStubs, pluginRoot } from './_helper.mjs'

installFrameworkStubs()

const { ProxySpeak } = await importMod('apps/proxySpeak.js')
const { check, finish } = checker()

/** 造一个 icqq 风格的最小 member（`info` 可为 undefined，模拟缓存未命中） */
const mkMember = ({ info, renew, card } = {}) => ({
  get card () { return card },
  info,
  renew: renew ?? (async () => info)
})

/** 造原事件（模拟主人已走过 Runtime.init 的事件） */
const mkEvent = ({ originalUserId, mainUserId } = {}) => {
  const e = {
    isGroup: true,
    group_id: '10001',
    user_id: '10001',
    self_id: '99999',
    bot: { uin: '99999' },
    msg: '#代@20002 你好',
    message: [{ type: 'at', qq: '20002' }, { type: 'text', text: ' 你好' }],
    original_msg: '#代@20002 你好',
    raw_message: '#代@20002 你好',
    at: '20002',
    atBot: false,
    reply_id: 'abc',
    img: ['x'],
    file: ['y'],
    logText: 'log',
    logFnc: 'fnc',
    only_reply_at: false,
    group: {
      pickMember: (qq) => ({ info: { card: `名片${qq}`, nickname: `昵称${qq}`, user_id: qq } })
    },
    reply: async () => true
  }
  if (originalUserId !== undefined) e.originalUserId = originalUserId
  if (mainUserId !== undefined) e.mainUserId = mainUserId
  return e
}

/** 走一遍构造（目标 20002） */
const build = (e) => new ProxySpeak()._buildProxyEvent(e, {
  targetUin: 20002,
  speechContent: '你好',
  member: e.group.pickMember(20002),
  sender: { card: '名片20002', nickname: '昵称20002', user_id: 20002 }
})

/* ==================== 【1】派生身份字段被清掉 ==================== */

console.log('【1】注入事件不继承上个身份的 originalUserId / mainUserId')
{
  const fake = build(mkEvent({ originalUserId: '10001', mainUserId: '10001' }))
  check('originalUserId 已清除（修复前会被 NoteUser.create 优先采用）', !('originalUserId' in fake))
  check('mainUserId 已清除（修复前会参与主子账户绑定判定）', !('mainUserId' in fake))
}
{
  const fake = build(mkEvent())
  check('原事件本来没有这两个字段时不报错', !('originalUserId' in fake) && !('mainUserId' in fake))
}

/* ==================== 【2】既有行为不回退 ==================== */

console.log('\n【2】目标身份与既有清理保持不变')
{
  const e = mkEvent({ originalUserId: '10001', mainUserId: '10001' })
  const fake = build(e)
  check('user_id 换成目标用户', String(fake.user_id) === '20002', String(fake.user_id))
  check('sender / member 用目标用户信息', fake.sender?.user_id === 20002 && !!fake.member)
  check('代发言者不是主人身份', fake.isMaster === false)
  check('message 首段是 @机器人（保证通过 onlyReplyAt）',
    fake.message?.[0]?.type === 'at' && String(fake.message[0].qq) === '99999')
  check('raw_message 是代发内容', fake.raw_message === '你好')
  const cleared = ['msg', 'at', 'atBot', 'img', 'file', 'logText', 'logFnc', 'only_reply_at', 'reply_id', 'getReply', 'original_msg']
  const left = cleared.filter(k => k in fake)
  check('dealEvent 重算字段与 original_msg 仍被清除', left.length === 0, left.join(','))
}
{
  const e = mkEvent({ originalUserId: '10001', mainUserId: '10001' })
  build(e)
  check('原事件对象未被改坏（拷的是副本）',
    e.user_id === '10001' && e.originalUserId === '10001' && e.mainUserId === '10001' && e.msg === '#代@20002 你好')
}

/* ==================== 【3】sender 昵称 ==================== */

console.log('\n【3】sender 昵称：优先群名片，取不到才回落 QQ 号')
{
  // 缓存命中：info 里有名片
  const sender = await new ProxySpeak()._buildSender(20002, mkMember({ info: { card: '群名片', nickname: '群昵称', role: 'member', avatar: 'a.png' } }))
  check('缓存命中时用群名片', sender.card === '群名片' && sender.nickname === '群昵称', JSON.stringify(sender))
  check('保留 info 的其它字段（头像、头衔等）', sender.role === 'member' && sender.avatar === 'a.png', JSON.stringify(sender))
}
{
  // 未命中：member.info 是 undefined，这也是线上常见情形（旧实现因此显示成 QQ 号）
  const sender = await new ProxySpeak()._buildSender(20002, mkMember({ renew: async () => ({ card: '冷启动名片', nickname: '冷启动昵称' }) }))
  check('member.info 缺失时用 renew 的资料（修复前显示 QQ 号）', sender.card === '冷启动名片' && sender.nickname === '冷启动昵称', JSON.stringify(sender))
}
{
  const sender = await new ProxySpeak()._buildSender(20002, mkMember({}))
  check('完全取不到昵称时才回落 QQ 号', sender.card === '20002' && sender.nickname === '20002', JSON.stringify(sender))
  check('user_id 始终是目标 QQ', sender.user_id === 20002)
}
{
  const sender = await new ProxySpeak()._buildSender(20002, null)
  check('member 为空（已退群）不抛错并回落 QQ 号', sender.card === '20002')
}

/* ==================== 【4】静态约束 ==================== */

console.log('\n【4】静态约束：源码必须显式清除这两个派生身份字段')
const src = fs.readFileSync(path.join(pluginRoot, 'apps', 'proxySpeak.js'), 'utf8')
const spreadIdx = src.indexOf('{ ...e }')
check('仍以 {...e} 构造注入事件', spreadIdx > 0, String(spreadIdx))
for (const field of ['originalUserId', 'mainUserId']) {
  const delIdx = src.indexOf(`delete fakeEvent.${field}`)
  check(`源码显式 delete fakeEvent.${field}`, delIdx > spreadIdx, `spread=${spreadIdx} del=${delIdx}`)
}

finish()