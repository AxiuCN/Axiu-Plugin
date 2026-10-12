# Axiu-Plugin 回归套件

不启动 bot，直接跑真实生产代码路径。

## 运行

```bash
cd app/plugins/Axiu-Plugin
pnpm test                         # = node test/run.mjs
node test/run.mjs --list          # 列清单
node test/run.mjs --filter=merge  # 只跑文件名含 merge 的
node test/srGacha-merge.test.mjs  # 单跑（任意 cwd 均可）
```

- **任意 cwd 可跑**：`_helper.mjs` 会把进程 cwd 统一到 bot 根（`app/`），生产代码里有
  `./plugins/Axiu-Plugin/...` 这类按 cwd 解析的路径。
- 退出码：有任一失败 → 1；全部通过或跳过 → 0。
- 缺前置时打印 `⏭ 跳过：<原因>` 并 exit 0——新克隆的仓库不会因为缺数据而全红。

## 约定

| 项 | 约定 |
|----|------|
| 命名 | `<主题>.test.mjs`，主题写**被测行为**（如 `srGacha-merge`、`signin-refresh-report`） |
| 路径 | 一律经 `_helper.mjs` 的 `pluginRoot` / `mod()` / `importMod()` 推导，禁止裸相对字面量与盘符绝对路径 |
| 框架全局 | 用 `installFrameworkStubs()` 提供 `logger` / `redis`（内存实现）/ `segment` / `Bot`；必须在 import 生产模块**之前**调用 |
| 断言 | 用 `checker()` 的 `check()` + `finish()`；每条断言都必须能真的失败（抽掉修复应当变红），只打印不判定的脚本不入库 |
| 临时产物 | 只写 `test/.test-tmp/`（`.gitignore` 已忽略），用 `tmpFile()` 取路径 |
| 源数据 | 套件不得改动 `data/`、`config/`、`tool/` 下的真实数据 |

## 套件

