/** 按 key 串行化的进程内异步队列
 *
 *  用于「读 → 改 → 写」共享存储的原子化：同一 key 的任务按调用顺序依次执行，
 *  不同 key 互不阻塞。单进程内即可避免并发读改写丢更新（跨进程需改用 Redis 原子操作）。
 */

/** key → 当前队尾 Promise */
const chains = new Map()

/**
 * 串行执行：同一 key 的任务依次执行，前一个失败不影响后一个
 * @param {string} key - 队列标识（通常直接用被读写的 Redis 键）
 * @param {function(): Promise<any>} fn - 待执行任务
 * @returns {Promise<any>} 本任务的执行结果（本任务异常原样抛出）
 */
export function withKeyLock (key, fn) {
  const prev = chains.get(key) || Promise.resolve()
  // 前一个任务失败也继续（其异常已由它自己的调用方处理）
  const run = prev.then(fn, fn)
  // 队尾吞掉异常，避免后续任务被拒绝；run 本身仍原样返回给调用方
  const tail = run.then(() => {}, () => {})
  chains.set(key, tail)
  tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key)
  })
  return run
}

export default { withKeyLock }
