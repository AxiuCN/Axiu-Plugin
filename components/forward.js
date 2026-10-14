/** 长消息转发工具
 *
 *  TRSS-Yunzai 的转发消息入口是消息事件上的 `e.group.makeForwardMsg` / `e.friend.makeForwardMsg`
 *  （框架在组装事件时注入，见 `lib/bot.js` 的 `i.makeForwardMsg ??= this.makeForwardMsg`），
 *  以及机器人实例上的 `Bot.makeForwardMsg`。**没有** `e.runtime.makeForwardMsg` 这种写法。
 *
 *  三者都拿不到（或调用抛错）时回落成一条普通文本，保证命令本身不报错。
 */
import { LOG_PREFIX } from './constants.js'

/**
 * 以合并转发的方式回复长文本
 * @param {object} e 消息事件
 * @param {string} text 文本内容
 * @param {string} [nickname] 转发节点昵称，缺省取机器人昵称
 * @returns {Promise<object|boolean>} e.reply 的返回值（转发段或回落文本段）
 */
export async function replyForward (e, text, nickname = null) {
  const nodes = [{
    message: text,
    nickname: nickname || Bot?.nickname || 'Yunzai-Bot',
    user_id: Bot?.uin
  }]
  try {
    if (typeof e?.group?.makeForwardMsg === 'function') {
      return await e.reply(await e.group.makeForwardMsg(nodes))
    }
    if (typeof e?.friend?.makeForwardMsg === 'function') {
      return await e.reply(await e.friend.makeForwardMsg(nodes))
    }
    if (typeof Bot?.makeForwardMsg === 'function') {
      return await e.reply(Bot.makeForwardMsg(nodes))
    }
  } catch (err) {
    logger?.error(`${LOG_PREFIX}[转发消息] 转发失败，改发纯文本：${err?.message ?? err}`)
  }
  return await e.reply(text)
}
