/**
 * 批量刷新 Cookie 的汇总口径与报告渲染（modules/mysSignin/signinManager.js）
 *
 * 覆盖：部分成功用户的失败明细不被丢弃、三档统计、报告渲染、边界（全成功 / 无用户）
 * 背景：第三轮 P2-4 —— 只要有一个账号刷新成功就返回 ok:true，
 *       批量汇总的 `if (ok) … else if (failed)` 互斥分支会把其余账号的失败（含
 *       「sk 已失效，已自动删除签到配置」）整体丢掉，报告显示 0 失败
 */
import { importMod, installFrameworkStubs, checker } from './_helper.mjs'

installFrameworkStubs()

const { summarizeCookieRefresh, buildRefreshReport } = await importMod('modules/mysSignin/signinManager.js')
const { check, finish } = checker()

const DELETED_HINT = 'sk 已失效，已自动删除签到配置，请重新扫码绑定后重新【#注册自动签到】'

// A 全部成功；B 部分成功（账号1 成功、账号2 失效并已删除配置）；C 全部失败
const results = [
  { userId: '10001', ok: true, failed: [] },
  { userId: '10002', ok: true, failed: [{ n: 2, reason: DELETED_HINT }] },
  { userId: 'wxid_abc', ok: false, failed: [{ n: 1, reason: 'cookie 刷新失败' }] }
]

console.log('=== summarizeCookieRefresh ===')
const summary = summarizeCookieRefresh(results)
console.log(`  ${JSON.stringify({ total: summary.total, success: summary.success, partial: summary.partial, fullFail: summary.fullFail })}`)
check('总户数 3', summary.total === 3)
check('全部成功 1 户', summary.success === 1, `实际 ${summary.success}`)
check('部分成功 1 户', summary.partial === 1, `实际 ${summary.partial}`)
check('全部失败 1 户', summary.fullFail === 1, `实际 ${summary.fullFail}`)
check('部分成功用户的失败账号仍进入明细（修复前被丢弃）', summary.failedUsers.some(u => u.userId === '10002'))
check('明细保留失效删除与恢复提示', summary.failedUsers.some(u => (u.failed || []).some(f => f.reason === DELETED_HINT)))
check('全部失败用户标记 ok=false', summary.failedUsers.find(u => u.userId === 'wxid_abc')?.ok === false)
check('成功用户不进入明细', !summary.failedUsers.some(u => u.userId === '10001'))

// 对照：旧口径（只看 ok）会把 B 的失败明细吞掉，证明该断言可失败
const legacyFailedUsers = results.filter(r => !r.ok).length
check('对照：旧口径仅 1 户明细，新口径 2 户', summary.failedUsers.length === 2 && legacyFailedUsers === 1,
  `新 ${summary.failedUsers.length} / 旧 ${legacyFailedUsers}`)

console.log('=== buildRefreshReport ===')
const { header, failedUsers } = buildRefreshReport(summary)
console.log(header.split('\n').map(l => '  ' + l).join('\n'))
console.log(`  明细: ${JSON.stringify(failedUsers)}`)
check('报告头三档统计齐全', header.includes('全部成功: 1/3') && header.includes('部分成功: 1/3') && header.includes('失败: 1/3'))
check('报告列出部分成功用户的失败账号', failedUsers.some(u => u.qq === '10002' && u.lines.join(' ').includes('已自动删除签到配置')))
check('部分成功用户带标注', failedUsers.find(u => u.qq === '10002')?.lines?.[0] === '（部分账号刷新成功）')
check('全部失败用户无标注', failedUsers.find(u => u.qq === 'wxid_abc')?.lines?.[0] !== '（部分账号刷新成功）')

console.log('=== 边界 ===')
{
  const allOk = summarizeCookieRefresh([
    { userId: '1', ok: true, failed: [] },
    { userId: '2', ok: true, failed: [] }
  ])
  const r = buildRefreshReport(allOk)
  check('全部成功：成功 2/2 且不出现部分成功/失败行',
    r.header.includes('全部成功: 2/2') && !r.header.includes('部分成功') && !r.header.includes('失败:'),
    r.header.replace(/\n/g, ' | '))
  check('全部成功：无失败明细', r.failedUsers.length === 0)
}
{
  const allFail = summarizeCookieRefresh([{ userId: '1', ok: false, failed: [{ n: 1, reason: '网络异常' }] }])
  check('全部失败：成功 0、失败 1', allFail.success === 0 && allFail.fullFail === 1 && allFail.partial === 0)
  check('空输入返回全 0', (() => {
    const e = summarizeCookieRefresh([])
    return e.total === 0 && e.success === 0 && e.partial === 0 && e.fullFail === 0 && e.failedUsers.length === 0
  })())
  check('无用户时报告提示未执行', buildRefreshReport({ total: 0 }).header.includes('无已注册用户'))
}

finish()
