/** 星铁终局挑战配置模块 — schema + 默认值 */

export function getSchema () {
  return [
    { label: '终局挑战', component: 'SOFT_GROUP_BEGIN' },
    {
      field: 'srChallenge.enabled',
      label: '启用终局挑战查询',
      bottomHelpMessage: '开启后可使用 *末日、*虚构、*混沌、*仲裁、*深渊 等命令',
      component: 'Switch'
    }
  ]
}
