/**
 * 圣遗物/遗器总榜（本群 + 全局）与排行定时刷新
 *
 * 覆盖口径：
 * - 键解析：miao:rank:{群}:mark:{角色id}，原神 8 位 / 星铁 4 位；uid-info / cfg 键不算排行键
 * - 汇总：分数降序、取前 N（N 取 miao 配置或注入）、同角色多 uid、同 uid 多角色、全局跨群、dmg 不混入
 * - 身份：uid → qq（uid-info）、昵称/头像回落、未知角色（残留）兜底命名
 * - 群开关：status===1 时本群榜直接提示且不出图；全局范围不判群开关
 * - 降级：miao 缺失 → 提示「该功能需要 miao-plugin」；无数据 → 面板提示
 * - 定时刷新：有数据的群集合只含 mark 键里出现的群；未启用时零 Redis 访问；miao 缺失只刷 Axiu 侧
 * - 配置：defSet 占位符 ↔ guoba TEMPLATE_VARS ↔ 渲染回 config.yaml 三边一致
 *
 * 不加载真实 miao（`setMiaoAccessor()` 注入替身），因此不联网、不依赖 miao 的资源文件；
 * 命令入口只跑「失败/降级」分支与「渲染被桩替换」的成功分支（`renderer.screenshot` 换成桩），
 * 不启动浏览器。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import YAML from 'yaml'
import { appRoot, checker, importMod, installFrameworkStubs, pluginRoot, tmpDir } from './_helper.mjs'

const store = installFrameworkStubs()

/** apps/ 下的 class 继承全局 plugin（生产由 loader.js 注入） */
globalThis.plugin = class { constructor (cfg = {}) { Object.assign(this, cfg) } }

/* ---------------- 配置目录重定向（配置读写都落在临时目录，不碰仓库 config/） ---------------- */
const cfgDir = path.join(tmpDir, 'artis-rank-cfg')
fs.rmSync(cfgDir, { recursive: true, force: true })
fs.mkdirSync(cfgDir, { recursive: true })
for (const name of ['config.yaml.example', 'group_config.yaml.example', 'MihoyoBBSTools_config.yaml.example']) {
  fs.copyFileSync(path.join(pluginRoot, 'config', name), path.join(cfgDir, name))
}
process.env.AXIU_CONFIG_DIR = cfgDir
const cfgPath = path.join(cfgDir, 'config.yaml')

/** 渲染后端换桩：拿渲染数据做断言，且绝不启动浏览器 */
const { default: renderer } = await import(pathToFileURL(path.join(appRoot, 'lib', 'puppeteer', 'puppeteer.js')).href)
let renderCalls = 0
let lastRender = null
renderer.screenshot = async (name, data) => {
  renderCalls++
  lastRender = { name, data }
  return { type: 'image', file: 'test/.test-tmp/artis-rank-stub.png' }
}

const {
  buildArtisRank,
  gameOfCharId,
  getGroupRankStatus,
  listRankGroups,
  miaoAvailable,
  parseRankKey,
  resetMiaoAccessor,
  setMiaoAccessor,
  DEFAULT_TOP_N,
  MESSAGES
} = await importMod('model/artisRank.js')
const { ArtisRankApp } = await importMod('apps/artisRank.js')
const { RankRefreshApp } = await importMod('apps/rankRefresh.js')
const { check, finish } = checker()

/* ---------------- 数据与替身 ---------------- */

const G1 = '10001' // 有原神 + 星铁 mark 数据、群开关开启
const G2 = '20002' // 有 mark 数据、群开关「已关闭」
const G3 = '30003' // 只有 dmg 键（不该进「有数据的群」）
const G4 = '40004' // 没有任何键

/**
 * 角色 stub：不加载真实 miao，按 `游戏:角色id` 命中，未命中返回 null（模拟已删角色残留）
 * 角色 id 与名字取自真实 miao 数据（10000052=雷电将军、10000046=胡桃、10000003=琴、10000002=神里绫华、1205=刃）
 */
