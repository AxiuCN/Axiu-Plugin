/**
 * Axiu-Plugin 回归套件公共设施
 *
 * - 路径推导：任意 cwd 可跑，套件里禁止裸相对字面量与盘符绝对路径
 * - 框架全局桩：logger / redis / segment / Bot（必须在 import 生产模块之前调用）
 * - 断言计数 `checker()` 与「缺前置跳过」`skip()`
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))

/** 插件根目录 */
export const pluginRoot = path.resolve(testDir, '..')
/** bot 根目录（app/）：生产代码里有 './plugins/Axiu-Plugin/...' 这类按 cwd 解析的路径 */
export const appRoot = path.resolve(pluginRoot, '../..')
/** 临时产物目录（.gitignore 已忽略） */
export const tmpDir = path.join(testDir, '.test-tmp')

// 统一 cwd：部分 model 用相对路径读插件内文件，跨 cwd 运行会解析错
try {
  process.chdir(appRoot)
} catch { /* 只读环境忽略 */ }

/** 插件内文件绝对路径 */
export function mod (relPath) {
  return path.join(pluginRoot, relPath)
}

/** 动态 import 插件内模块（避免套件里出现盘符字面量） */
export function importMod (relPath) {
  return import(pathToFileURL(mod(relPath)).href)
}

/** 套件临时文件路径（按需创建目录） */
export function tmpFile (name) {
  fs.mkdirSync(tmpDir, { recursive: true })
  return path.join(tmpDir, name)
}

/** 缺前置：打印跳过并 exit 0（不算失败） */
export function skip (reason) {
  console.log(`⏭ 跳过：${reason}`)
  process.exit(0)
}

/** 前置：插件内文件存在，否则跳过 */
export function requireFile (relPath, label = relPath) {
  if (!fs.existsSync(mod(relPath))) skip(`缺少 ${label}`)
}

/** 框架全局桩：仅内存实现，测试不触真实 Redis / 不联网 */
export function installFrameworkStubs () {
  const noop = () => {}
  globalThis.logger = {
    info: noop, warn: noop, error: noop, mark: noop, debug: noop,
    green: s => s, red: s => s, yellow: s => s
  }

  const store = new Map()
  const toRegex = (p) => new RegExp('^' + String(p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
  globalThis.redis = {
    get: async (k) => (store.has(k) ? store.get(k) : null),
    set: async (k, v) => { store.set(k, String(v)); return 'OK' },
    setEx: async (k, ttl, v) => { store.set(k, String(v)); return 'OK' },
    del: async (...keys) => {
      let n = 0
      for (const k of keys.flat()) if (store.delete(k)) n++
      return n
    },
    keys: async (p) => [...store.keys()].filter(k => toRegex(p).test(k)),
    zAdd: async () => 1,
    expire: async () => 1,
    zRangeWithScores: async () => [],
    zRevRank: async () => null,
    zScore: async () => null,
    zCard: async () => 0
  }

  globalThis.segment = {
    image: (file) => ({ type: 'image', file }),
    at: (qq) => ({ type: 'at', qq })
  }

  globalThis.Bot = {
    uin: '10000',
    pickFriend: () => ({ sendMsg: async () => {} }),
    pickGroup: () => ({ sendMsg: async () => {}, getMemberMap: async () => new Map() })
  }
}

/**
 * 断言计数
 * @returns {{check: (name: string, cond: any, extra?: string) => boolean, finish: () => void}}
 */
export function checker () {
  let pass = 0
  let fail = 0
  return {
    check (name, cond, extra = '') {
      if (cond) {
        pass++
        console.log(`  PASS  ${name}`)
      } else {
        fail++
        console.log(`  FAIL  ${name}${extra ? ` ${extra}` : ''}`)
      }
      return !!cond
    },
    finish () {
      console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
      process.exit(fail ? 1 : 0)
    }
  }
}
