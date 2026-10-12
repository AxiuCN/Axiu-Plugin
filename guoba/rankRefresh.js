/** 排行榜定时刷新配置模块 — schema
 *
 *  主配置（config/config.yaml → rankRefresh: 段）通过 guoba/index.js 的 TEMPLATE_VARS 模板替换写入
 */

export function getSchema () {
  return [
    { label: '排行榜定时刷新', component: 'SOFT_GROUP_BEGIN' },
    {
      field: 'rankRefresh.enabled',
      label: '启用定时刷新',
      bottomHelpMessage: '默认关闭。开启后按下方 cron 重排本插件挑战排行，并刷新 miao 群排行（只刷有排行数据的群）',
      component: 'Switch'
    },
    {
      field: 'rankRefresh.schedule',
      label: '刷新时间 (Cron)',
      bottomHelpMessage: 'Quartz cron 表达式（支持秒），默认 0 40 4 * * ? * 表示每天 4:40',
      component: 'Input',
      required: true,
      componentProps: { placeholder: '0 40 4 * * ? *' }
    },
    {
      field: 'rankRefresh.notifyMaster',
      label: '刷新后私聊主人',
      bottomHelpMessage: '刷新完成后私聊 Bot 主人发送汇总（刷新群数 / 失败群 / 本插件排行重排结果 / 耗时）',
      component: 'Switch'
    }
  ]
}