const CHARS = {
  'gs:10000052': { name: '雷电将军', face: '/meta-gs/character/雷电将军/imgs/face.webp', star: 5 },
  'gs:10000046': { name: '胡桃', face: '/meta-gs/character/胡桃/imgs/face.webp', star: 5 },
  'gs:10000003': { name: '琴', face: '/meta-gs/character/琴/imgs/face.webp', star: 5 },
  'gs:10000002': { name: '神里绫华', face: '/meta-gs/character/神里绫华/imgs/face.webp', star: 5 },
  'sr:1205': { name: '刃', face: '/meta-sr/character/刃/imgs/face.webp', star: 5 }
}

/** miao 访问替身 */
const stubAccessor = ({ topN = 15, available = true } = {}) => ({
  available: async () => available,
  getRankNumber: async () => topN,
  getChar: async (charId, game) => CHARS[`${game}:${charId}`] || null
})

/** 造排行键（member = uid, score = 分数） */
const seedRank = async (gid, type, charId, entries) => {
  for (const [uid, score] of entries) {
    await redis.zAdd(`miao:rank:${gid}:${type}:${charId}`, { score, value: uid })
  }
}
/** 造 uid 信息 / 群开关 */
const seedUidInfo = (uid, data) => store.strings.set(`miao:rank:uid-info:${uid}`, JSON.stringify(data))
const seedGroupCfg = (gid, status) => store.strings.set(`miao:rank:${gid}:cfg`, JSON.stringify({ status, timestamp: 1 }))

// 原神（8 位角色 id）
await seedRank(G1, 'mark', '10000052', [['100000001', 250.5], ['100000002', 180.0]]) // 同角色多 uid
await seedRank(G1, 'mark', '10000046', [['100000001', 210.5]]) // 同 uid 多角色
await seedRank(G1, 'mark', '10000003', [['100000002', 210.5]]) // 与上一行同分，用于检验定序
await seedRank(G1, 'mark', '19999999', [['100000006', 170.0]]) // miao 里没有的角色（残留）
await seedRank(G2, 'mark', '10000052', [['100000004', 300.0]]) // 另一个群、跨群最高分
await seedRank(G2, 'mark', '10000002', [['100000005', 50.0]])
await seedRank(G1, 'dmg', '10000052', [['100000009', 999.9]]) // 干扰项：伤害榜不参与
await seedRank(G3, 'dmg', '10000052', [['100000009', 888.8]]) // 只有 dmg 的群
// 星铁（4 位角色 id）
await seedRank(G1, 'mark', '1205', [['100000001', 199.0]])

seedUidInfo('100000001', { qq: '11111', uidType: 'ck' })
seedUidInfo('100000002', { qq: '22222', uidType: 'bind' })
seedUidInfo('100000004', { qq: '44444', uidType: 'ck' })
seedUidInfo('100000005', { uidType: 'bind' }) // 没有 qq：昵称与头像都要回落
seedGroupCfg(G1, 0)
seedGroupCfg(G2, 1)
seedGroupCfg(G4, 0)

/** 造命令事件 */
const makeEvent = ({ msg, groupId = null, isGroup = true, isSr = false, pickMember = null }) => {
  const replies = []
  return {
    replies,
    e: {
      msg,
      isGroup,
      isSr,
      group_id: groupId,
      group: pickMember ? { pickMember } : undefined,
      reply: async (m) => { replies.push(m); return true }
    }
  }
}

/** 分数是否非递增 */
const isNonIncreasing = (arr) => arr.every((v, i) => i === 0 || arr[i - 1] >= v)

/* ==================== 【1】键解析 ==================== */

console.log('【1】排行键解析：角色 id 形态决定游戏，非排行键不算命中')
check('8 位角色 id = 原神', gameOfCharId('10000052') === 'gs')
check('4 位角色 id = 星铁', gameOfCharId('1205') === 'sr')
check('其他位数 / 非数字都不算角色 id', gameOfCharId('123') === null && gameOfCharId('123456789') === null && gameOfCharId('12ab') === null)
const parsed = parseRankKey('miao:rank:10001:mark:10000052', 'gs')
check('解析出群号 / 角色 id / 类型', parsed?.groupId === '10001' && parsed?.charId === '10000052' && parsed?.type === 'mark')
check('游戏不匹配时不算命中（4 位 id 不属原神）', parseRankKey('miao:rank:10001:mark:1205', 'gs') === null)
check('uid-info 键不是排行键', parseRankKey('miao:rank:uid-info:100000001', 'gs') === null)
check('群开关键不是排行键', parseRankKey('miao:rank:10001:cfg', 'gs') === null)

