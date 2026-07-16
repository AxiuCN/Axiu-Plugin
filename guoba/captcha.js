/** 过码配置模块 — schema + 默认值 */

export function getSchema() {
  return [
    { label: '过码配置', component: 'SOFT_GROUP_BEGIN' },
    {
      field: 'api.type',
      label: '使用的平台',
      bottomHelpMessage: '0：test_nine；1：ttocr.com；2：2captcha.com',
      component: 'InputNumber',
      required: true,
      componentProps: { min: 0, max: 2, placeholder: '请输入类型' }
    },
    {
      field: 'api.api',
      label: '使用的api',
      bottomHelpMessage: 'test_nine、ttocr、2captcha 必填',
      component: 'Input',
      componentProps: { placeholder: '例：https://api.example.com/recognize' }
    },
    {
      field: 'api.resapi',
      label: '使用的resapi',
      bottomHelpMessage: 'ttocr、2captcha 必填',
      component: 'Input',
      componentProps: { placeholder: '例：https://api.example.com/results' }
    },
    {
      field: 'api.key',
      label: 'api、resapi需要的key',
      bottomHelpMessage: 'ttocr、2captcha 必填',
      component: 'Input',
      componentProps: { placeholder: '例：appkey=***' }
    },
    {
      field: 'api.query',
      label: 'api需要的其他参数',
      bottomHelpMessage: '除 key、gt、challenge 以外的参数，ttocr、2captcha 必填',
      component: 'Input',
      componentProps: { placeholder: '例：referer=***' }
    },
    {
      field: 'api.resquery',
      label: 'resapi需要的其他参数',
      bottomHelpMessage: '除 key 以外的参数，2captcha 必填',
      component: 'Input',
      componentProps: { placeholder: '例：action=***' }
    },
    {
      component: 'Divider',
      label: '手动打码设置'
    },
    {
      field: 'api.startApi',
      label: '启用本地手动打码服务',
      bottomHelpMessage: '关闭后可使用他人服务或停用手动打码',
      component: 'Switch'
    },
    {
      field: 'api.Port',
      label: '本地手动打码服务端口',
      bottomHelpMessage: 'GT-Manual 服务监听端口，仅在内置手动打码服务开启时生效',
      component: 'InputNumber',
      componentProps: { min: 0, placeholder: '例：3000' }
    },
    {
      field: 'api.bindHost',
      label: '手动打码服务监听地址',
      bottomHelpMessage: '本地部署用 127.0.0.1，需反向代理时改为 0.0.0.0',
      component: 'Input',
      componentProps: { placeholder: '127.0.0.1' }
    },
    {
      field: 'api.Address',
      label: '手动打码服务访问地址',
      bottomHelpMessage: '发送给用户打开的链接',
      component: 'Input',
      componentProps: { placeholder: '例：http://127.0.0.1:3000' }
    },
    {
      field: 'api.verifyAddr',
      label: '手动打码api验证接口',
      bottomHelpMessage: 'Bot 提交验证码的地址，用自己的服务填 http://127.0.0.1:端口/GTest/register，用他人的按对方提供填写',
      component: 'Input',
      componentProps: { placeholder: '例：http://127.0.0.1:3000/GTest/register' }
    },
    {
      field: 'api.GtestType',
      label: '过码类型',
      bottomHelpMessage: '0：仅手动；1：仅自动；2：自动优先，失败后手动',
      component: 'InputNumber',
      required: true,
      componentProps: { min: 0, max: 2, placeholder: '请输入类型' }
    }
  ]
}
