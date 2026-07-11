# Axiu-Plugin

阿修自用 Yunzai-Bot v3 插件，提供自动入群审核、代发言、米游社过码等功能。

> MCSM 面板管理已迁移至独立插件 [MCSM-Plugin](https://github.com/AxiuCN/MCSM-Plugin)。

## 安装

在 Yunzai 根目录执行：

```bash
git clone --depth=1 https://github.com/AxiuCN/Axiu-Plugin.git ./plugins/Axiu-Plugin/
pnpm install --filter=Axiu-Plugin
```

## 功能

### 自动入群审核

收到加群申请时，根据群配置的黑白名单答案自动审批，未匹配则 @通知管理员人工审核。

### 代发言

`#代@某人 消息内容` 或 `#代QQ号 消息内容`（仅 master，仅群聊），以目标用户身份重新注入消息到插件匹配流程。

### 米游社验证码过码

自动处理米游社 API 返回的 Geetest 验证码（retcode 1034/10035），支持三种过码平台 + 手动打码回退。

- 平台：test_nine / ttocr.com / 2captcha.com
- 手动打码：内置 GT-Manual Express 服务，通过浏览器完成验证
- 配置：编辑 `config/config.yaml` 的 `api:` 段

## 配置

### 方式一：锅巴后台（推荐）

在锅巴后台 → 阿修插件，可视化配置入群审核规则。

### 方式二：手动编辑

- 入群审核：复制 `config/group_config.yaml.example` → `config/group_config.yaml`
- 过码配置：复制 `config/config.yaml.example` → `config/config.yaml`，填写 `api:` 段

## 鸣谢

- [loveMys-plugin](https://github.com/kissnavel/loveMys) — 米游社过码功能来源，作者 [@kissnavel](https://github.com/kissnavel)
- [GT-Manual](https://gitee.com/QQ1146638442/GT-Manual) — 手动打码服务，作者 QQ1146638442
