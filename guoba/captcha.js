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
      label: '启用手动打码服务',
      bottomHelpMessage: '使用他人手动api或不想使用请关闭',
      component: 'Switch'
    },
    {
      field: 'api.Host',
      label: '手动服务IP',
      bottomHelpMessage: '你的手动打码服务IP',
      component: 'Input',
      componentProps: { placeholder: '例：127.0.0.1' }
    },
    {
      field: 'api.Port',
      label: '手动服务端口',
      bottomHelpMessage: '你的手动打码服务端口',
      component: 'InputNumber',
      componentProps: { min: 0, placeholder: '例：3000' }
    },
    {
      field: 'api.Address',
      label: '手动服务地址',
      bottomHelpMessage: '反向代理用完整地址，不用反向代理请与IP端口一致',
      component: 'Input',
      componentProps: { placeholder: '例：http://127.0.0.1:3000' }
    },
    {
      field: 'api.verifyAddr',
      label: '手动api地址',
      bottomHelpMessage: '使用他人手动api时修改，用自己的保持与Address一致',
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
