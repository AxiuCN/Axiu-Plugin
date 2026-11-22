/**
 * 从米游社「战绩」H5 的编译 CSS 里抽取某个页面用到的规则子集。
 *
 * 用法：
 *   node example/extract-official-css.mjs <h5目录> <页面 html 路径> <输出 css 路径> [选项] [额外作用域...]
 *
 * 例（幽境危战）：
 *   node example/extract-official-css.mjs .dsh/h5 \
 *     resources/challenge/GS/hard.html resources/challenge/GS/hard-official.css 1335dd8d 205cb0c1
 *
 * 例（深境螺旋，页面 class 里 .item/.card 这类通用名太多，只能按作用域收）：
 *   node example/extract-official-css.mjs .dsh/h5 \
 *     resources/challenge/GS/abyss.html resources/challenge/GS/abyss-official.css \
 *     --tw-only --classes=deep-look-back-role 2434f558 e8bb0a10 1a84555a 3c8f58c7 5aa409a4 a3d93ce2
 *
 * 选项：
 * - --tw-only        只按 tw-* 工具类 + 作用域匹配，不再按 html 里的 class 名匹配
 *                    （否则 .item / .card / .icon / .header 这类通用名会把整份 CSS 的无关规则吸进来）
 * - --classes=a,b    额外按 class 名匹配（用于没有 data-v 作用域的全局类，如 deep-look-back-role）
 *
 * 规则：
 * - 收「html 里出现的 class」+「指定 data-v 作用域」+「gt-avatar / card-bg 等组件基础类」的规则
 * - 排除 PC 版式作用域（0f16c268 / 3afa13e2 / 306522d0），否则会引用未镜像的 pc_* 图
 * - 官方尺寸是 calc(N * var(--gpx))，375 设计稿；本插件画布 750，用 --gpx: 2px 统一放大
 * - 官方少数直接写 vw 的，按 1vw = 7.5px（750 画布）换算成 px
 * - 字体统一成 HYWenHei / ysfont（均指向原神官方字体），官方写的 PingFang、微软雅黑一律改写
 *
 * 产物不要手改：官方改版后重跑本脚本即可。
 */
import fs from 'node:fs'
import path from 'node:path'

const [h5Dir, htmlPath, outPath, ...rest] = process.argv.slice(2)
if (!h5Dir || !htmlPath || !outPath) {
  console.error('用法: node example/extract-official-css.mjs <h5目录> <页面html> <输出css> [--tw-only] [--classes=a,b] [data-v 后缀...]')
  process.exit(1)
}