/* ==================== 【2】本群汇总 ==================== */

console.log('\n【2】本群汇总：降序、重复行、身份回落、残留兜底')
setMiaoAccessor(stubAccessor({ topN: 15 }))
const g1 = await buildArtisRank({ groupId: G1, game: 'gs' })
check('本群榜返回 ok', g1.ok === true, JSON.stringify(g1.reason))
check('① 分数降序', isNonIncreasing(g1.rows.map(r => r.score)))
check('① 最高分在最前', g1.rows[0].score === 250.5)
check('行数 = 本群 mark 行数（未截断 5 行）', g1.rows.length === 5, `实际 ${g1.rows.length}`)
check('③ 同角色多 uid 都出现（雷电将军 2 行）', g1.rows.filter(r => r.charId === '10000052').length === 2)
check('④ 同 uid 多角色都出现（uid…001 两行）', g1.rows.filter(r => r.uid === '100000001').length === 2)
check('名次按位置连续编号', g1.rows.map(r => r.rank).join(',') === '1,2,3,4,5')
check('角色名取 miao（雷电将军 / 胡桃）', g1.rows.some(r => r.charName === '雷电将军') && g1.rows.some(r => r.charName === '胡桃'))
check('角色头像与星级取 miao', g1.rows.find(r => r.charName === '雷电将军')?.charFace === '/meta-gs/character/雷电将军/imgs/face.webp' && g1.rows.find(r => r.charName === '雷电将军')?.star === 5)
check('miao 里没有的角色走兜底命名（残留容忍）', g1.rows.some(r => r.charName === '未知角色(19999999)'))
check('⑦ dmg 键不混入', !g1.rows.some(r => r.score === 999.9))
check('每行带群号', g1.rows.every(r => r.gid === G1))
const row001 = g1.rows.find(r => r.uid === '100000001' && r.charId === '10000052')
const rowNoInfo = g1.rows.find(r => r.uid === '100000006')
check('⑤ uid → qq 映射（uid-info）', row001?.qq === '11111')
check('⑤ 昵称回落 用户:{qq}', row001?.nick === '用户:11111')
check('⑤ 头像回落 qlogo', row001?.face === 'https://q.qlogo.cn/g?b=qq&nk=11111&s=100')
check('⑤ 没有 uid-info 时昵称与头像都回落', rowNoInfo?.qq === '' && rowNoInfo?.nick === '未知用户' && rowNoInfo?.face === '')

/* ==================== 【3】前 N 截断 ==================== */

console.log('\n【3】取前 N：截断、人数来源与兜底、每键只取前 N')
const g1Top2 = await buildArtisRank({ groupId: G1, game: 'gs', topN: 2 })
check('② 注入 N=2 时截断到 2 行', g1Top2.rows.length === 2 && g1Top2.topN === 2)
check('② 截断取的是最高分两行', g1Top2.rows[0].score === 250.5 && g1Top2.rows[1].score === 210.5)
check('② 同分两行按 uid 升序定序', g1Top2.rows[1].uid === '100000001')
check('每个键只取前 N 条（N=2 时候选 5 条而非全量）', g1Top2.candidateCount === 5, `实际 ${g1Top2.candidateCount}`)
check('② 人数取自 miao 配置（accessor.getRankNumber）', g1.topN === 15)
setMiaoAccessor(stubAccessor({ topN: null }))
const g1Fallback = await buildArtisRank({ groupId: G1, game: 'gs' })
check('miao 配置取不到时兜底 15 人', g1Fallback.topN === DEFAULT_TOP_N)
setMiaoAccessor(stubAccessor({ topN: 0 }))
const g1BadN = await buildArtisRank({ groupId: G1, game: 'gs' })
check('人数非法（0）同样兜底', g1BadN.topN === DEFAULT_TOP_N)

/* ==================== 【4】全局跨群 ==================== */

