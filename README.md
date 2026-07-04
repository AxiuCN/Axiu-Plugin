# Axiu-Plugin

阿修自用 Yunzai-Bot v3 插件，提供自动入群审核、MCSManager 面板重启两个独立功能。

## 安装

在 Yunzai 根目录执行：

```bash
git clone --depth=1 https://github.com/AxiuCN/Axiu-Plugin.git ./plugins/Axiu-Plugin/
pnpm install --filter=Axiu-Plugin
```

## 功能

### 自动入群审核

收到加群申请时，根据群配置的黑白名单答案自动审批，未匹配则 @通知管理员人工审核。

### MCSManager 面板重启

`#重启` 指令（仅 master），通过 MCSManager HTTP API 或框架原生方式重启 bot。支持定时重启。

## 配置

### 方式一：锅巴后台（推荐）

在锅巴后台 → 阿修插件，可视化配置重启参数和入群审核规则。

### 方式二：手动编辑

复制 `config/config.yaml.example` → `config/config.yaml`，按注释填写重启配置。

复制 `config/group_config.yaml.example` → `config/group_config.yaml`，按群号配置审核规则。
