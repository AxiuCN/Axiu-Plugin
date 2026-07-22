/** 终局挑战配置模块（原神 + 星铁） — schema + 默认值 */

export function getSchema () {
  return [
    { label: '终局挑战', component: 'SOFT_GROUP_BEGIN' },

    // ===== 原神深渊 =====
    {
      field: 'gsAbyss.enabled',
      label: '启用原神深渊查询',
      bottomHelpMessage: '开启后可使用 #深渊、#剧诗、#幽境 等命令',
      component: 'Switch'
    },
    { component: 'Divider' },
    {
      field: 'gsAbyssRank.enabled',
      label: '启用原神深渊排行',
      bottomHelpMessage: '开启后群聊查询时自动上报数据，支持 #深渊排名 等排行命令',
      component: 'Switch'
    },
    {
      field: 'gsAbyssRank.rankNumber',
      label: '原神排行上榜人数',
      bottomHelpMessage: '范围 5-50',
      component: 'InputNumber',
      componentProps: { min: 5, max: 50 }
    },

    { component: 'Divider' },

    // ===== 星铁终局 =====
    {
      field: 'srChallenge.enabled',
      label: '启用星铁终局查询',
      bottomHelpMessage: '开启后可使用 *末日、*虚构、*混沌、*仲裁、*深渊 等命令',
      component: 'Switch'
    },
    { component: 'Divider' },
    {
      field: 'srChallengeRank.enabled',
      label: '启用星铁终局排行',
      bottomHelpMessage: '开启后群聊查询时自动上报数据，支持 *忘却排名 等排行命令',
      component: 'Switch'
    },
    {
      field: 'srChallengeRank.rankNumber',
      label: '星铁排行上榜人数',
      bottomHelpMessage: '范围 5-50',
      component: 'InputNumber',
      componentProps: { min: 5, max: 50 }
    }
  ]
}