console.log('\n【4】全局（跨群）汇总：范围、游戏过滤、不判群开关')
setMiaoAccessor(stubAccessor({ topN: 15 }))
const globalGs = await buildArtisRank({ game: 'gs' })
check('⑥ 全局汇总两个群的键（4 + 2 = 6）', globalGs.keyCount === 6, `实际 ${globalGs.keyCount}`)
check('⑥ 全局首行是跨群最高分', globalGs.rows[0].score === 300.0 && globalGs.rows[0].gid === G2)
check('⑥ 全局含他群行', globalGs.rows.some(r => r.gid === G2) && globalGs.rows.some(r => r.gid === G1))
check('⑥ 全局不判群开关（已关闭群的键也参与）', globalGs.rows.some(r => r.gid === G2 && r.uid === '100000004'))
check('③ 跨群同样保留同角色多 uid 行', globalGs.rows.filter(r => r.charId === '10000052').length === 3)
check('⑦ 全局也不混入 dmg', !globalGs.rows.some(r => r.score === 999.9))
const globalTop1 = await buildArtisRank({ game: 'gs', topN: 1 })
check('② 全局 N=1 取跨群最高分（不必扫每键全部成员）', globalTop1.rows.length === 1 && globalTop1.rows[0].score === 300.0)
const globalSr = await buildArtisRank({ game: 'sr' })
check('游戏过滤：星铁榜只含 4 位角色 id 的键', globalSr.keyCount === 1 && globalSr.rows.length === 1 && globalSr.rows[0].charId === '1205')
check('游戏过滤：星铁行取星铁角色名', globalSr.rows[0].charName === '刃')
check('游戏过滤：原神榜不含星铁键', !globalGs.rows.some(r => r.charId === '1205'))

/* ==================== 【5】群开关 ==================== */

console.log('\n【5】群开关：关闭群拦下本群榜，全局不受影响')
check('开关读取：开启=0 / 关闭=1', await getGroupRankStatus(G1) === 0 && await getGroupRankStatus(G2) === 1)
check('没有 cfg 键的群按开启处理', await getGroupRankStatus(G4) === 0)
const g2Closed = await buildArtisRank({ groupId: G2, game: 'gs' })
check('⑧ 关闭群的本群榜被拦下', g2Closed.ok === false && g2Closed.reason === 'group-closed')
check('⑧ 关闭群不读数据（没有 rows）', g2Closed.rows === undefined)

/* ==================== 【6】无数据与降级 ==================== */

console.log('\n【6】无数据与 miao 缺失：两条提示各归各')
setMiaoAccessor(stubAccessor({ topN: 15 }))
const g4Empty = await buildArtisRank({ groupId: G4, game: 'gs' })
check('无数据时 reason=no-data', g4Empty.ok === false && g4Empty.reason === 'no-data')
check('无数据文案带 #面板 / *面板 指引', MESSAGES.noData.includes('#面板') && MESSAGES.noData.includes('*面板'))
setMiaoAccessor(stubAccessor({ available: false }))
const noMiao = await buildArtisRank({ groupId: G1, game: 'gs' })
check('⑨ miao 缺失时降级', noMiao.ok === false && noMiao.reason === 'no-miao')
check('⑨ 降级文案固定', MESSAGES.noMiao === '该功能需要 miao-plugin')
check('⑨ 全局范围同样降级', (await buildArtisRank({ game: 'gs' })).reason === 'no-miao')
check('miaoAvailable() 反映访问器', await miaoAvailable() === false)
check('群开关先于 miao 探测（关闭群提示不变）', (await buildArtisRank({ groupId: G2, game: 'gs' })).reason === 'group-closed')

/* ==================== 【7】有数据的群集合（定时刷新用） ==================== */

console.log('\n【7】有排行数据的群集合')
const groups = await listRankGroups()
check('⑩ 只含 mark 键里出现的群', groups.join(',') === '10001,20002', groups.join(','))
check('⑩ 只有 dmg 键的群不在集合里', !groups.includes(G3))
check('⑩ 群号升序且去重', groups.length === new Set(groups).size)
resetMiaoAccessor()

/* ==================== 【8】命令入口 ==================== */

