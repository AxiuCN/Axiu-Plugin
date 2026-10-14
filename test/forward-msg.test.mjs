/**
 * 长消息转发（components/forward.js）
 *
 * 覆盖口径：
 * - TRSS-Yunzai 的转发入口是事件上的 `e.group.makeForwardMsg` / `e.friend.makeForwardMsg`
 *   （框架在组装事件时注入）与 `Bot.makeForwardMsg`；**没有** `e.runtime.makeForwardMsg`
 * - 群聊走群转发、私聊走好友转发；两者都没有时用 `Bot.makeForwardMsg`；三者都不可用或调用抛错
 *   时回落成一条普通文本（命令不能因为转发能力缺失而报错）
 * - 静态约束：插件源码里不允许再出现 `runtime.makeForwardMsg`，`#签到名单列表` 走 `replyForward`
 *
 * 不联网、不起适配器：Bot 与 logger 用内存实现。
 */
import fs from 'node:fs'
import path from 'node:path'
import { checker, importMod, installFrameworkStubs, pluginRoot } from './_helper.mjs'

installFrameworkStubs()

const { replyForward } = await importMod('components/forward.js')
const { check, finish } = checker()

/** 记录 logger.error 的输出，用于断言「转发失败有日志」 */
const errors = []
globalThis.logger = { ...(globalThis.logger || {}), info: () => {}, warn: () => {}, error: (...a) => errors.push(a.join(' ')) }

/** 覆盖 Bot：默认不带 makeForwardMsg（真实环境里群/好友对象上才有） */
const setBot = (over = {}) => { globalThis.Bot = { nickname: '测试Bot', uin: '12345', ...over } }

/**
 * 造事件与转发桩
 * @param {{group?: boolean, friend?: boolean, botMaker?: boolean, throwOnForward?: boolean}} opt
 */
const makeEvent = ({ group = false, friend = false, throwOnForward = false } = {}) => {
  const calls = { group: 0, friend: 0 }
  const maker = async (list) => {
    if (throwOnForward) throw new Error('转发接口炸了')
    return { type: 'node', data: list }
  }
  const replies = []
  return {
    calls,
    replies,
    e: {
      isGroup: group,
      group: group ? { makeForwardMsg: async (l) => { calls.group++; return maker(l) } } : undefined,
      friend: friend ? { makeForwardMsg: async (l) => { calls.friend++; return maker(l) } } : undefined,
      reply: async (m) => { replies.push(m); return true }
    }
  }
}

const TEXT = '已注册签到用户 (共 40 人):\n  用户=10001: 2 个账号\n  ...及其他 10 人'

/* ==================== 【1】群聊 / 私聊走转发 ==================== */

console.log('【1】群聊走群转发、私聊走好友转发，节点带机器人昵称与 uin')
setBot()
const inGroup = makeEvent({ group: true })
await replyForward(inGroup.e, TEXT)
check('群聊调用 e.group.makeForwardMsg', inGroup.calls.group === 1 && inGroup.calls.friend === 0)
check('转发段是 node 类型且内容原样', inGroup.replies[0]?.type === 'node' && inGroup.replies[0]?.data?.[0]?.message === TEXT)
check('节点带机器人昵称与 uin', inGroup.replies[0]?.data?.[0]?.nickname === '测试Bot' && inGroup.replies[0]?.data?.[0]?.user_id === '12345')

const inPrivate = makeEvent({ friend: true })
await replyForward(inPrivate.e, TEXT)
check('私聊调用 e.friend.makeForwardMsg', inPrivate.calls.friend === 1 && inPrivate.calls.group === 0)
check('私聊也发转发段', inPrivate.replies[0]?.type === 'node')

/* ==================== 【2】回落链 ==================== */

console.log('\n【2】群/好友都没有时用 Bot.makeForwardMsg，再不行回落纯文本')
let botCalls = 0
setBot({ makeForwardMsg: (list) => { botCalls++; return { type: 'node', data: list } } })
const noGroupFriend = makeEvent()
await replyForward(noGroupFriend.e, TEXT)
check('回落 Bot.makeForwardMsg', botCalls === 1 && noGroupFriend.replies[0]?.type === 'node')

setBot()
const nothing = makeEvent()
await replyForward(nothing.e, TEXT)
check('三者都不可用时直接发纯文本', nothing.replies[0] === TEXT)
check('纯文本回落不抛异常', nothing.replies.length === 1)

console.log('\n【3】转发接口抛错时不冒泡，改发纯文本并记 error 日志')
setBot()
errors.length = 0
const boom = makeEvent({ group: true, throwOnForward: true })
let threw = false
try {
  await replyForward(boom.e, TEXT)
} catch { threw = true }
check('异常被吞掉（命令不会因此报错）', threw === false)
check('抛错后回落纯文本', boom.replies[0] === TEXT)
check('抛错留下 error 日志', errors.some(l => l.includes('转发失败')), errors.join(' | '))

console.log('\n【4】昵称缺省与自定义')
setBot({ nickname: '' })
const noNick = makeEvent({ group: true })
await replyForward(noNick.e, TEXT)
check('机器人昵称缺失时用 Yunzai-Bot', noNick.replies[0]?.data?.[0]?.nickname === 'Yunzai-Bot')
const customNick = makeEvent({ group: true })
await replyForward(customNick.e, TEXT, '自定义昵称')
check('可显式指定节点昵称', customNick.replies[0]?.data?.[0]?.nickname === '自定义昵称')

/* ==================== 【5】静态约束 ==================== */

console.log('\n【5】静态约束：插件里不允许再用不存在的 e.runtime.makeForwardMsg')
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name)
  if (d.isDirectory()) return d.name === 'node_modules' ? [] : walk(p)
  return d.name.endsWith('.js') ? [p] : []
})
const srcFiles = ['apps', 'components', 'model', 'modules', 'guoba']
  .map(d => path.join(pluginRoot, d))
  .filter(d => fs.existsSync(d))
  .flatMap(walk)
// 先剥掉注释再匹配：文档里说明「框架没有这个 API」是允许的，只要没有真的调用
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const offenders = srcFiles.filter(f => /\.runtime\s*\.\s*makeForwardMsg/.test(stripComments(fs.readFileSync(f, 'utf8'))))
check('全插件源码不再出现 runtime.makeForwardMsg', offenders.length === 0, offenders.join(','))
check('扫描确实覆盖到了源码文件（否则断言等于没跑）', srcFiles.length > 20, `扫描 ${srcFiles.length} 个文件`)

const signinSrc = fs.readFileSync(path.join(pluginRoot, 'apps', 'mysSignin.js'), 'utf8')
check('#签到名单列表 走 replyForward', /await replyForward\(e, msg\)/.test(signinSrc))
check('签到入口已 import replyForward', /import \{ replyForward \} from '\.\.\/components\/forward\.js'/.test(signinSrc))

finish()
