# Axiu-Plugin / 阿修插件

阿修自用 Yunzai-Bot v3 插件，提供扫码登录、抽卡记录、米游社签到、米游社过码、自动入群审核、代发言等功能。

> MCSM 面板管理已迁移至独立插件 [MCSM-Plugin](https://github.com/AxiuCN/MCSM-Plugin)。

## 安装

在 Yunzai 根目录执行：

```bash
git clone --depth=1 https://github.com/AxiuCN/Axiu-Plugin.git ./plugins/Axiu-Plugin/
git -C ./plugins/Axiu-Plugin submodule update --init -- tool/MihoyoBBSTools
pnpm install --filter=Axiu-Plugin
```

## 功能

### 扫码登录

通过米游社扫码绑定 stoken，支持刷新 cookie。移植自 xiaoyao-cvs-plugin。

- `#扫码登录` — 生成 QR 码，米游社扫码后自动绑定 stoken 并查找游戏角色，同时自动绑定 CK 到 cookie 池（无需手动 `#刷新ck`）
- `#刷新ck` — 遍历已绑定的 stoken，刷新 cookie_token 并绑定到 cookie 系统
- **CK 自动刷新** — 米游社 API 返回 10001（CK 过期）时，自动用已绑定的 stoken 刷新 cookie 并重试请求，无需手动 `#刷新ck`
- 可在锅巴后台开关

### 抽卡记录

整合 Mihoyo 官方 API 和提瓦特小助手两种抽卡记录获取方式，统一保存到 genshin 插件的本地 GachaLog 存储。小助手功能移植自天如插件（TianRu-plugin）。

| 命令 | 说明 |
|------|------|
| `#更新抽卡记录` | 通过 Mihoyo 官方 API 增量更新抽卡记录（仅最近 6 个月） |
| `#获取抽卡记录` | 同上，但以文本形式返回抽卡链接（需私聊） |
| `#更新小助手抽卡记录 [链接]` | 从提瓦特小助手（lelaer.com）导入全历史 UIGF 记录 |
| `#获取小助手抽卡链接` | 生成米游社抽卡链接供手动使用（仅私聊） |

- 已绑定 stoken 的用户无需提供链接，自动获取 authkey
- 未绑定 stoken 时提示发送抽卡记录链接（两步交互）
- 小助手数据与 Mihoyo 官方数据共用同一本地存储，自动去重

### 米游社签到

基于 [MihoyoBBSTools](https://github.com/Womsxd/MihoyoBBSTools)（Python，git 子模块）的社区+游戏签到。

**环境初始化**（首次使用）：
```bash
#初始化签到环境
```
自动检查 Python、安装依赖、拉取子模块。

**命令**：

| 命令 | 说明 |
|------|------|
| `#初始化签到环境` | 检查 Python、pip install 依赖、拉取 MihoyoBBSTools 子模块（仅 master） |
| `#注册自动签到` | 用已绑定的 stoken 注册签到，生成个人签到配置 |
| `#注册本群签到` | 为群内所有已绑定 stoken 的成员批量注册（仅群主/管理员） |
| `#签到` | 手动执行当前用户的签到（兼容旧命令 `#开始签到` / `#手动签到`） |
| `#全部签到` | 执行全部已注册用户的签到（仅 master） |
| `#签到状态` | 查看已绑定账号数及每个签到配置的开关状态 |
| `#刷新自动签到` | 用 stoken 刷新所有个人签到配置的 cookie |
| `#签到名单列表` | 列出所有已注册签到用户（仅 master） |

- 每天 4:30 全体刷新 cookie，5:00 自动签到（cron 均可配），完成后向 master 和配置群聊发送汇总
- 签到详细日志写入 `log/signin-{date}.log`，保留 7 天自动清理
- 支持一个 QQ 绑定多个米游社账号（`{qq}_1.yaml`、`{qq}_2.yaml` …），同一 stuid 自动去重
- 社区签到触发验证码时自动过码（最多重试 3 次，复用现有过码平台）
- 个人签到配置存储在 `tool/MihoyoBBSTools/MihoyoBBSTools/config/{qq}_n.yaml`
- 可在锅巴后台配置签到时间、游戏开关、BBS 任务开关、报告群聊等

**手动配置**：
- 签到主配置（schedule、refreshSchedule、pythonCommand、reportGroups 等）：`config/config.yaml` → `signin:` 段
- 签到模板（游戏、BBS 任务开关）：`config/MihoyoBBSTools_config.yaml`

### 米游社验证码过码

自动处理米游社 API 返回的 Geetest 验证码（retcode 1034/10035），支持三种过码平台 + 手动打码回退。

- 平台：test_nine / ttocr.com / 2captcha.com
- 手动打码：内置 GT-Manual Express 服务，通过浏览器完成验证
- 配置：编辑 `config/config.yaml` 的 `api:` 段

### 自动入群审核

收到加群申请时，根据群配置的黑白名单答案自动审批，未匹配则 @通知管理员人工审核。

### 代发言

`#代@某人 消息内容` 或 `#代QQ号 消息内容`（仅 master，仅群聊），以目标用户身份重新注入消息到插件匹配流程。

## 配置

### 方式一：锅巴后台（推荐）

在锅巴后台 → 阿修插件，可视化配置签到、过码、入群审核等。

### 方式二：手动编辑

- 签到配置：编辑 `config/config.yaml` → `signin:` 段 + `config/MihoyoBBSTools_config.yaml`
- 入群审核：复制 `config/group_config.yaml.example` → `config/group_config.yaml`
- 过码配置：编辑 `config/config.yaml` → `api:` 段

## 部署 test_nine（可选，自动过码用）

如已有过码平台可跳过。test_nine 为本地 AI 过码服务，以子模块提供。

```bash
# 1. 拉取子模块
git submodule update --init -- tool/test_nine

# 2. 下载模型文件至 tool/test_nine/test_nine/model/
# https://huggingface.co/luguoyixiazi/model_save/resolve/main/PP-HGNetV2-B4.onnx
# https://huggingface.co/luguoyixiazi/model_save/resolve/main/d-fine-n.onnx
# https://huggingface.co/luguoyixiazi/model_save/resolve/main/yolo11n.onnx
# https://huggingface.co/luguoyixiazi/model_save/resolve/main/dinov3-small.onnx
# https://huggingface.co/luguoyixiazi/model_save/resolve/main/atten.onnx

# 3. 安装依赖
pip install -r tool/test_nine/test_nine/requirements_without_train.txt

# 4. 启动（默认端口 9645）
uvicorn main:app --host 0.0.0.0 --port 9645
```

启动后在 `config/config.yaml` 的 `api:` 段设置 `type: 0`，`api` 填 `http://127.0.0.1:9645/pass_uni`。

> 模型下载地址、训练方法及更多参数详见 `tool/test_nine/test_nine/README.md`。

## 鸣谢

- [loveMys-plugin](https://github.com/kissnavel/loveMys) — 过码事件处理及配置体系借鉴自此项目
- [GT-Manual](https://gitee.com/QQ1146638442/GT-Manual) — 内置手动打码服务引用于此
- [test_nine](https://github.com/luguoyixiazi/test_nine) — 九宫格+点选 AI 过码，以子模块引入
- [ClassificationCaptchaOcr](https://github.com/taisuii/ClassificationCaptchaOcr) — resnet 模型及 V4 数据集参考
- [xiaoyao-cvs-plugin](https://github.com/ctrlcvs/xiaoyao-cvs-plugin) — 扫码登录、stoken 管理体系移植自此项目
- [Lotus-Plugin](https://github.com/MOPELotus/Lotus-Plugin) — 签到架构、过码桥接、计划式调度思路借鉴自此项目
- [MihoyoBBSTools](https://github.com/Womsxd/MihoyoBBSTools) — Python 签到引擎，米游社签到及游戏签到核心，以子模块引入
- [TianRu-plugin](https://github.com/HDTianRu/TianRu-plugin) — 提瓦特小助手抽卡记录功能移植自此项目