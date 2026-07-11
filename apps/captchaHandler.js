import plugin from '../../../lib/plugins/plugin.js'
import LoveMys from '../model/loveMys.js'
import Cfg from '../model/Cfg.js'

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

    // 校验配置完整性
    const apiCfg = Cfg.api
    let apiCheck
    if (apiCfg.type == 0) {
      apiCheck = !apiCfg.api
    } else if (apiCfg.type == 1) {
      apiCheck = !apiCfg.api && !apiCfg.resapi && !apiCfg.key && !apiCfg.query
    } else if (apiCfg.type == 2) {
      apiCheck = !apiCfg.api && !apiCfg.resapi && !apiCfg.key && !apiCfg.query && !apiCfg.resquery
    }
    if ([1, 2].includes(apiCfg.GtestType) && apiCheck) {
      return reject('loveMys: 未正确填写配置文件[api.yaml]')
    }

    // 过码并重放请求
    return await loveMys.getvali(e, mysApi, args.type, args.data)
  }
}
