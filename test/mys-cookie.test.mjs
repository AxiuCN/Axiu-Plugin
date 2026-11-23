/**
 * 米游社 v2 cookie 组装（`components/mysCookie.js`）
 *
 * 扫码登录、`#刷新ck`、签到刷新、星铁 CK 刷新四条链必须产出同一种凭据格式：
 * 全 v2 字段 + 同值的旧别名（插件内部与 genshin 侧仍按 `ltuid` / `account_id` 解析）。
 * 各链自己拼会漂移——合入前 `qrLogin` 用扫码响应的 aid、`qrUser` 用 `sk.stuid || e.stuid`，
 * 就是这么出现的分歧。
 */
import fs from 'node:fs'
import path from 'node:path'
import { checker, importMod, pluginRoot } from './_helper.mjs'

const { buildV2Cookie } = await importMod('components/mysCookie.js')
const { check, finish } = checker()

console.log('=== 字段与顺序 ===')
{
  const cookie = buildV2Cookie({ stuid: '123', mid: 'm9', ltoken: 'LT', cookieToken: 'CK' })
  check('v2 字段在前、旧别名在后，逐字段固定',
    cookie === 'account_id_v2=123;account_mid_v2=m9;cookie_token_v2=CK;ltmid_v2=m9;ltoken_v2=LT;' +
      'ltuid_v2=123;account_id=123;ltuid=123;mid=m9;ltoken=LT;cookie_token=CK;',
    cookie)
  check('以 ; 结尾（下游按 `;` 切分解析）', cookie.endsWith(';'), cookie)
  check('唯一一份 v2 值同时挂在旧名下，不出现两套不同值',
    cookie.split('ltoken=').length === 2 && cookie.includes('ltoken=LT;') && cookie.includes('ltoken_v2=LT;'), cookie)
}

console.log('=== mid 缺失（早期条目） ===')
{
  const cookie = buildV2Cookie({ stuid: 123, ltoken: 'LT', cookieToken: 'CK' })
  check('mid 系字段整体省略，不留空值', !/mid/i.test(cookie), cookie)
  check('stuid 接受数字', cookie.startsWith('account_id_v2=123;') && cookie.includes(';ltuid=123;'), cookie)
}

console.log('=== 调用点必须复用组件（静态约束） ===')
{
  const callers = [
    'model/qrLogin.js',
    'model/qrUser.js',
    'apps/qrLogin.js',
    'apps/srGachaLog.js',
    'model/mys/mysSrApi.js',
    'modules/mysSignin/signinManager.js'
  ]
  const missing = callers.filter(rel => !/buildV2Cookie/.test(fs.readFileSync(path.join(pluginRoot, rel), 'utf8')))
  check('六个调用点都引用 buildV2Cookie', missing.length === 0, missing.join(','))

  const dirs = ['apps', 'model', 'modules', 'components', 'guoba']
  const walk = dir => fs.readdirSync(path.join(pluginRoot, dir), { withFileTypes: true })
    .flatMap(d => (d.isDirectory()
      ? walk(path.join(dir, d.name))
      : (d.name.endsWith('.js') ? [path.join(dir, d.name)] : [])))
  const self = path.join('components', 'mysCookie.js')
  const handWritten = dirs.flatMap(walk)
    .filter(rel => rel !== self && fs.readFileSync(path.join(pluginRoot, rel), 'utf8').includes('account_id_v2='))
  check('仓库内不再有手写的 v2 cookie 拼串', handWritten.length === 0, handWritten.join(','))
}

finish()