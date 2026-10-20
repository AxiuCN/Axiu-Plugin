/**
 * 渲染资源完整性（`resources/**` 下的 CSS 与字体）
 *
 * 覆盖口径：
 * - 所有 CSS 的 `url(...)` 引用（含 `@font-face` 的字体文件）必须指向**真实存在**的文件：
 *   路径写错时浏览器只会静默回落（字体回落到系统字体、背景/图标直接不显示），页面照常出图，很难被发现
 * - 模板依赖的字体族必须都有 `@font-face` 定义（`YS` / `YS2` / `Number` / `NZBZ` / `SR` / `HWZS`）
 * - 说明块正文（`.cont-body`）用的 `YS` 家族必须指向存在的字体文件（本次回归点）
 *
 * 只读文件系统，不渲染、不联网。
 */
import fs from 'node:fs'
import path from 'node:path'
import { checker, pluginRoot } from './_helper.mjs'

const { check, finish } = checker()
const resRoot = path.join(pluginRoot, 'resources')
const commonCssPath = path.join(resRoot, 'common', 'common.css')

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name)
  return d.isDirectory() ? walk(p) : [p]
})
const cssFiles = walk(resRoot).filter(f => f.endsWith('.css'))

/** 收集某份 CSS 里所有 url() 引用（跳过 data:/http(s):/# 与内联 SVG） */
const urlRefs = (file) => {
  const css = fs.readFileSync(file, 'utf8')
  const out = []
  for (const m of css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
    const u = m[2].trim()
    if (/^(data:|https?:|#)/.test(u)) continue
    out.push({ url: u, target: path.resolve(path.dirname(file), u.split('?')[0]) })
  }
  return out
}

/* ==================== 【1】CSS 资源引用全部存在 ==================== */

console.log('【1】CSS 的 url() 引用（含字体文件）必须都存在')
let totalRefs = 0
const missing = []
for (const file of cssFiles) {
  for (const ref of urlRefs(file)) {
    totalRefs++
    if (!fs.existsSync(ref.target)) missing.push(`${path.relative(resRoot, file)} -> ${ref.url}`)
  }
}
check('扫描覆盖到足够多的 CSS 与引用（否则断言等于没跑）',
  cssFiles.length >= 10 && totalRefs >= 50, `${cssFiles.length} 个 CSS / ${totalRefs} 处引用`)
check('CSS 引用的资源全部存在（缺失会静默回落，出图看不出）',
  missing.length === 0, missing.slice(0, 8).join(' | '))

/* ==================== 【2】字体族定义齐全且文件存在 ==================== */

console.log('\n【2】字体族：@font-face 定义齐全，且每个 src 至少有一个真文件')
const commonCss = fs.readFileSync(commonCssPath, 'utf8')
/** 解析 @font-face 块：family → [url...] */
const fontFaces = {}
for (const m of commonCss.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)) {
  const block = m[1]
  const family = /font-family:\s*["']?([^;"'}]+)["']?/.exec(block)?.[1]?.trim()
  if (!family) continue
  const urls = [...block.matchAll(/url\((['"]?)([^'")]+)\1\)/g)]
    .map(x => x[2].trim())
    .filter(u => !/^(data:|https?:)/.test(u))
    .map(u => path.resolve(path.dirname(commonCssPath), u.split('?')[0]))
  fontFaces[family] = urls
}
const expectedFamilies = ['YS', 'YS2', 'Number', 'NZBZ', 'SR', 'HWZS']
const undefinedFamilies = expectedFamilies.filter(f => !fontFaces[f])
check('模板用到的字体族都有 @font-face 定义', undefinedFamilies.length === 0, undefinedFamilies.join(','))
const noFileFamilies = expectedFamilies.filter(f => fontFaces[f] && !fontFaces[f].some(p => fs.existsSync(p)))
check('每个字体族的 src 至少有一个真实文件', noFileFamilies.length === 0, noFileFamilies.join(','))

console.log('\n【3】说明块正文的 YS 字体（路径写错就会回落到系统字体）')
check('common.css 定义了 YS 且指向存在的字体文件',
  !!fontFaces.YS && fontFaces.YS.some(p => fs.existsSync(p)), (fontFaces.YS || []).join(' | '))
check('.cont-body（说明块正文）使用 YS 家族',
  /\.cont-body\s*\{[^}]*font-family:\s*[^;}]*YS/.test(commonCss))
check('YS 与 YS2 不再指向不存在的 HYWH-85W',
  !/HYWH-85W/i.test(commonCss))

/* ==================== 【4】模板引用的样式表存在 ==================== */

console.log('\n【4】模板里的样式表链接指向存在的文件')
const htmlFiles = walk(resRoot).filter(f => f.endsWith('.html'))
const badLinks = []
let linkCount = 0
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8')
  for (const m of html.matchAll(/href="\{\{\s*pluResPath\s*\}\}([^"]+)"/g)) {
    linkCount++
    const target = path.join(resRoot, m[1])
    if (!fs.existsSync(target)) badLinks.push(`${path.relative(resRoot, file)} -> ${m[1]}`)
  }
}
check('扫描覆盖到模板里的 pluResPath 链接', linkCount >= 5, `${linkCount} 处`)
check('模板引用的样式/资源文件都存在', badLinks.length === 0, badLinks.slice(0, 8).join(' | '))

finish()
