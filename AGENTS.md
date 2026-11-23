# AGENTS.md

This file provides project-level guidance to AI coding agents (DSH) when working with code in this repository.

## 项目概况

Axiu-Plugin — 阿修自用 Yunzai-Bot v3 插件，ESM（`"type": "module"`），GPLv3。

> **迁移说明**：MCSM 面板管理功能已迁移到独立插件 [MCSM-Plugin](../MCSM-Plugin/)。

> **鸣谢**：感谢 [FurinaWai77](https://github.com/FurinaWai77) 为本项目提供代码审查与修复建议（审查基准 e9c4dae + 7fa4b3d - 88affaf），详见 `.dsh/Axiu-Plugin-code-review-handled.md` 处理归档；签到架构、过码桥接、计划式调度思路借鉴 [Lotus-Plugin](https://github.com/MOPELotus/Lotus-Plugin)，星铁抽卡记录同步思路参考其重制版 Lotus-ReFactor（本地副本位置见 `docs/private/本机工作区.md`，**该目录不入库**）。

当前提供自动入群审核、代发言、米游社过码、扫码登录、抽卡记录管理、星铁终局挑战、原神终局挑战、米游社签到、圣遗物/遗器总榜、排行榜定时刷新十个功能，另有 `#Axiu帮助` 帮助图。

**新增功能**：在 `apps/` 下新建一个 `.js` 文件（export 一个继承 `plugin` 的 class），`index.js` 自动发现并加载，无需修改入口文件。

### 快速参考

| 功能 | 文件 | 事件 | 注册方式 | 权限 |
|------|------|------|---------|------|
| 星铁终局挑战 | `apps/challenge.js` | `message` | `rule[]`（`*末日` / `*混沌` / `*仲裁` / `*虚构` 6 条 + 排行 `*排名` 3 条） | all |
| 原神终局挑战 | `apps/challenge.js` | `message` | `rule[]`（`#深渊` / `#剧诗` / `#危战` 等 8 条 + 排行 `#排名` 3 条） | all |
| 自动入群审核 | `apps/autoGroupApprove.js` | `request.group.add` | `accept()` | — |
| 代发言 | `apps/proxySpeak.js` | `message` | `rule[]`（`#代`） | master |
| 米游社过码 | `apps/captchaHandler.js` | `mys.req.err` | `handler[]` | — |
| 扫码登录 | `apps/qrLogin.js` | `message` | `rule[]`（`#扫码` / `#刷新ck`） | all |
| 原神抽卡记录 | `apps/gsGachaLog.js` | `message` | `rule[]`（`#更新抽卡记录` / `#更新小助手抽卡记录` / `#获取抽卡链接`） | all |
| 星铁抽卡记录 | `apps/srGachaLog.js` | `message` | `rule[]`（`*更新星铁抽卡记录` / `*获取星铁抽卡链接`） | all |
| 米游社签到 | `apps/mysSignin.js` | `message` + `task[]` | `rule[]`（`#签到` 等 9 条命令 + 签到/刷新cookie 2个定时任务） | 见文档 |
| 圣遗物/遗器总榜 | `apps/artisRank.js` | `message` | `rule[]`（本群 `#圣遗物总榜` / `#遗器总榜` + 全局 `#全局圣遗物总榜` / `#全局遗器总榜`，星铁走 `*` 前缀，2 条 rule 共用一个 fnc） | all |
| 排行榜定时刷新 | `apps/rankRefresh.js` | `task[]` | `task[]`（`排行榜定时刷新`，cron 取 `rankRefresh.schedule`，默认关闭） | — |
| 插件帮助 | `apps/help.js` | `message` | `rule[]`（`#Axiu帮助` / `#阿修帮助`） | all |


**添加新功能最小步骤**：`apps/` 下新建 `.js` → export 继承 `plugin` 的 class → 重启即可（`index.js` 自动发现）。

## 文档索引（按需阅读，别一次全读）

| 想了解 / 要改的东西 | 先读 |
|---|---|
| 目录结构、分层职责、入口加载、跨插件依赖、框架全局依赖、Redis 键 | [`docs/架构.md`](docs/架构.md) |
| 配置三层结构、`TEMPLATE_VARS`、群配置双格式、`AXIU_CONFIG_DIR` 重定向 | [`docs/配置.md`](docs/配置.md) |
| 米游社过码（captchaHandler / test_nine / GT-Manual） | [`docs/模块-过码.md`](docs/模块-过码.md) |
| 扫码登录、原神/星铁抽卡记录、星铁 CK 自动刷新 | [`docs/模块-扫码与抽卡.md`](docs/模块-扫码与抽卡.md) |
| 米游社签到（命令 / 定时任务 / Python 桥接） | [`docs/模块-签到.md`](docs/模块-签到.md) |
| 星铁终局挑战、原神终局挑战与两套排行榜 | [`docs/模块-挑战与排行.md`](docs/模块-挑战与排行.md) |
| 圣遗物/遗器总榜、排行榜定时刷新（miao 群排行摊平） | [`docs/模块-圣遗物总榜.md`](docs/模块-圣遗物总榜.md) |
| 入群审核、代发言、插件帮助 | [`docs/模块-审核与杂项.md`](docs/模块-审核与杂项.md) |
| 回归套件的运行、前置与编写规范 | [`docs/测试.md`](docs/测试.md) |
| 待办与审核跟踪（第四轮 12 项、修复分批、未定口径） | [`docs/待办-审核跟踪.md`](docs/待办-审核跟踪.md) |
| 部署环境、盘符映射、本机工作区（**不入库**） | `docs/private/`（新克隆上不存在） |

## 约定

1. **ESM** — 全部 `import`/`export`
2. **路径统一** — `path.dirname(fileURLToPath(import.meta.url))` 获取 `__dirname`
3. **日志前缀与级别** — `[Axiu-Plugin]` 或 `[Axiu-Plugin][模块名]`；model 层沿用原 `[loveMys]`/`[米游社]` 前缀。级别只用 `info` / `warn` / `error`（框架等级是 info，`debug` 等于不输出）；**调试日志不进仓库**——排查时临时加、验证完还原
4. **事件注册** — `request.group.add` 用 `accept()`，`message` 用 `rule[]`，`mys.req.err` 用 `handler[]`
5. **容错加载** — `index.js` 使用 `Promise.allSettled`，单个 app 失败不影响整体
6. **文档入库范围** — `AGENTS.md` 与 `docs/`（除 `docs/private/`）**入库**，与代码一同评审提交；`docs/private/` 放部署环境与本机路径，**不入库**，因此入库文档只写占位（`<bot根>` / `<插件根>` / 假群号），且**不得依赖**它（新克隆上没有）；`CLAUDE.md` / `.claude/` / `.dsh/` 仍忽略
7. **model 层源自 loveMys-plugin** — 模型文件从 loveMys-plugin 复制而来，gsCfg.js 路径已调整为 Axiu-Plugin
8. **渲染缓存标识逐次唯一** — `components/render.js` 未显式传 `saveId` 时生成 `randomUUID()`，并在截图后删除生成的临时 HTML；**禁止**给 `saveId` 传固定值（宿主先同步写 HTML 再 `page.goto` 读取，固定标识会让并发渲染串图，扫码登录场景会造成账号错绑）
9. **回归套件** — 改到数据口径或共享链路时，同步补/更新 `test/` 下对应套件（`pnpm test`），见「## 测试」。
10. **配置写入** — 值经 `yamlValue()` 序列化、写盘前 `validateRendered()` 逐键验证、`writeConfigAtomic()` 原子替换；表单没提交的键沿用文件当前值；读不出来时允许保存救回但回执必须点明（见下面「配置写入口径」）。
11. **子代理须先批准** — 派发子代理（`subagent` / `workflow`）**必须先取得维护者明确同意**；未经同意一律自己做。维护者已多次要求克制使用（2026-10-05）。
12. **文档必须同步** — 功能 / 命令 / 配置变更时**必须同批更新文档**：`docs/` 对应模块文档、`README.md`（面向使用者）、本文件（快速参考）、`test/README.md`（套件表）、文档站 `guide/yunzai/plugins/Axiu-Plugin.md`。**文档落后于代码视为未交付**（2026-10-05 起）。

## 配置写入口径（改锅巴写入路径前先读）

1. **值一律经 `yamlValue()` 序列化**（`components/config.js`）：字符串 `JSON.stringify`（所以以 `*` 开头的 cron、含 `#` / `:` / 引号 / 换行的值都写不坏），数组与对象写单行 YAML。**禁止**把值裸拼进模板——`*/30 * * * * ?` 会被 YAML 当别名语法，整份配置随之读不出来（第四轮 #10）。
2. **写盘前必须验证**：渲染出的文本先 `YAML.parse`，再逐键比对「要写的值」与「解析回来的值」；任一不过就 `Result.error`，**一个字节都不写**。
3. **原子替换**：临时文件（与目标同目录、名字落在 `config/*.yaml` 这条 gitignore 规则内）+ `renameSync`，不留半截文件。
4. **表单没提交的键沿用文件当前值**，不许退回空串——那会把用户的值抹掉。
5. **文件本来就读不出来时允许救回**：面板照常返回参考默认值，保存后按参考默认值重写其余键，回执**必须点明**「其余键已按参考默认值重写」。错误文案只留「哪份文件 + 解析器原因的第一行」，**不带出错行原文**（那行常常是 `api.key`，等于把口令打进日志或弹窗）。**不新增面板横幅字段**（2026-10-05 决定）：只在 `logger.error` 与保存回执里提示。
6. **回归套件重定向**：`AXIU_CONFIG_DIR` 指向临时目录时配置读写都落在那里（`resolveConfigPath()` / `resolveGroupConfigPath()` 解析），生产不设这个变量。`test/guoba-write.test.mjs` 走的就是这条路，不碰仓库的 `config/`。

## 测试

回归套件在 `test/`（**入仓库**）：`pnpm test`（= `node test/run.mjs`，任意 cwd 可跑，缺前置打印「跳过」并 exit 0）。

```bash
cd app/plugins/Axiu-Plugin
pnpm test                          # 全量
node test/run.mjs --list           # 只列套件
node test/run.mjs --filter=signin  # 只跑文件名含 signin 的
```

约定：命名 `<主题>.test.mjs`（主题写被测行为）；路径一律经 `test/_helper.mjs` 推导，**禁止裸相对字面量与盘符**；框架全局用 `installFrameworkStubs()` 内存桩（不联网、不触真实 Redis）；临时产物只写 `test/.test-tmp/`；**断言必须能真的失败**——新增套件先临时还原被修代码确认转红再入库。

套件清单与逐套覆盖见 [`test/README.md`](test/README.md)；运行细节、前置与跳过、编写规范见 [`docs/测试.md`](docs/测试.md)。

## 待办：审核跟踪（摘要）

- 第四轮审核（2026-10-04，基准 `e86fca9`）共 11 项 P2 + 1 项 P3，**已逐条回源码核实**；批 A（锅巴 #10/#11）、批 B（扫码 #1）、批 C（星铁抽卡 #2/#3）、批 D（排行 #5 上报总开关 + #4 并发收口）、批 E（刷新汇总 #6；#7 按「不支持外服」不做）、批 F（设备指纹 #8/#9/#12 + 日志级别）**已全部落地**（四轮 12 项闭环） → 明细见 [`docs/待办-审核跟踪.md`](docs/待办-审核跟踪.md)
- **并列排名 + 隐藏首查**（2026-10-05）：名次键决定名次（战斗/借出移出、只展示）、同键密集并列（1,1,2）、组内按首查先后、首查冻结不展示、名次键取本期最优；**部署后须执行一次 `#刷新…排行` / `*刷新…排行`** → 见 [`docs/模块-挑战与排行.md`](docs/模块-挑战与排行.md)
- 未定口径：① ~~#4 的并发收口~~ → **已决（批 D）**：上报与重置共用一把按玩法（base type）的重置锁，锁序固定 resetLock → uidLock；`rebuildAll()`（`#刷新…排行`）一并纳入同一把锁；② ~~两处设备实现是否合并~~ → **已合并**（抽出 `model/mys/deviceFp.js` 共享实现，键名/兜底/注册判据仍按调用方注入，`test/` 零改动）。已决：**#7 不做**（插件只支持国服/B 服，外服判定不在范围）。未统一：两处注册判据 `1[0-9]` vs `18`（仅 10 位 `1x` UID 分歧，实际几乎不触发）