console.log('\n【8】命令入口：正则、权限、提示与出图')
const app = new ArtisRankApp()
check('注册两条 rule（本群 / 全局）共用同一个 fnc', app.rule?.length === 2 && app.rule.every(r => r.fnc === 'artisRank'))
check('权限 all、priority 与 apps/challenge.js 一致', app.priority === 1 && app.rule.every(r => r.permission === 'all'))
const hit = (reg, msg, isSr = false) => new RegExp(reg).test(isSr ? msg.replace(/^[*＊]/, '#星铁') : msg)
check('本群命令：#圣遗物总榜 / #遗器总榜', hit(app.rule[0].reg, '#圣遗物总榜') && hit(app.rule[0].reg, '#遗器总榜'))
check('本群命令：*遗器总榜（框架归一成 #星铁遗器总榜）', hit(app.rule[0].reg, '*遗器总榜', true) && hit(app.rule[0].reg, '#星铁遗器总榜'))
check('全局命令：#全局圣遗物总榜 / #全局遗器总榜', hit(app.rule[1].reg, '#全局圣遗物总榜') && hit(app.rule[1].reg, '#全局遗器总榜'))
check('全局命令：*全局遗器总榜（归一后 #星铁全局遗器总榜）', hit(app.rule[1].reg, '*全局遗器总榜', true))
check('两条正则互不误匹配', !hit(app.rule[0].reg, '#全局圣遗物总榜') && !hit(app.rule[1].reg, '#圣遗物总榜'))
check('不误匹配其他圣遗物命令', !hit(app.rule[0].reg, '#圣遗物列表') && !hit(app.rule[1].reg, '#遗器统计'))

setMiaoAccessor(stubAccessor({ topN: 15 }))
const beforeClosed = renderCalls
const closed = makeEvent({ msg: '#圣遗物总榜', groupId: G2 })
await app.artisRank(closed.e)
check('⑧ 关闭群回复提示文案', closed.replies[0] === MESSAGES.groupClosed)
check('⑧ 关闭群不出图（渲染零调用）', renderCalls === beforeClosed)

setMiaoAccessor(stubAccessor({ available: false }))
const degraded = makeEvent({ msg: '#圣遗物总榜', groupId: G1 })
await app.artisRank(degraded.e)
check('⑨ miao 缺失回复降级提示', degraded.replies[0] === MESSAGES.noMiao)
check('⑨ miao 缺失不出图', renderCalls === beforeClosed)
const degradedGlobal = makeEvent({ msg: '#全局圣遗物总榜', groupId: null, isGroup: false })
await app.artisRank(degradedGlobal.e)
check('全局总榜在私聊仍可用（走数据判定而非群限制）', degradedGlobal.replies[0] === MESSAGES.noMiao)

setMiaoAccessor(stubAccessor({ topN: 15 }))
const empty = makeEvent({ msg: '#遗器总榜', groupId: G4, isSr: true })
await app.artisRank(empty.e)
check('无数据回复面板提示', empty.replies[0] === MESSAGES.noData)
const privateGroup = makeEvent({ msg: '#圣遗物总榜', groupId: null, isGroup: false })
await app.artisRank(privateGroup.e)
check('私聊用本群总榜被拦下', privateGroup.replies[0] === MESSAGES.notGroup)

// 成功分支：渲染被桩替换，断言渲染数据与群成员回落口径
const ok = makeEvent({
  msg: '#圣遗物总榜',
  groupId: G1,
  pickMember: (qq) => ({
    getAvatarUrl: async () => `https://avatar.example/${qq}`,
    getInfo: async () => ({ card: `群名片${qq}`, nickname: `昵称${qq}` })
  })
})
await app.artisRank(ok.e)
check('成功分支回复图片段', ok.replies[0]?.type === 'image')
check('成功分支渲染模板为 artisRank/rank', lastRender?.name === 'Axiu-Plugin/artisRank/rank', String(lastRender?.name))
check('渲染数据：标题与范围', lastRender?.data?.title === '圣遗物总榜' && lastRender?.data?.scopeText === '本群')
check('渲染数据：人数与行数', lastRender?.data?.topN === 15 && lastRender?.data?.count === 5)
check('本群范围不显示来源群号', lastRender?.data?.showGid === false)
check('本群优先用群名片与群头像', lastRender?.data?.list?.[0]?.nick === '群名片11111' && lastRender?.data?.list?.[0]?.face === 'https://avatar.example/11111')
check('角色头像前缀指向 miao resources', /miao-plugin[\\/]resources$/.test(String(lastRender?.data?.faceBase)))
check('取不到群成员时保留回落值', lastRender?.data?.list?.find(r => r.uid === '100000006')?.nick === '未知用户')