| 套件 | 覆盖 | 前置 |
|------|------|------|
| `srGacha-merge.test.mjs` | 星铁抽卡合并 `appendNewRecordsToGenuinePool`：首次出五星的窗口扣除、十连同秒尾段、远端更旧五星的重叠窗口、重复同步幂等、文件新旧方向、UTC+8 占位时间、同秒同名五星按条数去重（不整类压掉）、新五星按时间归并（不整段前置，数组保持时间单调） | 无（纯函数 + 合成数据） |
| `signin-refresh-report.test.mjs` | 批量刷新 Cookie 的汇总口径 `summarizeCookieRefresh` 与报告 `buildRefreshReport`：部分成功用户的失败明细不被丢弃、三档统计、`ok:false` 且无失败明细也算失败（第四轮 #6）、报告渲染、边界 | 无（纯函数 + 合成数据） |
| `rank-order.test.mjs` | 终局挑战排行（原神 + 星铁）：名次键编码与各级不越级（含星铁虚构「分数借位」回归）、并列密集名次（1,1,2）与首查只破并列、首查缺失排末尾、首查冻结、名次键只升不降、展示字段取最后一次、重排幂等、定向重置与上报交错、重置与上报共用重置锁的终态一致性（不存在「ZSET 有成员但元信息无槽位」）与串行化时序、**重排（`rebuildAll`）也在重置锁内**（上报未写完前重排不完成，放行后重排确实处理了该 uid）、排行榜总开关关闭时不上报（配置目录经 `AXIU_CONFIG_DIR` 重定向） | 无（内存 Redis） |
| `signin-runner-marks.test.mjs` | 签到 runner 的失败判定（假 module-dir 端到端跑 `run()`）：429 / 脚本失败 / 云游戏 -100 判失败、正常成功与「已签到过」不误报 | `python`（可用 `AXIU_TEST_PYTHON` 指定），缺则跳过 |
| `sr-device-timeout.test.mjs` | 星铁设备指纹/设备注册请求都带可取消信号（按 signal 判定，**不等**真实 10 秒超时）、指纹缓存命中时请求数减少、响应体阶段失败也走兜底指纹 | genshin 插件（缺失则跳过） |
| `device-fp-ltuid.test.mjs` | 通用过码设备指纹：缓存键取 cookie 里的 ltuid（不再落到 `undefined` 键）、`getFp` 网络失败与响应体失败都返回 `{deviceFp:null}` 而不抛穿、三处辅助请求都带超时信号 | 无（stub 替换 `globalThis.fetch`，不联网） |
| `guoba-write.test.mjs` | 锅巴配置读写（真跑生产 `getConfigData` / `setConfigData`）：危险值（以 `*` 开头 cron / `#` / `:` / 引号 / 换行）序列化与回读、写前验证拦坏值、表单没提交的键不丢值、群规则映射与数组双形态往返、非法输入被拒且文件零改动、坏配置救回且文案不泄露口令、临时文件不留残渣 | 无（配置目录经 `AXIU_CONFIG_DIR` 重定向到 `test/.test-tmp/`，不碰仓库 `config/`） |
| `qr-login-token.test.mjs` | 扫码登录的 ltoken 取值：`pickToken` strict 不跨类型兜底（stoken 侧兜底保留）、tokens 只有 stoken 时 ltoken 取自 `getLtoken` 接口、具名优先、ltoken 等于 stoken 判为未取到、缺 ltoken / 缺 cookie_token 均不产出凭据 | 无（stub 替换 `user.getData`，不联网、不写凭据） |
| `copyright-line.test.mjs` | 版权行（`components/pluginVersion.js`）：框架名按 bot 根包名判定（TRSS-Yunzai / Yunzai-Bot）且与根包一致、插件版本取插件包、出图版带 `<span class="version">`、聊天版无 HTML 标签、名称与版本号不粘连、版本缺失时不拼版本；断言写成两种 cwd 都成立 | 无 |
| `artis-rank.test.mjs` | 圣遗物/遗器总榜（`model/artisRank.js` + `apps/artisRank.js`）与排行定时刷新（`apps/rankRefresh.js`）：排行键解析、分数降序 / 取前 N（每键只取前 N）、同角色多 uid、同 uid 多角色、全局跨群、`dmg` 不混入、群开关关闭不出图、按 miao 卡片口径组装行（角色名 / 元素 class / 天赋格 / 评分徽章 / 武器与套装 / 伤害）与取不到面板的行跳过、uid→qq 与行首 QQ 头像（照 miao 只取群成员头像，取不到不填）、miao 缺失降级、有数据的群集合、命令正则与两条 rule、自建模板/样式的硬约束（`.item-icon` 基础规则必须在 `.char-icon` 之前、行首头像 50px 圆形、qqFace 优先、页面底色指向 miao 的默认元素底 hydro/sr 且所引底图文件存在）、未启用时任务零 Redis 访问、`rankRefresh.*` 三层配置往返；miao 用 `setMiaoAccessor()` 注入替身、渲染后端换桩（不联网、不启浏览器） | 无（内存 Redis） |

套件均为数据无关：不依赖真实账号、真实 Redis 与网络，也不触发 `#扫码登录` / 真实 Python 签到链路（`signin-runner-marks` 只在子进程里跑假 module-dir）。

> 触及子进程的套件注意：连续覆写同一 `main.py` 时必须禁写 Python 字节码（`PYTHONDONTWRITEBYTECODE=1`），否则两次内容等长且同秒写入时 Python 会复用过期 `.pyc`，套件会拿上一个用例的模块跑出**假通过**。

## 新增套件的步骤

1. 在 `test/` 下建 `<主题>.test.mjs`；
2. 头部 `import { importMod, requireFile, installFrameworkStubs, checker } from './_helper.mjs'`，
   先 `installFrameworkStubs()`，缺前置用 `requireFile()` / `skip()`；
3. 断言用 `check(name, cond, extra)`，结尾 `finish()`；
4. 把该套件跑红一次（临时还原被修的代码），确认断言有效后再入库；
5. 同步更新本文件的套件表。
