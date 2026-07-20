/** 星铁终局挑战配置模块 — schema + 默认值 */

export function getSchema () {
  return [
    { label: '终局挑战', component: 'SOFT_GROUP_BEGIN' },
    {
      field: 'srChallenge.enabled',
      label: '启用终局挑战查询',
      bottomHelpMessage: '开启后可使用 *末日、*虚构、*混沌、*仲裁、*深渊 等命令',
      component: 'Switch'
    },
    { label: '挑战排行', component: 'SOFT_GROUP_BEGIN' },
    {
      field: 'srChallengeRank.enabled',
      label: '启用挑战排行',
      bottomHelpMessage: '开启后群聊查询时自动上报数据，支持 *忘却排名 等排行命令',
      component: 'Switch'
    },
    {
      field: 'srChallengeRank.rankNumber',
      label: '排行上榜人数',
      bottomHelpMessage: '范围 5-50',
      component: 'InputNumber',
      componentProps: { min: 5, max: 50 }
    }
  ]
}
