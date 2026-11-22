/**
 * 从米游社「战绩」H5 的编译 CSS 里抽取某个页面用到的规则子集。
 *
 * 用法：
 *   node example/extract-official-css.mjs <h5目录> <页面 html 路径> <输出 css 路径> [额外作用域...]
 *
 * 例（幽境危战）：
 *   node example/extract-official-css.mjs .dsh/h5 \
 *     resources/challenge/GS/hard.html resources/challenge/GS/hard-official.css 1335dd8d 205cb0c1
 *
 * 规则：
 * - 收「html 里出现的 class」+「指定 data-v 作用域」+「gt-avatar / card-bg 等组件基础类」的规则
 * - 排除 PC 版式作用域（0f16c268 / 3afa13e2 / 306522d0），否则会引用未镜像的 pc_* 图
 * - 官方尺寸是 calc(N * var(--gpx))，375 设计稿；本插件画布 750，用 --gpx: 2px 统一放大
 * - 官方少数直接写 vw 的，按 1vw = 7.5px（750 画布）换算成 px
 *
 * 产物不要手改：官方改版后重跑本脚本即可。
 */
import fs from 'node:fs'
import path from 'node:path'

const [h5Dir, htmlPath, outPath, ...scopeArgs] = process.argv.slice(2)
if (!h5Dir || !htmlPath || !outPath) {
  console.error('用法: node example/extract-official-css.mjs <h5目录> <页面html> <输出css> [data-v 后缀...]')
  process.exit(1)
}

const CSS_FILES = ['bundle_a7c0689cb60e71d3c2f7.css', '0_6c6a62822ba5bd531e27.css']
const BASE_CLASSES = [
  'gt-avatar', 'gt-avatar--size-xs', 'gt-avatar--size-s', 'gt-avatar-img',
  'gt-avatar-star-bg', 'gt-avatar-left', 'gt-avatar-left-block',
  'card-bg', 'card-bg-1', 'card-bg-2', 'duration-time', 'avatar-item',
  'monster-img', 'role-bg', 'role-bg-1', 'role-bg-2',
  'plus-role-title', 'plus-title', 'wenli-bg', 'vi-bg',
  'challenge-wrap', 'challenge-border'
]
const PC_SCOPES = ['data-v-0f16c268', 'data-v-3afa13e2', 'data-v-306522d0']

const html = fs.readFileSync(htmlPath, 'utf8')
const classes = new Set(BASE_CLASSES)
for (const m of html.matchAll(/class="([^"]+)"/g)) {
  for (const t of m[1].split(/\s+/)) if (t) classes.add(t)
}

const scopes = scopeArgs.map((s) => (s.startsWith('data-v-') ? s : `data-v-${s}`))

/** Tailwind 在 CSS 里对特殊字符做反斜杠转义，这里还原成同一套转义 */
const cssEscape = (token) => token.replace(/[[\]()%,#./:!]/g, (ch) => '\\' + ch)

const patterns = [...classes].map((t) => new RegExp('\\.' + cssEscape(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])'))

/** 1vw = 3.75 CSS px = 7.5px（750 画布） */
const fixBody = (body) => body.replace(/(-?[\d.]+)vw/g, (_, n) => `${Math.round(parseFloat(n) * 7.5 * 100) / 100}px`)

const collected = []
const seen = new Set()
let scanned = 0

for (const fn of CSS_FILES) {
  const file = path.join(h5Dir, fn)
  if (!fs.existsSync(file)) continue
  const src = fs.readFileSync(file, 'utf8')
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim()
    const body = m[2].trim()
    scanned++
    if (PC_SCOPES.some((s) => sel.includes(s))) continue
    const hit = patterns.some((p) => p.test(sel)) || scopes.some((s) => sel.includes(s))
    if (!hit) continue
    const key = sel + '|' + body
    if (seen.has(key)) continue
    seen.add(key)
    collected.push(`${sel}{${fixBody(body)}}`)
  }
}

const header = `/**
 * 官方版式规则子集（自动生成，勿手改）
 *
 * 生成：node example/extract-official-css.mjs <h5目录> ${path.basename(htmlPath)} ${path.basename(outPath)}
 * 来源：米游社「战绩」H5 编译产物（${CSS_FILES.join(' / ')}）
 * 作用域：${scopes.join(', ') || '（无）'}
 *
 * 尺寸口径：官方 375 设计稿，值写的是 calc(N * var(--gpx))；
 * 画布 750 = 375 × 2，故 --gpx 设为 2px。官方直接写 vw 的地方已换算成 px。
 */

:root {
  --gpx: 2px;
}

/* 官方字体 HYWenHei = 汉仪文黑，插件已有同款文件 */
@font-face {
  font-family: "HYWenHei";
  src: url("../../common/font/HYWH-65W.woff") format("woff"),
       url("../../common/font/HYWH-65W.ttf") format("truetype");
  font-weight: normal;
  font-style: normal;
}

`

fs.writeFileSync(outPath, header + collected.join('\n') + '\n', 'utf8')
console.log(`扫描 ${scanned} 条规则，命中 ${collected.length} 条 → ${outPath}（${(fs.statSync(outPath).size / 1024).toFixed(1)} KB）`)