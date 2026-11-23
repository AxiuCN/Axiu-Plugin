/**
 * 群成员昵称取值
 *
 * 挑战图右上角、群排行每行展示的都是「数据所属的那个人」：
 * 发 `@某人 #危战` 时查的是被 @ 的人的 UID，昵称也必须取那个人的，
 * 不能取发命令的人。
 *
 * 注意：icqq 的 `Member` **没有** `getInfo()`，昵称只能走 `card` 取值器
 * （群名片，缺省群昵称）；缓存里没有资料时用 `renew()` 拉一次。
 * 早期写成 `member.getInfo?.()` 拿到的一直是 undefined，
 * 群排行昵称因此从未生效过。
 */

/**
 * 取群成员资料对象（缓存优先；缓存里没有名字时 renew 一次）
 *
 * icqq 的 `info` 取值器在缓存未命中时只会顺手在后台 renew，**仍然返回 undefined**，
 * 所以「读 info 拿到空 → 再 renew」这条顺序是必须的。
 * @param {object} member - `group.pickMember(qq)` 的返回值
 * @returns {Promise<{card?: string, nickname?: string, [k: string]: any}|null>}
 */
export async function memberInfo (member) {
  if (!member) return null
  const cached = member.info || null
  if (cached?.card || cached?.nickname) return cached
  const quick = member.card // 取值器就是 info.card || info.nickname
  if (quick) return { ...(cached || {}), card: quick }
  try {
    return (await member.renew?.()) || cached
  } catch {
    // 成员已退群 / 拉取失败
    return cached
  }
}

/**
 * 从一个已取到的群成员对象上取昵称（群名片 → 群昵称）
 * @param {object} member - `group.pickMember(qq)` 的返回值
 * @returns {Promise<string>}
 */
export async function memberNick (member) {
  const info = await memberInfo(member)
  return info?.card || info?.nickname || ''
}

/**
 * 取某个 QQ 在当前群的昵称
 * @param {object} e - 事件（需要 e.group / e.sender）
 * @param {number|string} [qq] - 目标 QQ；缺省为发送者
 * @returns {Promise<string>}
 */
export async function memberName (e, qq) {
  const target = Number(qq) || 0
  const isSelf = !target || target === Number(e?.user_id)

  if (isSelf) return e?.sender?.card || e?.sender?.nickname || ''
  if (!e?.group) return ''

  let member = null
  try {
    member = e.group.pickMember(target)
  } catch {
    member = null
  }
  return memberNick(member)
}