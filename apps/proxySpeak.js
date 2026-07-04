import plugin from '../../../lib/plugins/plugin.js'
import loader from '../../../lib/plugins/loader.js'

export class ProxySpeak extends plugin {
  constructor() {
    super({
      name: '[Axiu-Plugin] 代发言',
      dsc: '代替指定用户发言，让其他插件处理消息',
      event: 'message',
      priority: -Infinity,
      rule: [
        {
          reg: /^#代/,
          fnc: 'proxySpeak',
          permission: 'master',
          log: true
        }
      ]
    })
  }

  /**
   * 代发言入口
   * 支持格式：
   *   #代@某人 消息内容  — 用 @ 指定目标用户
   *   #代QQ号 消息内容  — 用纯数字指定目标用户
   * @param {object} e - Runtime 事件对象
   */
  async proxySpeak(e) {
    if (!e.isGroup) {
      await e.reply('代发言仅在群聊中可用')
      return true
    }

    // 1. 解析目标QQ和发言内容
    const parsed = this._parseCommand(e)
    if (!parsed) {
      await e.reply('用法：#代@某人 消息内容\n或：#代QQ号 消息内容')
      return true
    }

    const { targetUin, speechContent } = parsed

    if (!speechContent) {
      await e.reply('请输入要代发的内容')
      return true
    }

    // 2. 获取目标用户的群成员信息
    const member = e.group.pickMember(targetUin)
    const sender = member?.info ?? {
      card: String(targetUin),
      nickname: String(targetUin),
      user_id: targetUin
    }

    // 3. 构造假事件：以原事件为基础，覆盖关键字段
    const fakeEvent = { ...e }

    // 目标用户身份
    fakeEvent.user_id = targetUin
    fakeEvent.sender = sender
    fakeEvent.member = member
    fakeEvent.isMaster = false

    // 构造干净的 message 数组
    // 第一个 segment: @机器人，确保通过 onlyReplyAt 检测
    // 后续 segment: 纯文本发言内容
    fakeEvent.message = speechContent
      ? [
          { type: 'at', qq: String(Bot.uin) },
          { type: 'text', text: speechContent }
        ]
      : [{ type: 'text', text: '' }]

    fakeEvent.raw_message = speechContent

    // 清除 dealEvent 会重新计算的字段，避免旧值干扰
    delete fakeEvent.msg
    delete fakeEvent.at
    delete fakeEvent.atBot
    delete fakeEvent.img
    delete fakeEvent.file
    delete fakeEvent.logText
    delete fakeEvent.logFnc
    delete fakeEvent.only_reply_at
    // reply_id 也不应继承（否则 dealEvent 中会尝试获取引用消息）
    delete fakeEvent.reply_id
    delete fakeEvent.getReply

    // 4. 清除 CD，防止假事件被冷却拦截
    try {
      delete loader.groupCD[e.group_id]
      delete loader.singleCD[`${e.group_id}.${targetUin}`]
    } catch {}

    // 5. 注入假事件，重新走插件匹配流程
    try {
      await loader.deal(fakeEvent)
    } catch (err) {
      logger.error('[Axiu-Plugin][代发言] 注入假事件失败:', err)
      await e.reply('代发言处理失败，请检查日志')
    }

    return true
  }

  /**
   * 从命令消息中提取目标QQ和发言内容
   * @param {object} e - Runtime 事件对象
   * @returns {{targetUin: number, speechContent: string}|null}
   */
  _parseCommand(e) {
    // 优先从 message 数组提取 @ 目标（比 e.at 更可靠）
    let targetUin = null
    let speechContent = ''

    if (e.message && Array.isArray(e.message)) {
      const segments = []
      let foundAt = false

      for (const seg of e.message) {
        if (!foundAt && seg.type === 'at' && String(seg.qq) !== String(Bot.uin)) {
          // 取第一个非机器人 @ 作为目标
          targetUin = Number(seg.qq)
          foundAt = true
          continue // 跳过这个 @ 段，不加入内容
        }
        segments.push(seg)
      }

      // 从剩余 segments 提取文本，并去除 #代 前缀
      const rawText = segments
        .filter(s => s.type === 'text')
        .map(s => s.text)
        .join('')
      speechContent = rawText.replace(/^#代/, '').trim()
    }

    // 如果没有 @ 目标，尝试 #代QQ号 格式
    if (!targetUin) {
      const match = e.msg?.match(/^#代(\d+)\s*(.*)/)
      if (match) {
        targetUin = Number(match[1])
        speechContent = match[2]?.trim() || ''
      }
    }

    if (!targetUin) return null
    return { targetUin, speechContent }
  }
}
