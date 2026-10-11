/**
 * 通用过码链路的设备指纹（model/getDeviceFp.js，第四轮 #9 / #12）
 *
 * 覆盖：
 * - 指纹缓存键用 cookie 里的 ltuid：字符串形态传入时不再落到 `undefined` 键（第四轮 #12）
 * - `getFp` 请求自带超时；网络失败 / 响应体阶段失败都按「没拿到指纹」返回，不向上抛
 *   （原实现连 try 都没有，异常会一路冲断整轮过码，第四轮 #9）
 * - 设备注册（deviceLogin / saveDevice）两个请求同样带超时
 *
 * fetch 用桩替换：框架的 node-fetch shim 是 `export default global.fetch`（模块求值时就绑定），
 * 必须在 import 之前替换。
 */
import { importMod, installFrameworkStubs, checker } from './_helper.mjs'

const calls = []
let failMode = '' // '' | 'reject' | 'body'
globalThis.fetch = (url, options = {}) => {
  calls.push({ url: String(url), hasSignal: !!options.signal })
  if (failMode === 'reject') {
    const err = new Error('The operation was aborted')
    err.name = 'AbortError'
    return Promise.reject(err)
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => (failMode === 'body'
      ? Promise.reject(new Error('body aborted'))
      : Promise.resolve({ retcode: 0, message: 'OK', data: { device_fp: 'FP-NEW' } }))
  })
}

const store = installFrameworkStubs()
const { default: getDeviceFp } = await importMod('model/getDeviceFp.js')
const { check, finish } = checker()

const UID = '100000001'
/** 会走设备注册分支的 UID（不以 1x / 6-9 开头） */
const UID_OVERSEA = '200000001'
const LTUID = '90000001'
const COOKIE = `ltuid=${LTUID};ltoken=x;cookie_token=y;account_id=${LTUID};`
const GAME = { game: 'gs', log: false }

console.log('=== #12 指纹缓存键用 cookie 里的 ltuid ===')
{
  calls.length = 0
  failMode = ''
  store.strings.set(`genshin:device_fp:${LTUID}:fp`, 'FP-CACHED')
  const res = await getDeviceFp.Fp(UID, COOKIE, GAME)
  check('按 cookie 里的 ltuid 命中缓存（旧实现用 undefined 键，会去发请求）',
    res?.deviceFp === 'FP-CACHED' && calls.length === 0, `${res?.deviceFp} / 请求数 ${calls.length}`)

  calls.length = 0
  store.strings.delete?.(`genshin:device_fp:${LTUID}:fp`)
  store.strings.clear()
  const res2 = await getDeviceFp.Fp(UID, COOKIE, GAME)
  check('缓存未命中时取到指纹并写回 ltuid 键',
    res2?.deviceFp === 'FP-NEW' && store.strings.has(`genshin:device_fp:${LTUID}:fp`),
    `${res2?.deviceFp} / keys=${[...store.strings.keys()].join(',')}`)
  check('getFp 请求自带超时信号', calls.length > 0 && calls.every(c => c.hasSignal), JSON.stringify(calls))
}

console.log('=== #9 失败不抛穿（网络 / 响应体阶段）===')
{
  // 清掉上一节写进去的指纹缓存，否则会命中缓存、走不到 fetch
  store.strings.clear()
  calls.length = 0
  failMode = 'reject'
  const res = await getDeviceFp.Fp(UID, COOKIE, GAME)
  check('网络失败 → 返回 {deviceFp:null}，不向上抛', res?.deviceFp === null, JSON.stringify(res))

  calls.length = 0
  failMode = 'body'
  const res2 = await getDeviceFp.Fp(UID, COOKIE, GAME)
  check('响应体阶段失败 → 同样返回 {deviceFp:null}', res2?.deviceFp === null, JSON.stringify(res2))
  failMode = ''
}

console.log('=== 设备注册请求也带超时 ===')
{
  calls.length = 0
  store.strings.clear()
  const res = await getDeviceFp.Fp(UID_OVERSEA, COOKIE, GAME)
  console.log(`  请求序列: ${calls.map(c => `${c.hasSignal ? '✓超时' : '✗无超时'}`).join(' → ')}`)
  check('取到指纹', res?.deviceFp === 'FP-NEW', JSON.stringify(res))
  check('三个请求（getFp / deviceLogin / saveDevice）全部带超时',
    calls.length >= 3 && calls.every(c => c.hasSignal), `请求数 ${calls.length}`)
}

finish()
