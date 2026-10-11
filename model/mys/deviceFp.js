/**
 * 设备指纹共享实现 — 通用过码链路（`model/getDeviceFp.js`）与星铁客户端链路（`model/mys/mysSrApi.js`）共用
 *
 * 为什么要合并：两条链路的**流程**完全一样（查 Redis 缓存 → 请求 getFp → 写缓存 → 视 UID 段补发设备注册），
 * 差别只在**策略**。为了不改变任何可观察行为，这里只抽流程，策略全部由调用方注入：
 *
 * | 策略项 | ① 通用过码链路（getDeviceFp.Fp） | ② 星铁客户端链路（mysSrApi._getDeviceFp） |
 * |---|---|---|
 * | 缓存键前缀 | `genshin:device_fp` | `ZZZ:DEVICE_FP` |
 * | 缓存键后缀 | `fp`（小写） | `FP`（大写） |
 * | 失败兜底值 | `null`（拿不到指纹就按没指纹继续） | UID 段决定：`/^(18|[6-9])[0-9]{8}/i` ? `38d805c20d53d` : `38d7f4c72b736` |
 * | 设备注册判据 | `!/^(1[0-9]|[6-9])[0-9]{8}/i` | `!/^(18|[6-9])[0-9]{8}/i` |
 * | URL 来源 | `MysApi.getUrl`（apiTool） | `MysSrApi.getUrl`（srApiTool） |
 * | 注册请求发起方式 | 串行 + 读响应体 + 失败记 error 日志 | 并行 + 不读响应体 + 失败静默 |
 *
 * 为什么这些必须参数化而不是统一成一套：
 * - **键名**：① 的键与 genshin 插件共享（插件按真实 ltuid 写 `:bind` / `:id`），② 的键是本插件私有键；
 *   Redis 键大小写敏感，两侧历史键名必须逐字节保持，否则等于同时丢掉两边的既有缓存。
 * - **兜底**：① 拿不到指纹可以继续过码；② 星铁自身请求必须有指纹，只能用硬编码常量顶上。
 * - **注册判据**：两侧历史判据不一致（`1[0-9]` 与 `18`，见下方 fetchDeviceFp 注释），本次重构**不修**，
 *   原样注入，交给人工决定是否统一。
 * - **注册请求方式**：① 串行等待并按旧实现读响应体、失败记日志，② 并行且静默——网络语义等价但请求时序
 *   与响应体读取是可观察差异，故保留为参数。
 */
import fetch from 'node-fetch'

/** 辅助请求超时（毫秒）。宿主 fetch 为 undici，`timeout` 选项会被静默忽略，统一用 AbortSignal；
 *  与两侧普通请求同口径：指纹接口卡住时按失败处理，不拖住整轮过码 / 查询 */
export const DEVICE_FP_TIMEOUT_MS = 10 * 1000

/** 指纹缓存有效期（秒）——7 天 */
const FP_CACHE_TTL = 86400 * 7

/**
 * 拉取设备指纹：命中缓存直接返回；未命中则请求 getFp，成功后写缓存并按需补发设备注册
 *
 * @param {object} opts
 * @param {string} opts.uid 游戏 UID（设备注册判据用；① 还会用它给请求补 role_id）
 * @param {string} opts.ltuid 米游社账号 ID（指纹缓存键用）
 * @param {object|function} opts.data 请求参数；传函数时在**缓存未命中之后**才求值
 *   （① 的参数来自 genshin 插件写的 `:bind`，命中缓存时本就不该多读一次 Redis）
 * @param {string} opts.keyPrefix 缓存键前缀（① `genshin:device_fp`、② `ZZZ:DEVICE_FP`）
 * @param {string} [opts.keySuffix='FP'] 缓存键后缀（Redis 键大小写敏感，① `fp`、② `FP` 都要逐字节保持）
 * @param {string|null} [opts.fallback=null] 指纹请求失败（网络或响应体阶段）时的兜底值
 * @param {(uid: string) => boolean} opts.needRegister 是否需要补发设备注册（两侧判据不同，由调用方注入）
 * @param {(type: string, data: object) => object|false} opts.getUrl 取 URL 的函数（各自 apiTool 的封装）
 * @param {'serial'|'parallel'} [opts.registerMode='serial'] 设备注册两个请求的发起方式
 * @param {((error: Error) => void)|null} [opts.onRegisterError=null] 设备注册失败回调（① 记日志、② 静默）
 * @returns {Promise<{deviceFp: string|null}>}
 */
export async function fetchDeviceFp ({
  uid,
  ltuid,
  data = {},
  keyPrefix,
  keySuffix = 'FP',
  fallback = null,
  needRegister,
  getUrl,
  registerMode = 'serial',
  onRegisterError = null
}) {
  const fpKey = `${keyPrefix}:${ltuid}:${keySuffix}`

  const cached = await redis.get(fpKey)
  if (cached) return { deviceFp: cached }

  const reqData = typeof data === 'function' ? await data() : data

  const sdk = getUrl('getFp', reqData)
  // ① 原实现没有这层判断（取不到就靠 `sdk.url` 抛错落到下面的 catch），结果同样是「没拿到指纹」，显式短路不改变行为
  if (!sdk) return { deviceFp: null }

  let deviceFp
  try {
    // 响应体读取也在 try 内：signal 覆盖整轮请求（含响应体阶段），只包 fetch 的话响应头先到、
    // 体阶段超时仍会抛穿，绕开下面的兜底
    const res = await fetch(sdk.url, {
      headers: sdk.headers,
      method: 'POST',
      body: sdk.body,
      signal: AbortSignal.timeout(DEVICE_FP_TIMEOUT_MS)
    })
    deviceFp = (await res.json())?.data?.device_fp
  } catch {
    // 网络失败 / 响应体阶段失败：按调用方的兜底策略返回（① 为 null，② 为硬编码常量）
    return { deviceFp: fallback }
  }
  if (!deviceFp) return { deviceFp: null }

  await redis.set(fpKey, deviceFp, { EX: FP_CACHE_TTL })

  if (needRegister(uid)) {
    reqData.deviceFp = deviceFp
    const deviceLogin = getUrl('deviceLogin', reqData)
    const saveDevice = getUrl('saveDevice', reqData)
    if (deviceLogin && saveDevice) {
      const requestLogin = () => fetch(deviceLogin.url, {
        headers: deviceLogin.headers,
        method: 'POST',
        body: deviceLogin.body,
        signal: AbortSignal.timeout(DEVICE_FP_TIMEOUT_MS)
      })
      const requestSave = () => fetch(saveDevice.url, {
        headers: saveDevice.headers,
        method: 'POST',
        body: saveDevice.body,
        signal: AbortSignal.timeout(DEVICE_FP_TIMEOUT_MS)
      })
      try {
        if (registerMode === 'parallel') {
          // ② 原实现：两个请求并行，不读响应体
          await Promise.all([requestLogin(), requestSave()])
        } else {
          // ① 原实现：先 await deviceLogin，再 await saveDevice，最后一起读响应体
          const login = await requestLogin()
          const save = await requestSave()
          await Promise.all([login.json(), save.json()])
        }
      } catch (error) {
        // 设备注册非关键：失败只按调用方策略处理（① 记 error 日志、② 静默）
        onRegisterError?.(error)
      }
    }
  }

  return { deviceFp }
}
