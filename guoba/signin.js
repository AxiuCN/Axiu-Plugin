/** 米游社签到 Guoba Schema
 *
 *  分两个部分：
 *    1. 主配置（config/config.yaml → signin: 段）— 通过 guoba/index.js TEMPLATE_VARS 替换
 *    2. 签到模板（config/MihoyoBBSTools_config.yaml）— 通过 guoba/index.js 直接 YAML 读写
 */

// ==================== 主配置 Schema ====================

export function getSigninMainSchema () {
  return [
    { label: '定时签到', component: 'SOFT_GROUP_BEGIN' },
    {
      field: 'signin.enable',
      label: '启用自动签到',
      bottomHelpMessage: '关闭后定时签到和全部命令仍可用，但cron不会自动触发',
      component: 'Switch'
    },
    {
      field: 'signin.schedule',
      label: '签到时间 (Cron)',
      bottomHelpMessage: 'Quartz cron 表达式，默认 0 0 5 * * ? * 表示每天5:00',
      component: 'Input',
      required: true,
      componentProps: { placeholder: '0 0 5 * * ? *' }
    },
    {
      field: 'signin.randomDelayMin',
      label: '随机延迟上限 (分钟)',
      bottomHelpMessage: '自动签到开始前的随机延迟，避免固定时间被检测，0=不延迟',
      component: 'InputNumber',
      componentProps: { min: 0, max: 120, placeholder: '0' }
    },
    {
      field: 'signin.pythonCommand',
      label: 'Python 命令',
      bottomHelpMessage: '可填 python / python3 或完整路径',
      component: 'Input',
      required: true,
      componentProps: { placeholder: 'python' }
    },
    {
      field: 'signin.notifyGroup',
      label: '完成后群内通知',
      bottomHelpMessage: '自动签到全部完成后在注册用户所在群发送汇总报告',
      component: 'Switch'
    },
    {
      field: 'signin.captchaRetries',
      label: '过码最大重试次数',
      bottomHelpMessage: '社区签到触发验证码时的最大重试次数',
      component: 'InputNumber',
      componentProps: { min: 0, max: 10, placeholder: '3' }
    },
    {
      field: 'signin.captchaTimeout',
      label: '过码超时 (秒)',
      bottomHelpMessage: '单次过码等待的最大时间',
      component: 'InputNumber',
      componentProps: { min: 30, max: 600, placeholder: '240' }
    }
  ]
}

// ==================== 签到模板 Schema（config/MihoyoBBSTools_config.yaml） ====================

export function getBbsToolsTemplateSchema () {
  return [
    { label: '签到模板配置（新用户注册时使用）', component: 'SOFT_GROUP_BEGIN' },

    // BBS 社区
    { label: '米游社社区任务', component: 'Divider' },
    {
      field: 'mihoyobbs.enable',
      label: '启用社区任务',
      component: 'Switch'
    },
    {
      field: 'mihoyobbs.checkin',
      label: '社区签到',
      component: 'Switch'
    },
    {
      field: 'mihoyobbs.read',
      label: '看帖任务',
      component: 'Switch'
    },
    {
      field: 'mihoyobbs.like',
      label: '点赞任务',
      component: 'Switch'
    },
    {
      field: 'mihoyobbs.cancel_like',
      label: '取消点赞',
      component: 'Switch'
    },
    {
      field: 'mihoyobbs.share',
      label: '分享任务',
      component: 'Switch'
    },

    // 国服游戏
    { label: '国服游戏签到', component: 'Divider' },
    {
      field: 'games.cn.enable',
      label: '启用国服游戏签到',
      component: 'Switch'
    },
    {
      field: 'games.cn.retries',
      label: '验证码重试次数',
      component: 'InputNumber',
      componentProps: { min: 1, max: 5, placeholder: '3' }
    },
    {
      field: 'games.cn.genshin.checkin',
      label: '原神',
      component: 'Switch'
    },
    {
      field: 'games.cn.honkai_sr.checkin',
      label: '星穹铁道',
      component: 'Switch'
    },
    {
      field: 'games.cn.zzz.checkin',
      label: '绝区零',
      component: 'Switch'
    },
    {
      field: 'games.cn.honkai3rd.checkin',
      label: '崩坏3',
      component: 'Switch'
    },
    {
      field: 'games.cn.honkai2.checkin',
      label: '崩坏2',
      component: 'Switch'
    },
    {
      field: 'games.cn.tears_of_themis.checkin',
      label: '未定事件簿',
      component: 'Switch'
    },

    // 国际服
    { label: '国际服游戏签到', component: 'Divider' },
    {
      field: 'games.os.enable',
      label: '启用国际服签到',
      component: 'Switch'
    },
    {
      field: 'games.os.cookie',
      label: '国际服 Cookie',
      bottomHelpMessage: '国际服需要独立 cookie（从 hoyolab.com 获取）',
      component: 'Input',
      componentProps: { type: 'textarea', placeholder: '从 hoyolab.com 获取' }
    },
    {
      field: 'games.os.genshin.checkin',
      label: '原神 (国际服)',
      component: 'Switch'
    },
    {
      field: 'games.os.honkai_sr.checkin',
      label: '星穹铁道 (国际服)',
      component: 'Switch'
    },
    {
      field: 'games.os.zzz.checkin',
      label: '绝区零 (国际服)',
      component: 'Switch'
    },

    // 云游戏
    { label: '云游戏签到', component: 'Divider' },
    {
      field: 'cloud_games.cn.enable',
      label: '启用国服云游戏签到',
      component: 'Switch'
    },
    {
      field: 'cloud_games.cn.genshin.enable',
      label: '云原神',
      component: 'Switch'
    },
    {
      field: 'cloud_games.cn.zzz.enable',
      label: '云绝区零',
      component: 'Switch'
    },
    {
      field: 'cloud_games.os.enable',
      label: '启用国际服云游戏签到',
      component: 'Switch'
    },

    // 网页活动
    { label: '网页活动', component: 'Divider' },
    {
      field: 'web_activity.enable',
      label: '启用网页活动',
      component: 'Switch'
    }
  ]
}

/** 获取完整 Schema */
export function getSchema () {
  return [
    ...getSigninMainSchema(),
    ...getBbsToolsTemplateSchema()
  ]
}
