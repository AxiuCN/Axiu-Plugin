/** 重启管理模块 — schema + 默认值 */

export function getDefaults() {
  return {
    restart_enableMcsm: true,
    restart_useMcsmManagerPluginConfig: true,
    restart_mcsmHost: '127.0.0.1',
    restart_mcsmPort: 23333,
    restart_mcsmApiKey: '',
    restart_mcsmInstanceUuid: '',
    restart_mcsmDaemonId: '',
    restart_restartCron: ''
  }
}

export function getSchema() {
  return [
    { label: '重启管理', component: 'SOFT_GROUP_BEGIN' },
    {
      field: 'restart.enableMcsm',
      label: '启用MCSM面板重启',
      bottomHelpMessage: '关闭则使用框架原生重启',
      component: 'Switch',
      defaultValue: true
    },
    {
      field: 'restart.useMcsmManagerPluginConfig',
      label: '读取MCSM插件用户数据',
      bottomHelpMessage: '从 mcsmanager-plugin 自动读取面板地址和API Key。开启后下方地址/端口/API Key将被忽略',
      component: 'Switch',
      defaultValue: true
    },
    {
      field: 'restart.mcsmHost',
      label: 'MCSM面板地址',
      component: 'Input',
      defaultValue: '127.0.0.1',
      componentProps: { placeholder: '127.0.0.1' }
    },
    {
      field: 'restart.mcsmPort',
      label: 'MCSM面板端口',
      component: 'InputNumber',
      defaultValue: 23333,
      componentProps: { min: 1, max: 65535, step: 1 }
    },
    {
      field: 'restart.mcsmApiKey',
      label: 'API Key',
      component: 'Input',
      defaultValue: '',
      componentProps: { placeholder: 'MCSManager 面板 API Key' }
    },
    {
      field: 'restart.mcsmInstanceUuid',
      label: '实例UUID',
      component: 'Input',
      required: true,
      componentProps: { placeholder: 'MCSManager 实例 UUID（必填）' }
    },
    {
      field: 'restart.mcsmDaemonId',
      label: '守护进程ID',
      component: 'Input',
      required: true,
      componentProps: { placeholder: 'MCSManager 守护进程 ID（必填）' }
    },
    {
      field: 'restart.restartCron',
      label: '定时重启Cron',
      bottomHelpMessage: '每行一个cron表达式，留空不执行定时任务。示例：0 4 * * *',
      component: 'Input',
      componentProps: {
        type: 'textarea',
        placeholder: '0 4 * * *\n0 12 * * *',
        rows: 3
      }
    }
  ]
}
