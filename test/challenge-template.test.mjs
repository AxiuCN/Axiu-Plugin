/**
 * 终局挑战模板的空值安全（`resources/challenge/**` 的 art-template 模板）
 *
 * 背景：模板里取 `a.b` 时，若 `a` 是 `undefined`，art-template 会直接抛
 * `RuntimeError: Cannot read properties of undefined (reading 'b')`，整条命令失败。
 * 数据层虽对多数集合兜了 `[]`，但「某一幕没有敌人记录」这类合法空值曾让
 * `{{display_enemy.icon}}` 崩掉（线上 #剧诗 即此例），因此模板一律先判空再取值。
 *
 * 覆盖口径（渲染即真理，不做启发式扫描）：
 * - 直接用边界数据编译渲染模板：字段缺失 / 集合为空 / 索引越界都不能抛错
 * - 剧诗：无敌人时不渲染敌人图标区，其余区块照常；辉彩祝福/队伍/神秘收获缺数据时整块不渲染
 * - 危战：最强一击 / 最高总伤害 / 怪物信息缺失时不能崩
 * - 静态约束：`round.enemies` 必须判空后遍历，不得裸取 `round.enemies[0]`
 *
 * 不联网、不出图：只做 art-template 编译。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { appRoot, checker, pluginRoot } from './_helper.mjs'

const { check, finish } = checker()

/** art-template 取自 bot 根依赖（与生产同一份） */
const require = createRequire(path.join(appRoot, 'package.json'))
const tplModule = require('art-template')
const template = tplModule.default || tplModule

const resRoot = path.join(pluginRoot, 'resources', 'challenge')
const roleTpl = path.join(resRoot, 'GS', 'role.html')
const hardTpl = path.join(resRoot, 'GS', 'hard.html')

/** 编译并渲染；返回 { ok, html, error } */
const renderTpl = (file, data) => {
  try {
    const src = fs.readFileSync(file, 'utf8')
    const html = template.compile(src, { filename: file, cache: false })({
      _res_path: path.join(pluginRoot, 'resources').replace(/\\/g, '/'),
      pluResPath: path.join(pluginRoot, 'resources').replace(/\\/g, '/') + '/',
      defaultLayout: path.join(pluginRoot, 'resources', 'common', 'layout', 'default.html'),
      sys: { copyright: 'test' },
      ...data
    })
    return { ok: true, html }
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) }
  }
}

/* ==================== 【1】剧诗（GS/role.html） ==================== */

/** 造一幕剧诗数据（字段与 modules/challenge/gsQuery.js → buildRoleData 一致） */
const mkRound = ({ enemies = ['/meta-gs/enemy.webp'], title = '第 1 幕', medal = true, choiceCards = [], team, buffs, buffLevel = 3 } = {}) => ({
  medal,
  title,
  time: '2026.01.01 00:00:00',
  enemies,
  team: team ?? [{ id: 10000052, level: 90, type: 1, tag: '' }],
  buffLevel,
  buffDesc: '生命值上限提高 2400 点',
  buffs: buffs ?? [{ icon: '/meta-gs/buff.webp', level: 2 }],
  choices: choiceCards
})

const mkRoleData = (rounds) => ({
  uid: '100000001',
  role: {
    period: '2026.01.01-2026.01.15',
    difficulty: '困难',
    best: { round: 8, total: 10, heraldry: 3 },
    stat: { coin: 1200, bonus: 2, rent: 1 },
    medals: [true, false],
    fightStats: [{ title: '最高伤害输出', id: 10000052, value: 123456 }],
    fastest: [10000052],
    rounds
  },
  avatars: {
    10000052: { face: '/meta-gs/x/face.webp', level: 90, star: 5, elemIcon: 'elem-fire.png' }
  }
})

console.log('【1】剧诗模板：有敌人 / 无敌人 / 多幕混合 / 空 rounds 都要渲染成功')
const withEnemy = renderTpl(roleTpl, mkRoleData([mkRound()]))
check('有敌人时渲染成功', withEnemy.ok, withEnemy.error)
check('有敌人时渲染出敌人图标', String(withEnemy.html || '').includes('/meta-gs/enemy.webp'))
check('有敌人时渲染出敌人图标容器', String(withEnemy.html || '').includes('round-enemies'))

const noEnemy = renderTpl(roleTpl, mkRoleData([mkRound({ enemies: [] })]))
check('无敌人时渲染成功（修复前抛 Cannot read properties of undefined）', noEnemy.ok, noEnemy.error)
check('无敌人时不渲染敌人图标容器', noEnemy.ok && !noEnemy.html.includes('round-enemies'))
check('无敌人时其余区块照常（辉彩祝福仍在）', noEnemy.ok && noEnemy.html.includes('辉彩祝福'))

const noEnemyField = renderTpl(roleTpl, mkRoleData([(() => {
  const r = mkRound({})
  delete r.enemies // 字段整个缺失
  return r
})()]))
check('enemies 字段缺失时也能渲染', noEnemyField.ok, noEnemyField.error)

