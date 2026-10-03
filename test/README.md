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
| `srGacha-merge.test.mjs` | 星铁抽卡合并 `appendNewRecordsToGenuinePool`：首次出五星的窗口扣除、十连同秒尾段、远端更旧五星的重叠窗口、重复同步幂等、文件新旧方向、UTC+8 占位时间 | 无（纯函数 + 合成数据） |
| `signin-refresh-report.test.mjs` | 批量刷新 Cookie 的汇总口径 `summarizeCookieRefresh` 与报告 `buildRefreshReport`：部分成功用户的失败明细不被丢弃、三档统计、报告渲染、边界 | 无（纯函数 + 合成数据） |

两个套件都是纯函数级、数据无关，因此不依赖真实账号、Redis 与网络，也不触发 `#扫码登录` / Python 签到链路。

## 新增套件的步骤

1. 在 `test/` 下建 `<主题>.test.mjs`；
2. 头部 `import { importMod, requireFile, installFrameworkStubs, checker } from './_helper.mjs'`，
   先 `installFrameworkStubs()`，缺前置用 `requireFile()` / `skip()`；
3. 断言用 `check(name, cond, extra)`，结尾 `finish()`；
4. 把该套件跑红一次（临时还原被修的代码），确认断言有效后再入库；
5. 同步更新本文件的套件表。
