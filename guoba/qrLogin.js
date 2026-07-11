/** 扫码登录配置模块 — schema + 默认值 */

export function getSchema () {
  return [
    { label: '扫码登录', component: 'SOFT_GROUP_BEGIN' },
    {
      field: 'api.qrLogin_enabled',
      label: '启用扫码登录',
      bottomHelpMessage: '开启后可使用 #扫码登录、#刷新ck、#更新抽卡记录 命令',
      component: 'Switch'
    }
  ]
}