const mixed = renderTpl(roleTpl, mkRoleData([
  mkRound({ title: '第 1 幕' }),
  mkRound({ title: '第 2 幕', enemies: [] }),
  mkRound({ title: '圣牌挑战 I', enemies: [], choiceCards: [{ icon: '/meta-gs/card.webp' }] })
]))
check('多幕混合（含无敌人的幕）渲染成功', mixed.ok, mixed.error)
check('混合数据里敌人图标容器只出现一次', mixed.ok && (mixed.html.match(/round-enemies/g) || []).length === 1)
check('混合数据里神秘收获正常', mixed.ok && mixed.html.includes('神秘收获 · 1'))

const emptyRounds = renderTpl(roleTpl, mkRoleData([]))
check('完全没有幕后也能渲染（空 rounds）', emptyRounds.ok, emptyRounds.error)

const noTeam = renderTpl(roleTpl, mkRoleData([mkRound({ team: [] })]))
check('队伍为空时渲染成功且不渲染队伍区', noTeam.ok && !noTeam.html.includes('round-team'), noTeam.error)

const noBuff = renderTpl(roleTpl, mkRoleData([mkRound({ buffs: [], buffLevel: 0 })]))
check('辉彩祝福无数据时整块不渲染', noBuff.ok && !noBuff.html.includes('辉彩祝福'), noBuff.error)

const noFight = renderTpl(roleTpl, mkRoleData([mkRound()]))
check('战斗统计照常渲染', noFight.ok && noFight.html.includes('最高伤害输出'))

/* ==================== 【2】危战（GS/hard.html） ==================== */

console.log('\n【2】危战模板：最强一击 / 最高总伤害 / 怪物信息缺失时不能崩')
const mkHardData = (challOver = {}) => ({
  uid: '100000001',
  hard: {
    start_time: '2026-01-01',
    end_time: '2026-01-15',
    best: { difficulty: 5, second: 120 },
    challs: [{
      name: '第一间',
      second: 60,
      monster: { icon: '/meta-gs/monster.webp', level: 103, desc: ['测试描述'] },
      avatars: [{ avatar_id: 10000052, name: '雷电将军', level: 90, rarity: 5, cons: 2 }],
      best_avatars: [{ avatar_id: 10000052, dps: 123456 }, { avatar_id: 10000052, dps: 654321 }],
      ...challOver
    }]
  },
  avatars: { 10000052: { face: '/meta-gs/x/face.webp', level: 90, name: '雷电将军', abbr: '雷神', cons: 2 } }
})
const hardFull = renderTpl(hardTpl, mkHardData())
check('完整数据渲染成功', hardFull.ok, hardFull.error)
// 用面板标题元素判定：模板里有同名 HTML 注释，注释会保留在输出里，不能当依据
const hasPanel = (r, title) => r.ok && r.html.includes(`stat-panel-title">${title}`)
check('完整数据里两个统计面板都在', hasPanel(hardFull, '最强一击') && hasPanel(hardFull, '最高总伤害'))

const hardNoBest = renderTpl(hardTpl, mkHardData({ best_avatars: [] }))
check('best_avatars 为空时渲染成功（索引越界）', hardNoBest.ok, hardNoBest.error)
check('best_avatars 为空时不渲染统计面板',
  hardNoBest.ok && !hasPanel(hardNoBest, '最强一击') && !hasPanel(hardNoBest, '最高总伤害'))

const hardOneBest = renderTpl(hardTpl, mkHardData({ best_avatars: [{ avatar_id: 10000052, dps: 1 }] }))
check('best_avatars 只有 1 条时渲染成功', hardOneBest.ok, hardOneBest.error)
check('只有 1 条时只渲染最强一击',
  hasPanel(hardOneBest, '最强一击') && !hasPanel(hardOneBest, '最高总伤害'))

const hardNoMonster = renderTpl(hardTpl, mkHardData({ monster: { icon: '', level: 0, desc: [] } }))
check('怪物图标与描述都为空时渲染成功', hardNoMonster.ok, hardNoMonster.error)

const hardEmpty = renderTpl(hardTpl, { uid: '1', hard: { start_time: '', end_time: '', best: {}, challs: [] } })
check('challs 为空、best 缺字段时渲染成功', hardEmpty.ok, hardEmpty.error)

/* ==================== 【3】静态约束 ==================== */

console.log('\n【3】静态约束：剧诗敌人图标必须判空后遍历')
const roleSrc = fs.readFileSync(roleTpl, 'utf8')
check('不存在裸取 round.enemies[0] 的写法',
  !/round\.enemies\[0\]/.test(roleSrc) && !/\{\{\s*round\.enemies\.icon/.test(roleSrc))
check('敌人区被 {{if round.enemies && round.enemies.length}} … {{/if}} 包裹',
  /\{\{\s*if round\.enemies && round\.enemies\.length\s*\}\}/.test(roleSrc) &&
  roleSrc.indexOf('round-enemies') > roleSrc.indexOf('{{if round.enemies && round.enemies.length}}'))

check('角色卡取头像前用 avatars[…] || {} 兜底', /\{\{\s*set char = avatars\[member\.id\] \|\| \{\}\s*\}\}/.test(roleSrc))

finish()