# Axiu-Plugin / 阿修插件

阿修自用 Yunzai-Bot v3 插件，提供扫码登录、米游社签到、米游社过码、抽卡记录、终局挑战、自动入群审核、代发言等功能。

> MCSM 面板管理已迁移至独立插件 [MCSM-Plugin](https://github.com/AxiuCN/MCSM-Plugin)。

## 安装

在 Yunzai 根目录执行：

> Github
```bash
git clone --depth=1 https://github.com/AxiuCN/Axiu-Plugin.git ./plugins/Axiu-Plugin/
git -C ./plugins/Axiu-Plugin submodule update --init -- tool/MihoyoBBSTools
pnpm install --filter=Axiu-Plugin
```

> Gitee
```bash
git clone --depth=1 https://gitee.com/AxiuCN/Axiu-Plugin.git ./plugins/Axiu-Plugin/
git -C ./plugins/Axiu-Plugin submodule update --init -- tool/MihoyoBBSTools
pnpm install --filter=Axiu-Plugin
```

> Gitcode
```bash
git clone --depth=1 https://gitcode.com/AxiuCN/Axiu-Plugin.git ./plugins/Axiu-Plugin/
git -C ./plugins/Axiu-Plugin submodule update --init -- tool/MihoyoBBSTools
pnpm install --filter=Axiu-Plugin
```

## 功能

### 扫码登录

通过米游社扫码绑定 stoken，支持刷新 cookie。移植自 xiaoyao-cvs-plugin。

- `#扫码登录` — 生成 QR 码，米游社扫码后自动绑定 stoken 并查找游戏角色，同时自动绑定 CK 到 cookie 池（无需手动 `#刷新ck`）
- `#刷新ck` — 遍历已绑定的 stoken，刷新 cookie_token 并绑定到 cookie 系统
- 可在锅巴后台开关

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
| `#删除签到` | 删除当前账号的全部签到配置（需重新 `#注册自动签到`） |
| `#删除stoken` | 删除当前账号的全部 stoken 条目（需重新 `#扫码登录`） |
| `#签到名单列表` | 列出所有已注册签到用户（仅 master） |

- 每天 4:30 全体刷新 cookie，5:00 自动签到（cron 均可配），完成后向 master 和配置群聊发送汇总
- 签到详细日志写入 `log/signin-{date}.log`，保留 7 天自动清理
- 支持一个 QQ 绑定多个米游社账号（`{qq}_1.yaml`、`{qq}_2.yaml` …），同一 stuid 自动去重
- 社区签到触发验证码时自动过码（最多重试 3 次，复用现有过码平台）
- stoken 失效自动清理：`#注册自动签到` 时 stoken 失效 → 自动删除该 stoken 条目并提示重新扫码；`#刷新自动签到` / 每日定时刷新时失效 → 自动删除对应签到配置 `{qq}_n.yaml`，避免自动签到持续失败空转（仅登录类错误触发，临时网络错误不误删）
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

### 抽卡记录

整合 Mihoyo 官方 API 和提瓦特小助手两种抽卡记录获取方式，统一保存到 genshin 插件的本地 GachaLog 存储。小助手功能移植自天如插件（TianRu-plugin）。

| 命令 | 说明 |
|------|------|
| `#更新抽卡记录` | 通过 Mihoyo 官方 API 增量更新抽卡记录（可获取近 12 个月数据） |
| `#更新小助手抽卡记录 [链接]` | 从提瓦特小助手（lelaer.com）导入全历史 UIGF 记录 |
| `#获取抽卡链接` | 生成米游社抽卡链接供手动使用（仅私聊） |

- 三个命令各有独立的 5 分钟 CD
- 已绑定 stoken 的用户无需提供链接，自动获取 authkey
- 小助手数据与 Mihoyo 官方数据共用同一本地存储，自动去重

### 终局挑战

**原神终局挑战** — 完整自实现深境螺旋、幻想真境剧诗、幽境危战查询。一次 API 调用完成数据采集 + HTML 渲染 + 排行上报，不与 miao-plugin 重复调 API。查询模板移植自 miao-plugin（去掉角色武器圣遗物展示）。

| 命令 | 权限 | 说明 |
|------|------|------|
| `#深渊` / `#深境螺旋` | all | 深境螺旋查询（楼层星数、各间用时） |
| `#剧诗` / `#幻想真境剧诗` | all | 幻想真境剧诗查询（勋章、辉彩祝福、神秘收获） |
| `#幽境` / `#幽境危战` | all | 幽境危战查询（难度、用时、怪物信息） |
| `#幽境单人` / `#幽境多人` | all | 指定单人/多人模式 |
| `#深渊排名` / `#深境排行` | all | 排行：层数→星数→战斗次数 |
| `#剧诗排名` / `#幻想排行` | all | 排行：模式→幕数→星章→用时→借出 |
| `#幽境排名` / `#危战排行` | all | 排行：难度→用时，徽章仅展示不参与排序 |
| `#深渊排名 星数` | all | 指定维度排行（`层数`/`星数`/`战斗次数`/`模式`/`星章`/`用时`/`借出`/`难度`） |
| `#重置深渊排名` | master | 重置本群该类型排行数据 |
| `#开启深渊排行` / `#关闭深渊排行` | master | 开关本群排行功能 |

- 支持 `上期` / `本期`（默认本期）修饰符
- 查询命令在群聊中自动上报数据到 Redis ZSET 排行，90 天自动过期
- 排行多维度加权复合排序，幽境危战徽章（含虹彩徽章）在排行页展示但不参与排序
- `#原神` 前缀可选；查询使用 `#喵喵深渊` 等前缀时仍由 miao-plugin 处理

**星铁终局挑战** — 查询星穹铁道终局挑战数据（末日幻影、虚构叙事、忘却之庭、异相仲裁），移植自 StarRail-plugin。

| 命令 | 说明 |
|------|------|
| `*末日` / `*末日幻影` | 末日幻影数据 |
| `*虚构` / `*虚构叙事` | 虚构叙事数据 |
| `*忘却` / `*混沌回忆` | 忘却之庭数据 |
| `*仲裁` / `*异相仲裁` | 异相仲裁数据 |
| `*深渊` | 全部三种深渊（末日+虚构+忘却） |
| `*最新深渊` / `*当期深渊` | 当前最新一期 |

- 支持 `上期` / `本期`（默认：本期）、`简易`（跳过详细API）修饰符
- 仲裁额外支持 `往期`（显示三期历史）
- `*星铁` 前缀可选
- 查询遇到验证码时自动调用本插件过码平台
- 星铁 API 返回 10001（CK 过期）时自动用已绑定的 stoken 刷新 cookie 并重试（本插件自实现；原神侧同理由 genshin 插件处理）

**终局挑战排行** — 在群聊中查询挑战数据时自动上报成绩，支持群内排名。

| 命令 | 权限 | 说明 |
|------|------|------|
| `#深渊排名` / `#深境排行` | all | 综合排序（层数→星数→战斗次数），每行显示层数、星数、战斗次数 |
| `#剧诗排名` / `#幻想排行` | all | 综合排序（模式→幕数→星章→用时→借出），每行显示模式、幕数、星章、用时、借出 |
| `#幽境排名` / `#危战排行` | all | 综合排序（难度→用时），每行显示难度、用时、徽章 |
| `*忘却排名` / `*混沌排行` | all | 综合排序（层数→星数→轮数），每行显示层数、星数、轮数 |
| `*末日排名` / `*末日幻影排名` | all | 综合排序（难度→总分），每行显示难度、分数、星数、轮数 |
| `*虚构排名` / `*虚构叙事排名` | all | 综合排序（层数→星数→分数→轮数），每行显示层数、星数、分数、轮数 |
| `*仲裁排名` / `*异相仲裁排名` | all | 综合排序（绝境优先→王棋→骑士→轮数），每行显示模式、王棋、骑士、轮数 |
| `*末日排名 王棋星数` | all | 指定维度排行（支持全称：`总星数`/`总分`/`使用轮数`/`战斗次数`/`最深抵达`/`王棋星数`/`骑士星数`/`绝境模式`） |
| `#重置深渊排名` / `#重置剧诗排名` / `#重置幽境排名` | master | 重置本群该类型排行数据 |
| `*重置忘却排名` | master | 重置本群该类型排行数据 |
| `#开启深渊排行` / `#关闭深渊排行` | master | 开关本群原神排行功能 |
| `*开启挑战排名` / `*关闭挑战排名` | master | 开关本群星铁排行功能 |

- 仅群聊可用，基于米游社 API 赛季 ID 自动分段，新旧数据互不干扰
- 综合排序为加权多维度（降序优先，轮数/战斗次数等越小越好维度自动取反）
- 排行页显示赛季名称（从 Atlas-Plugin 图鉴获取）、期数、赛季时间
- 数据 90 天自动过期，避免 Redis 堆积

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
- [StarRail-plugin](https://github.com/Nwflower/StarRail-plugin) — 星铁终局挑战功能移植自此项目
- [miao-plugin](https://github.com/yoimiya-kokomi/miao-plugin) — 原神终局挑战查询模板及 API 调用参考自此项目