const flags = rest.filter((a) => a.startsWith('--'))
const scopeArgs = rest.filter((a) => !a.startsWith('--'))
const twOnly = flags.includes('--tw-only')
const extraClasses = flags
  .filter((a) => a.startsWith('--classes='))
  .flatMap((a) => a.slice('--classes='.length).split(','))
  .map((s) => s.trim())
  .filter(Boolean)

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
const classes = new Set(twOnly ? extraClasses : [...BASE_CLASSES, ...extraClasses])
if (!twOnly) {
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    for (const t of m[1].split(/\s+/)) if (t) classes.add(t)
  }
}
// 模板里的条件 class（如 {{if …}}tw-mr-2{{/if}}）会被拆碎，这里再全量扫一遍 tw-* token
const twScan = html.match(/tw-[A-Za-z0-9_[\]().,%#/-]+/g) || []
for (const t of twScan) classes.add(t.replace(/[),]+$/, ''))

const scopes = scopeArgs.map((s) => (s.startsWith('data-v-') ? s : `data-v-${s}`))

/** Tailwind 在 CSS 里对特殊字符做反斜杠转义，这里还原成同一套转义 */
const cssEscape = (token) => token.replace(/[[\]()%,#./:!]/g, (ch) => '\\' + ch)

const patterns = [...classes].map((t) => new RegExp('\\.' + cssEscape(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])'))

/** 1vw = 3.75 CSS px = 7.5px（750 画布）；字体统一到原神官方字体 */
const unifyFont = (body) => body.replace(/font-family:([^;}]+)/g, (_, v) => (
  /HYWenHei|ysfont/.test(v) ? `font-family:${v}` : 'font-family:HYWenHei, ysfont, sans-serif'
))
const fixBody = (body) => unifyFont(body).replace(/(-?[\d.]+)vw/g, (_, n) => `${Math.round(parseFloat(n) * 7.5 * 100) / 100}px`)

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
 * 生成：node example/extract-official-css.mjs <h5目录> ${path.basename(htmlPath)} ${path.basename(outPath)} ${[...flags, ...scopes].join(' ')}
 * 来源：米游社「战绩」H5 编译产物（${CSS_FILES.join(' / ')}）
 * 作用域：${scopes.join(', ') || '（无）'}
 *
 * 尺寸口径：官方 375 设计稿，值写的是 calc(N * var(--gpx))；
 * 画布 750 = 375 × 2，故 --gpx 设为 2px。官方直接写 vw 的地方已换算成 px。
 * 字体口径：官方写的 PingFang / 微软雅黑一律改写成 HYWenHei / ysfont（同一份官方字体）。
 */

:root {
  --gpx: 2px;
}

/* Tailwind 的 transform / backdrop 工具类依赖这些 CSS 变量的默认值（官方在 preflight 里定义）。
   缺了它们，tw-scale-* / tw-translate-* / tw-backdrop-* 会算出非法值 → 浏览器回退 none，
   表现为「缩放没生效、模糊没生效」。 */
*,
::before,
::after {
  --tw-translate-x: 0;
  --tw-translate-y: 0;
  --tw-rotate: 0;
  --tw-skew-x: 0;
  --tw-skew-y: 0;
  --tw-scale-x: 1;
  --tw-scale-y: 1;
  --tw-ring-offset-width: 0px;
  --tw-ring-offset-color: #fff;
  --tw-ring-color: rgba(59, 130, 246, 0.5);
  --tw-ring-offset-shadow: 0 0 rgba(0, 0, 0, 0);
  --tw-ring-shadow: 0 0 rgba(0, 0, 0, 0);
  --tw-shadow: 0 0 rgba(0, 0, 0, 0);
  --tw-shadow-colored: 0 0 rgba(0, 0, 0, 0);
  --tw-blur: ;
  --tw-brightness: ;
  --tw-contrast: ;
  --tw-grayscale: ;
  --tw-hue-rotate: ;
  --tw-invert: ;
  --tw-saturate: ;
  --tw-sepia: ;
  --tw-drop-shadow: ;
  --tw-backdrop-blur: ;
  --tw-backdrop-brightness: ;
  --tw-backdrop-contrast: ;
  --tw-backdrop-grayscale: ;
  --tw-backdrop-hue-rotate: ;
  --tw-backdrop-invert: ;
  --tw-backdrop-opacity: ;
  --tw-backdrop-saturate: ;
  --tw-backdrop-sepia: ;
}

/* 字体：统一使用 resources/common/font/hk4e_zh-cn.ttf
   （原神官方字体合集 HYWenHei-85W，CJK + Latin + 数字全覆盖）。
   官方的排版链是 HYWenHei → ysfont，这里两个名字指向同一份文件，
   于是不论规则写哪个名字，出来的都是同一个官方字形。 */
@font-face {
  font-family: "HYWenHei";
  src: url("../../common/font/hk4e_zh-cn.ttf") format("truetype");
  font-weight: normal;
  font-style: normal;
}

@font-face {
  font-family: "ysfont";
  src: url("../../common/font/hk4e_zh-cn.ttf") format("truetype");
  font-weight: normal;
  font-style: normal;
}
`

fs.writeFileSync(outPath, header + collected.join('\n') + '\n', 'utf8')
console.log(`扫描 ${scanned} 条规则，命中 ${collected.length} 条 → ${outPath}（${(fs.statSync(outPath).size / 1024).toFixed(1)} KB）`)