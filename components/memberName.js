/**
 * 群成员资料 / 昵称取值
 *
 * 适配器差异（这里踩过两次，写清楚免得再犯）：
 * - **OneBot v11（本项目在用）**：`group.pickMember(qq)` 返回的是「框架群成员缓存里的字段 + `getInfo()` 方法」
 *   的普通对象——缓存命中时直接有 `card` / `nickname`，没命中就要 `await getInfo()`（一次
 *   `get_group_member_info`）。**没有 `info`，也没有 `renew`**。
 * - **icqq**：`Member` 上有 `info` 取值器与 `renew()`，但缓存未命中时 `info` 返回 `undefined`
 *   （取值器只会在后台顺手 renew）。
 *
 * 两条形状都兜住，换协议端不会静默失效。
 */

/**
 * 取群成员资料对象
 * @param {object} member - `group.pickMember(qq)` 的返回值（可为空）
 * @returns {Promise<object|null>} 至少能读到 `card` / `nickname` 的对象
 */
export async function memberInfo (member) {
  if (!member) return null

  // 1) 缓存命中：OneBot 会把群成员缓存（bot.gml）里的字段摊在 pickMember 的返回对象上
  if (member.card || member.nickname) return member

  // 2) OneBot：拉一次成员资料
  try {
    const info = await member.getInfo?.()
    if (info) return info
  } catch {
    // 成员已退群 / 接口失败：继续往下兜
  }

  // 3) icqq：info 取值器为空时 renew 一次
  if (member.info) return member.info
  try {
    return (await member.renew?.()) || null
  } catch {
    return null
  }
}

/**
 * 取群成员昵称（群名片 → 群昵称）
 * @param {object} member - `group.pickMember(qq)` 的返回值
 * @returns {Promise<string>} 取不到时返回空串
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

/**
 * 群成员头像地址
 *
 * OneBot 适配器的 `getAvatarUrl()` 直接返回**字符串**（不是 Promise），
 * 写成 `await member.getAvatarUrl?.().catch(...)` 会抛 TypeError；
 * 若这段又包在 try 里，后面的字段赋值会被整段跳过（群排行昵称恒为空就是这么来的）。
 * @param {object} member - `group.pickMember(qq)` 的返回值
 * @param {number|string} qq - 目标 QQ（兜底 qlogo 用）
 * @returns {Promise<string>}
 */
export async function memberAvatar (member, qq) {
  let url = null
  try {
    url = member?.getAvatarUrl?.()
  } catch {
    url = null
  }
  if (url && typeof url.then === 'function') url = await url.catch(() => null)
  return url || `https://q.qlogo.cn/g?b=qq&nk=${qq}&s=100`
}

/**
 * 给排行行补上 QQ 头像与群昵称（原神 / 星铁排行共用）
 *
 * - 整个群的成员一次拉齐：`group.getMemberMap()` 只打一次 `get_group_member_list`，
 *   逐人 `getInfo()` 在 top20 时会打 20 次接口
 * - 缓存里没有的那几个人，才单独走 `memberInfo()` 拉一次
 * - 昵称取不到就留空（模板不渲染名字），头像取不到回落 qlogo
 * @param {object} e - 事件（需要 e.group）
 * @param {Array<{qq?: number|string}>} rows - 排行行（原地写入 `qqFace` / `nickname`）
 */
export async function fillRankIdentity (e, rows) {
  const list = (rows || []).filter(Boolean)
  if (!list.length) return

  let memberMap = null
  try {
    memberMap = await e.group?.getMemberMap?.()
  } catch {
    memberMap = null
  }
  const cached = (qq) => memberMap?.get(Number(qq)) || memberMap?.get(String(qq)) || null
  const pickMember = (qq) => {
    if (!qq) return null
    try {
      return e.group.pickMember(qq)
    } catch {
      return null
    }
  }

  await Promise.all(list.map(async (row) => {
    const member = pickMember(row.qq)
    row.qqFace = await memberAvatar(member, row.qq)
    const hit = cached(row.qq)
    row.nickname = hit?.card || hit?.nickname || await memberNick(member) || ''
  }))
}