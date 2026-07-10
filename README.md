# Axiu-Plugin

阿修自用 Yunzai-Bot v3 插件，提供自动入群审核、代发言等功能。

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

## 配置

### 方式一：锅巴后台（推荐）

在锅巴后台 → 阿修插件，可视化配置入群审核规则。

### 方式二：手动编辑

复制 `config/group_config.yaml.example` → `config/group_config.yaml`，按群号配置审核规则。
