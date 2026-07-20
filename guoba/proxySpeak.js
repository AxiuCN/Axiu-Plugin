/** 代发言配置模块 — schema + 默认值 */

export function getSchema () {
  return [
    { label: '代发言', component: 'SOFT_GROUP_BEGIN' },
    {
      field: 'proxySpeak.enabled',
      label: '启用代发言',
      bottomHelpMessage: '开启后可使用 #代 @某人 消息 命令（仅master）',
      component: 'Switch'
    }
  ]
}
