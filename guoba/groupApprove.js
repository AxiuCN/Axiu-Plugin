/** 入群审核模块 — GSubForm schema + 默认值 */

export function getDefaults() {
  return {
    groups: []
  }
}

export function getSchema() {
  return [
    { label: '入群审核', component: 'SOFT_GROUP_BEGIN' },
    {
      field: 'groups',
      label: '群审核规则',
      bottomHelpMessage: '为每个群配置白名单和黑名单答案。答案不区分大小写',
      component: 'GSubForm',
      componentProps: {
        multiple: true,
        schemas: [
          {
            field: 'groupId',
            label: '群号',
            component: 'Input',
            required: true,
            componentProps: { placeholder: '例如：123456789' }
          },
          {
            field: 'whitelistAnswers',
            label: '白名单答案',
            component: 'GTags',
            componentProps: { allowAdd: true, allowDel: true }
          },
          {
            field: 'blacklistAnswers',
            label: '黑名单答案',
            component: 'GTags',
            componentProps: { allowAdd: true, allowDel: true }
          }
        ]
      }
    }
  ]
}
