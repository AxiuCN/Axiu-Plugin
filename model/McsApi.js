/**
 * MCSManager 面板 HTTP API 封装
 * 仅负责调用 MCS 重启接口，不关心凭证来源或回退逻辑
 */

/**
 * 调用 MCSManager 重启接口
 * @param {object} params
 * @param {string} params.host - 面板地址
 * @param {number} params.port - 面板端口
 * @param {string} params.apiKey - API Key
 * @param {string} params.instanceUuid - 实例 UUID
 * @param {string} params.daemonId - 守护进程 ID
 * @returns {Promise<{success: boolean, status?: number, error?: string}>}
 */
export async function restartInstance({ host, port, apiKey, instanceUuid, daemonId }) {
  const query = new URLSearchParams({
    uuid: instanceUuid,
    daemonId,
    apikey: apiKey
  })

  const url = `http://${host}:${port}/api/protected_instance/restart?${query}`

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json; charset=utf-8'
      }
    })

    const body = await res.json().catch(() => null)
    const status = body?.status ?? res.status

    if (status === 200) {
      return { success: true, status }
    }
    return { success: false, status, error: `MCS 返回状态码 ${status}` }

  } catch (err) {
    return { success: false, error: err.message }
  }
}
