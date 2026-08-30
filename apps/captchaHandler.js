import plugin from '../../../lib/plugins/plugin.js'
import LoveMys from '../model/loveMys.js'
import gsCfg from '../model/gsCfg.js'

const loveMys = new LoveMys()

export class CaptchaHandler extends plugin {
  constructor() {
    super({
      name: '[Axiu-Plugin] 米游社验证码处理',
      priority: 1,
      namespace: 'Axiu-Plugin',
      handler: [{
        key: 'mys.req.err',
        fn: 'mysReqErrHandler'
      }]
    })
  }

  /**
   * 米游社 API 请求错误处理（Geetest 验证码过码）
   * @param {object} e - 事件对象
   * @param {{mysApi: object, res: object, OnlyGtest?: boolean, type?: string, data?: object}} args
   * @param {function} reject - 拒绝回调
   */
  async mysReqErrHandler(e, args, reject) {
    const { mysApi, res } = args

    // 仅过码（供其他插件调用，不重放请求）
    if (args.OnlyGtest) return await loveMys.geetest(e, mysApi, res?.retcode)

    // 仅处理 Geetest 验证码错误
    if (![1034, 10035].includes(Number(res.retcode))) {
      // 处理1034, 10035情况
      return reject()
    }

    // 校验配置完整性（任一必填字段缺失即拒绝，避免部分配置仍发起畸形请求）
    const apiCfg = gsCfg.api
    const missing = []
    if (apiCfg.type == 0) {
      if (!apiCfg.api) missing.push('api')
    } else if (apiCfg.type == 1) {
      for (const f of ['api', 'resapi', 'key', 'query']) if (!apiCfg[f]) missing.push(f)
    } else if (apiCfg.type == 2) {
      for (const f of ['api', 'resapi', 'key', 'query', 'resquery']) if (!apiCfg[f]) missing.push(f)
    }
    if ([1, 2].includes(apiCfg.GtestType) && missing.length > 0) {
      return reject(`loveMys: 未正确填写配置文件[api.yaml]，缺失字段: ${missing.join(', ')}`)
    }

    // 过码并重放请求
    return await loveMys.getvali(e, mysApi, args.type, args.data)
  }
}