const srGlobal = makeEvent({ msg: '#星铁全局遗器总榜', groupId: G1, isSr: true })
await app.artisRank(srGlobal.e)
check('星铁全局榜：标题 / 范围 / 显示来源群', lastRender?.data?.title === '遗器总榜' && lastRender?.data?.scopeText === '全局' && lastRender?.data?.showGid === true)
check('星铁全局榜只有星铁行', lastRender?.data?.list?.length === 1 && lastRender?.data?.list?.[0]?.charId === '1205')

/* ==================== 【9】定时任务 ==================== */

console.log('\n【9】排行定时刷新任务')
const refreshApp = new RankRefreshApp()
check('任务注册为箭头函数（框架按 fnc() 调用）', typeof refreshApp.task?.[0]?.fnc === 'function')
check('任务名与 cron 取配置默认值', refreshApp.task[0].name === '排行榜定时刷新' && refreshApp.task[0].cron === '0 40 4 * * ? *')
const built = refreshApp._buildRankEvent('10001', true)
check('e 合成形状：group_id / group / isSr / isMaster / reply / runtime', built.group_id === '10001' && built.isSr === true && built.isMaster === true && typeof built.reply === 'function' && typeof built.runtime === 'object')

let keysCalls = 0
const rawKeys = globalThis.redis.keys
globalThis.redis.keys = async (pattern) => { keysCalls++; return rawKeys(pattern) }
await refreshApp.refreshAll()
check('未启用时任务直接跳过（零 Redis 访问）', keysCalls === 0, `keys 调用 ${keysCalls} 次`)

/* ==================== 【10】配置三层与启用后的刷新 ==================== */

console.log('\n【10】配置三层：面板读 / 保存渲染 / 启用后任务')
const { supportGuoba } = await importMod('guoba/index.js')
const panel = supportGuoba().configInfo
const Result = { ok: (data, msg) => ({ status: 'ok', msg }), error: (msg) => ({ status: 'error', msg }) }
const panelData = panel.getConfigData()
check('面板读到 rankRefresh 三项默认值（默认关闭）', panelData['rankRefresh.enabled'] === false && panelData['rankRefresh.schedule'] === '0 40 4 * * ? *' && panelData['rankRefresh.notifyMaster'] === true)
panelData['rankRefresh.enabled'] = true
const saved = await panel.setConfigData(panelData, { Result })
check('保存成功（defSet 占位符与 TEMPLATE_VARS 一一对应）', saved.status === 'ok', saved.msg)
const writtenText = fs.readFileSync(cfgPath, 'utf8')
const written = YAML.parse(writtenText)
check('渲染回 config.yaml 的 rankRefresh 段可读回', written.rankRefresh?.enabled === true && written.rankRefresh?.schedule === '0 40 4 * * ? *' && written.rankRefresh?.notifyMaster === true)
check('模板占位符没有残留', !writtenText.includes('${'))

setMiaoAccessor(stubAccessor({ available: false }))
const refreshApp2 = new RankRefreshApp()
check('cron 取配置里的 schedule', refreshApp2.task[0].cron === '0 40 4 * * ? *')
let summary = null
refreshApp2._notifyMaster = async (text) => { summary = text }
keysCalls = 0
await refreshApp2.refreshAll()
check('启用后确实执行了（扫过 Axiu 侧排行键）', keysCalls > 0, `keys 调用 ${keysCalls} 次`)
check('miao 缺失时汇总写明未刷 miao 侧', /miao 侧: 未刷新/.test(String(summary)) && /需要 miao-plugin/.test(String(summary)))
check('汇总含耗时与 Axiu 侧重排结果', /耗时: \d/.test(String(summary)) && /Axiu 侧: 成功（原神挑战排行/.test(String(summary)))

finish()
