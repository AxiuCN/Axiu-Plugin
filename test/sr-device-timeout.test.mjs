/**
 * 星铁设备初始化请求的超时（model/mys/mysSrApi.js）
 *
 * 覆盖：冷缓存时设备指纹（getFp）与设备注册（deviceLogin / saveDevice）三个辅助请求
 * 是否与普通请求同口径携带可取消的超时——原实现无 signal，慢响应会把整轮查询拖住
 * （第三轮 P2-7）
 *
 * fetch 用桩替换：辅助请求在无 signal 时永不返回（复刻无超时），有 signal 时视为已中止
 *
 * **本套件证明了什么、不证明什么**：它断言的是「辅助请求都带上可取消信号，缺信号的桩会把用例挂住」，
 * **不**等待真实的 10 秒超时，也**不**逐个验证 getFp / deviceLogin / saveDevice 各自的行为
 * （第四轮复审实测的请求序：冷缓存 `getFp→getFp→getFp→srNote`、热缓存 `getFp→srNote`）。
 * 真实的响应头 / 响应体阶段超时行为在第四轮 #8、#9 里单独跟踪。
 */
import { importMod, installFrameworkStubs, skip, checker } from './_helper.mjs'

const AUX_RE = /device-fp\/api\/getFp|apihub\/api\/deviceLogin|apihub\/api\/saveDevice/
const calls = []

// 必须在 import mysSrApi 之前替换：框架的 node-fetch shim 在求值时绑定 global.fetch
globalThis.fetch = (url, options = {}) => {
  const target = String(url)
  const aux = AUX_RE.test(target)
  calls.push({ url: target, aux, hasSignal: !!options.signal })
  if (aux) {
    if (!options.signal) return new Promise(() => {}) // 无超时 → 永不返回
    const err = new Error('The operation was aborted')
    err.name = 'AbortError'
    return Promise.reject(err)
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => (bodyFail
      ? Promise.reject(new Error('body aborted'))
      : Promise.resolve({ retcode: 0, message: 'OK', data: {} }))
  })
}
let bodyFail = false

const store = installFrameworkStubs()

let MysSrApi
try {
  ({ default: MysSrApi } = await importMod('model/mys/mysSrApi.js'))
} catch (err) {
  skip(`无法加载 mysSrApi（缺少 genshin 插件或依赖）：${err.message}`)
}

const { check, finish } = checker()

const UID = '100000001'
const LTUID = '90000001'
const COOKIE = `ltuid=${LTUID};ltoken=x;cookie_token=y;account_id=${LTUID};`
const TIMEOUT = Symbol('timeout')
const raceGetData = (api, ms = 800) => Promise.race([
  api.getData('srNote', {}),
  new Promise(resolve => setTimeout(() => resolve(TIMEOUT), ms))
])

console.log('=== 冷缓存：辅助请求必须自带超时，且查询能在窗口内结束 ===')
let coldCallCount = 0
{
  calls.length = 0
  const api = new MysSrApi(UID, COOKIE, { log: false })
  const started = Date.now()
  const result = await raceGetData(api)
  const aux = calls.filter(c => c.aux)
  const normal = calls.filter(c => !c.aux)
  coldCallCount = calls.length
  console.log(`  请求序列: ${calls.map(c => `${c.aux ? '辅助' : '普通'}${c.hasSignal ? '✓超时' : '✗无超时'}`).join(' → ')}`)
  check('冷缓存下确实发起了辅助（设备指纹）请求', aux.length > 0, `实际 ${aux.length}`)
  check('辅助请求全部携带超时信号（修复前为无 signal）', aux.length > 0 && aux.every(c => c.hasSignal))
  check('普通请求仍携带超时信号', normal.length > 0 && normal.every(c => c.hasSignal))
  check('getData 在超时窗口内结束，未被无超时的辅助请求拖住', result !== TIMEOUT, `${Date.now() - started}ms`)
  check('普通请求正常返回', result !== TIMEOUT && result?.retcode === 0, JSON.stringify(result))
}

console.log('=== 回归：指纹缓存命中时辅助请求减少，且全部仍带超时 ===')
{
  calls.length = 0
  store.strings.set(`ZZZ:DEVICE_FP:${LTUID}:FP`, 'cached-device-fp')
  const api = new MysSrApi(UID, COOKIE, { log: false })
  const result = await raceGetData(api)
  console.log(`  请求序列: ${calls.map(c => `${c.aux ? '辅助' : '普通'}${c.hasSignal ? '✓超时' : '✗无超时'}`).join(' → ') || '(无)'}`)
  check('缓存命中：请求数较冷缓存减少', calls.length > 0 && calls.length < coldCallCount, `${calls.length} vs ${coldCallCount}`)
  check('缓存命中：所有请求仍带超时信号', calls.every(c => c.hasSignal))
  check('缓存命中：查询正常返回', result !== TIMEOUT && result?.retcode === 0, JSON.stringify(result))
}

console.log('=== #8 响应体阶段失败也走兜底指纹（不再抛穿）===')
{
  bodyFail = true
  calls.length = 0
  store.strings.clear()
  const api = new MysSrApi(UID, COOKIE, { log: false })
  let out = null
  let threw = null
  try {
    out = await api._getDeviceFp(LTUID, {})
  } catch (err) {
    threw = err
  }
  bodyFail = false
  console.log(`  返回值: ${threw ? `抛错 ${threw.message}` : JSON.stringify(out)}`)
  check('响应体读取失败时返回兜底指纹而非抛错', !threw && !!out?.deviceFp, threw ? String(threw) : JSON.stringify(out))
  check('该请求仍带超时信号', calls.length > 0 && calls.every(c => c.hasSignal), `请求数 ${calls.length}`)
}

finish()
