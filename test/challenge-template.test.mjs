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
check('混合数据里神秘收获正常', mixed.ok && mixed.html.includes('神秘收获 * 1'))

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
const mkBoss = (over = {}) => ({
  name: '第一间',
  second: 60,
  monster: { icon: '/meta-gs/monster.webp', level: 110 },
  team: [{ id: 10000052, level: 90, cons: 2 }],
  topHit: { id: 10000052, dps: 123456 },
  topTotal: { id: 10000052, dps: 654321 },
  ...over
})

const mkHardData = (bossOver = {}, hardOver = {}) => ({
  uid: '100000001',
  hard: {
    period: '2026-01-01-2026-01-15',
    modeLabel: '单人模式',
    difficulty: 6,
    difficultyName: '绝境',
    second: 120,
    medal: 'hard-medal-6.png',
    plus: [10000052],
    bosses: [mkBoss(bossOver)],
    ...hardOver
  },
  avatars: { 10000052: { face: '/meta-gs/x/face.webp', level: 90, star: 5, elemIcon: 'elemicon-pyro.png' } }
})

const hardFull = renderTpl(hardTpl, mkHardData())
check('完整数据渲染成功', hardFull.ok, hardFull.error)
// 用统计格标题判定：模板里有同名 HTML 注释，注释会保留在输出里，不能当依据
// 统计格：官方结构里标签是 <span class="tw-font-semibold">最强一击</span>
const hasCell = (r, title) => r.ok && r.html.includes(`>${title}</span>`)
check('完整数据里两个统计格都在', hasCell(hardFull, '最强一击') && hasCell(hardFull, '最高总伤害'))
check('完整数据里渲染出队伍与赋光之人',
  hardFull.ok && hardFull.html.includes('avatar-item') && hardFull.html.includes('plus-role-title'))

const hardNoBest = renderTpl(hardTpl, mkHardData({ topHit: null, topTotal: null }))
check('最强一击/最高总伤害都为空时渲染成功', hardNoBest.ok, hardNoBest.error)
check('两者都为空时不渲染统计行',
  hardNoBest.ok && !hasCell(hardNoBest, '最强一击') && !hasCell(hardNoBest, '最高总伤害'))

const hardOneBest = renderTpl(hardTpl, mkHardData({ topTotal: null }))
check('只有 1 条时渲染成功', hardOneBest.ok, hardOneBest.error)
check('只有 1 条时只渲染最强一击', hasCell(hardOneBest, '最强一击') && !hasCell(hardOneBest, '最高总伤害'))

const hardNoMonster = renderTpl(hardTpl, mkHardData({ monster: { icon: '', level: 0 } }))
check('怪物图标为空时渲染成功且不渲染怪物图', hardNoMonster.ok && !hardNoMonster.html.includes('monster-img'), hardNoMonster.error)

const hardNoTeam = renderTpl(hardTpl, mkHardData({ team: [] }))
check('队伍为空时渲染成功且不渲染角色卡', hardNoTeam.ok && !hardNoTeam.html.includes('avatar-item'), hardNoTeam.error)

const hardEmpty = renderTpl(hardTpl, { uid: '1', hard: { period: '', modeLabel: '', bosses: [] } })
check('bosses 为空、best 缺字段时渲染成功', hardEmpty.ok, hardEmpty.error)

const hardNoPlus = renderTpl(hardTpl, mkHardData({}, { plus: [] }))
check('赋光之人为空时不渲染该区块', hardNoPlus.ok && !hardNoPlus.html.includes('plus-card'), hardNoPlus.error)

/* ==================== 【3】静态约束 ==================== */

console.log('\n【3】静态约束：剧诗敌人图标必须判空后遍历')
const roleSrc = fs.readFileSync(roleTpl, 'utf8')
check('不存在裸取 round.enemies[0] 的写法',
  !/round\.enemies\[0\]/.test(roleSrc) && !/\{\{\s*round\.enemies\.icon/.test(roleSrc))
check('敌人区被 {{if round.enemies && round.enemies.length}} … {{/if}} 包裹',
  /\{\{\s*if round\.enemies && round\.enemies\.length\s*\}\}/.test(roleSrc) &&
  roleSrc.indexOf('round-enemies') > roleSrc.indexOf('{{if round.enemies && round.enemies.length}}'))

check('角色卡取头像前用 avatars[…] || {} 兜底', /\{\{\s*set char = avatars\[member\.id\] \|\| \{\}\s*\}\}/.test(roleSrc))

const hardSrc = fs.readFileSync(hardTpl, 'utf8')
check('怪物图与队伍区都判空后才渲染',
  /\{\{\s*if boss\.monster && boss\.monster\.icon\s*\}\}/.test(hardSrc) &&
  /\{\{\s*if boss\.team && boss\.team\.length\s*\}\}/.test(hardSrc))
check('危战角色卡同样用 avatars[…] || {} 兜底', /\{\{\s*set c = avatars\[m\.id\] \|\| \{\}\s*\}\}/.test(hardSrc))

/* 赋光之人的数据口径：官方取当前期条目的 blings[]，不是 avatars[].is_plus
   （曾按 avatars 取，真实数据里没有该字段，导致赋光区块整段不渲染） */
const querySrc = fs.readFileSync(path.join(pluginRoot, 'modules', 'challenge', 'gsQuery.js'), 'utf8')
check('赋光之人取自当前期条目的 blings[]',
  /const plus = \(raw\.blings \|\| \[\]\)[\s\S]{0,160}\.filter\(b => b\?\.is_plus\)/.test(querySrc))
check('不再从 avatars[].is_plus 取赋光', !/raw\.avatars \|\| md\.avatars/.test(querySrc))
check('赋光头像收集同样走 blings', /for \(const b of \(rawData\.blings \|\| \[\]\)\)/.test(querySrc))

finish()