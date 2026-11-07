/**
 * 终局挑战模板的空值安全（`resources/challenge/**` 的 art-template 模板）
 *
 * 背景：模板里取 `a.b` 时，若 `a` 是 `undefined`，art-template 会直接抛
 * `RuntimeError: Cannot read properties of undefined (reading 'b')`，整条命令失败。
 * 数据层虽对多数集合兜了 `[]`，但「某一幕没有敌人记录」这类合法空值仍会让
 * 形如 `{{display_enemy.icon}}` 的取值崩掉（线上 #剧诗 即此例）。
 *
 * 覆盖口径（渲染即真理，不做启发式扫描）：
 * - 直接用边界数据编译渲染模板：字段缺失 / 集合为空 / 索引越界都不能抛错
 * - 无敌人时「选择敌人」面板不渲染（不留空图标框），其余面板照常
 * - 静态约束：`display_enemy` 的取值必须带 `?.`，且敌人面板必须被 `{{if display_enemy}}` 包裹
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
const mkRound = ({ enemies = [], choiceCards = [], title = '第 1 幕' } = {}) => ({
  is_get_medal: true,
  title,
  finish_time: '2026-01-01 00:00',
  enemies,
  avatars: [{ avatar_id: 10000052, level: 90, avatar_type: 1 }],
  splendour_buff: {
    summary: { total_level: 3, hp_increase: 2400, atk_increase: 150, def_increase: 150, em_increase: 60 },
    buffs: [{ icon: '/meta-gs/buff.webp', level: 2 }]
  },
  choice_cards: choiceCards
})

const mkRoleData = (rounds) => ({
  uid: '100000001',
  difficultyName: { 0: '普通', 1: '困难', 2: '大师', 3: '磨难', 4: '深渊' },
  role: {
    month: 1,
    stat: {
      difficulty_id: 3,
      total_use_time: 600,
      coin_num: 1200,
      avatar_bonus_num: 2,
      rent_cnt: 1,
      get_medal_round_list: [1, 2, 10]
    },
    fightStatCards: [],
    shortestTeam: [],
    rounds
  },
  avatars: { 10000052: { face: '/meta-gs/x/face.webp', level: 90, name: '雷电将军', abbr: '雷神' } }
})

console.log('【1】剧诗模板：有敌人 / 无敌人 / 多幕混合 / 空 rounds 都要渲染成功')
const withEnemy = renderTpl(roleTpl, mkRoleData([mkRound({ enemies: [{ icon: '/meta-gs/enemy.webp' }] })]))
check('有敌人时渲染成功', withEnemy.ok, withEnemy.error)
check('有敌人时渲染出敌人图标', String(withEnemy.html || '').includes('/meta-gs/enemy.webp'))

const noEnemy = renderTpl(roleTpl, mkRoleData([mkRound({ enemies: [] })]))
check('无敌人时渲染成功（修复前抛 Cannot read properties of undefined）', noEnemy.ok, noEnemy.error)
check('无敌人时不出现空的「选择敌人」面板', noEnemy.ok && !noEnemy.html.includes('选择敌人'))
check('无敌人时其余面板照常（辉彩祝福仍在）', noEnemy.ok && noEnemy.html.includes('辉彩祝福'))

const noEnemyField = renderTpl(roleTpl, mkRoleData([(() => {
  const r = mkRound({})
  delete r.enemies // 字段整个缺失
  return r
})()]))
check('enemies 字段缺失时也能渲染', noEnemyField.ok, noEnemyField.error)

const mixed = renderTpl(roleTpl, mkRoleData([
  mkRound({ title: '第 1 幕', enemies: [{ icon: '/meta-gs/enemy.webp' }] }),
  mkRound({ title: '第 2 幕', enemies: [] }),
  mkRound({ title: '圣牌挑战 I', enemies: [], choiceCards: [{ icon: '/meta-gs/card.webp' }] })
]))
check('多幕混合（含无敌人的幕）渲染成功', mixed.ok, mixed.error)
check('混合数据里敌人面板只出现一次', mixed.ok && (mixed.html.match(/选择敌人/g) || []).length === 1)
check('混合数据里神秘收获面板正常', mixed.ok && mixed.html.includes('神秘收获 x 1'))

const emptyRounds = renderTpl(roleTpl, mkRoleData([]))
check('完全没有幕后也能渲染（空 rounds）', emptyRounds.ok, emptyRounds.error)

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

console.log('\n【3】静态约束：display_enemy 必须判空后才取值')
const roleSrc = fs.readFileSync(roleTpl, 'utf8')
check('display_enemy 取值带可选链（不允许裸 display_enemy.icon）',
  !/\{\{\s*display_enemy\.icon/.test(roleSrc) && /\{\{\s*display_enemy\?\.icon/.test(roleSrc))
const guardIdx = roleSrc.indexOf('{{if display_enemy}}')
const panelIdx = roleSrc.indexOf('选择敌人')
const endGuardIdx = roleSrc.indexOf('{{/if}}', guardIdx)
check('敌人面板被 {{if display_enemy}} … {{/if}} 包裹',
  guardIdx >= 0 && panelIdx > guardIdx && endGuardIdx > panelIdx,
  `guard=${guardIdx} panel=${panelIdx} end=${endGuardIdx}`)

finish()