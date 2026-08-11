export const helpCfg = {
  title: '#阿修帮助',
  subTitle: '阿修插件' // 版本号由 help.js 从 package.json 动态读取
}

export const helpList = [
  {
    group: '扫码登录',
    list: [
      { title: '#扫码登录', desc: '扫码绑定米游社账号（stoken+CK）' },
      { title: '#刷新ck', desc: '用已存 stoken 刷新失效的 cookie' },
    ]
  },
  {
    group: '米游社签到',
    list: [
      { title: '#注册自动签到', desc: '绑定 stoken 并开启自动签到' },
      { title: '#签到', desc: '立即执行当前账号签到' },
      { title: '#签到状态', desc: '查看绑定账号数与签到开关' },
      { title: '#刷新自动签到', desc: '用 stoken 刷新 cookie 保证定时签到' },
      { title: '#注册本群签到', desc: '为群内绑定成员注册签到（群主/管理员）' },
    ]
  },
  {
    group: '签到管理（仅主人）',
    auth: 'master',
    list: [
      { title: '#初始化签到环境', desc: '检查 Python、安装依赖、拉取签到引擎' },
      { title: '#签到名单列表', desc: '列出所有已注册用户' },
      { title: '#全部签到', desc: '立即为全部注册用户执行签到' },
    ]
  },
  {
    group: '抽卡记录',
    list: [
      { title: '#更新抽卡记录', desc: '米游社官方接口增量更新（近12个月）' },
      { title: '#更新小助手抽卡记录', desc: '导入提瓦特小助手全历史抽卡数据' },
      { title: '#获取抽卡链接', desc: '生成米游社抽卡链接（仅私聊）' },
    ]
  },
  {
    group: '原神终局挑战',
    list: [
      { title: '#深渊 #深境螺旋', desc: '深境螺旋当期战绩' },
      { title: '#剧诗 #幻想真境剧诗', desc: '幻想真境剧诗当期战绩' },
      { title: '#危战 #幽境危战 #危战多人', desc: '幽境危战·单人 / 多人战绩' },
    ]
  },
  {
    group: '星铁终局挑战',
    list: [
      { title: '*末日 *末日幻影', desc: '末日幻影战绩' },
      { title: '*虚构 *虚构叙事', desc: '虚构叙事战绩' },
      { title: '*忘却 *混沌回忆', desc: '混沌回忆战绩' },
      { title: '*仲裁 *异相仲裁', desc: '异相仲裁战绩' },
      { title: '*深渊', desc: '三深渊（末日+虚构+忘却）战绩' },
    ]
  },
  {
    group: '终局挑战排行',
    list: [
      { title: '#深渊排名 #深境螺旋排行', desc: '深境螺旋当期排行' },
      { title: '#剧诗排行 #幻想真境剧诗排行', desc: '幻想真境剧诗当期排行' },
      { title: '#危战排行 #幽境危战排行 #危战多人排行', desc: '幽境危战·单人 / 多人排行' },
      { title: '*末日排行 *末日幻影排行', desc: '末日幻影排行' },
      { title: '*虚构排行 *虚构叙事排行', desc: '虚构叙事排行' },
      { title: '*忘却排行 *混沌回忆排行', desc: '混沌回忆排行' },
      { title: '*仲裁排行 *异相仲裁排行', desc: '异相仲裁排行' },
    ]
  },
  {
    group: '代发言',
    auth: 'master',
    list: [
      { title: '#代@某人 内容', desc: '以对方身份代发言（仅主人）' },
    ]
  },
  {
    group: '自动功能',
    list: [
      { title: '入群审核', desc: '申请备注答对自动放行' },
      { title: '米游社过码', desc: '验证码自动识别 / 手动打码' },
      { title: 'CK 自动刷新', desc: 'CK 失效自动刷新并私聊通知' },
    ]
  },
]
