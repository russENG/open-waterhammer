#!/usr/bin/env node
/**
 * 静的デモページ（画面写真つき手順書）を生成する。
 *
 *   node scripts/build-demo-pages.mjs
 *
 * 画面写真と実測値は Playwright の `demo-capture.spec.ts` が
 * `apps/web-free/public/demo/img/*.png` と `apps/web-free/public/demo/measured.json`
 * に書き出す。ここではそれを読んで HTML を組み立てるだけなので、
 * 「手順書の画面写真が実装とずれる」ことが起きない。
 *
 * 手順の本文は docs/demo-plan.md と同じ内容を要約したもの。数値は measured.json 由来。
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'apps', 'web-free', 'public', 'demo')
const MEASURED = join(OUT, 'measured.json')

const measured = existsSync(MEASURED) ? JSON.parse(readFileSync(MEASURED, 'utf8')) : {}

/** measured.json の「ラベル\n値」形式のサマリー帯を、表の行に直す。 */
function metricRows(key) {
  const items = Array.isArray(measured[key]) ? measured[key] : []
  return items
    .map((entry) => String(entry).split('\n').filter(Boolean))
    .filter((parts) => parts.length >= 2)
    .map((parts) => [parts[0], parts.slice(1).join(' ')])
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function table(rows, headers = ['項目', '値']) {
  if (rows.length === 0) return '<p class="muted">（この画面では測定していません）</p>'
  const head = headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('\n        ')
  return `<div class="table-scroll"><table>\n        <thead><tr>${head}</tr></thead>\n        <tbody>\n        ${body}\n        </tbody>\n      </table></div>`
}

function list(items) {
  if (items.length === 0) return ''
  return `<ul>\n        ${items.map((item) => `<li>${item}</li>`).join('\n        ')}\n      </ul>`
}

const importWarnings = Array.isArray(measured.importWarnings) ? measured.importWarnings : []

const STEPS = [
  {
    slug: '01-start',
    title: '作業を始める',
    lead: 'ブラウザの中だけで完結することを最初に示す。',
    image: 's0-start',
    caption: '開始画面。Excelから開始／空から始める／サンプルを開く の3導線。',
    body: `
      <p>計算はすべて利用者の手元のブラウザで走る。入力条件と作業状態は IndexedDB に保存され、GitHub Pages のサーバーへは送信されない。共有や作業再開には <code>.owhproj</code> を書き出す。</p>
      <p class="talk">話す一言：「計算はすべて手元のブラウザの中です。施設情報がサーバーに出ません」</p>`,
  },
  {
    slug: '02-template',
    title: '入力テンプレートを取得する',
    lead: 'Excelの5シートが、そのまま成果品様式の入力側になる。',
    image: 's0-start',
    caption: `「入力テンプレートをダウンロード」で ${escapeHtml(measured.templateFileName ?? 'waterhammer-template.xlsx')} が保存される。`,
    body: `
      ${table([
        ['使い方', 'Excelは初期一括入力。読込後はWeb画面が正本'],
        ['案件情報', '案件名・設計者・適用基準・静水位 → 成果品様式③ 案件情報'],
        ['管路・節点', '管種・内径・管厚・延長・粗度係数・許容圧力 → 成果品様式② 管路データ'],
        ['シナリオ設定', '急閉そく tν=0.5 s と緩閉そく tν=10 s の2ケース → 成果品様式① 計算結果'],
        ['測点データ', '31測点（農水省 成果品様式 記載例 Ⅱ-170〜171）→ 成果品様式④ 水理計算書'],
      ], ['シート', '内容'])}
      <p>同梱値は φ600 ダクタイル鋳鉄管の1路線として全シートが整合している。落としたファイルをそのまま読み込めば、この先の手順がすべて通る。</p>`,
  },
  {
    slug: '03-import',
    title: 'Excelを取り込む',
    lead: '既定値で補完した項目を、作業画面へ進む前に見せる。',
    image: 's2-import-report',
    caption: measured.importReportHeading ?? '取込の注意事項レポート',
    body: `
      <p>取込に成功しても、既定値で補完した項目や正本の値で読み替えた項目があれば、その一覧を出してから作業画面へ進む。計算結果を左右する補完を黙って通さないため。</p>
      ${list(importWarnings.map((warning) => escapeHtml(warning)))}
      <p class="talk">話す一言：「Excelの検証に通った場合だけプロジェクトを作ります。入力エラーなら空のプロジェクトは残しません」</p>`,
  },
  {
    slug: '04-scenario',
    title: 'シナリオを確認する',
    lead: '比較案とシナリオの切り分けを説明する。',
    image: 's4-scenario',
    caption: '急閉そく／緩閉そくの2シナリオがExcelから入っている。',
    body: `
      <p><strong>比較案</strong>は設備諸元や管路網の違い、<strong>シナリオ</strong>は境界条件と操作の違い。分けて記録する。</p>
      <p>記録内容は項目名と単位つきの一覧で表示され、正準JSONは「詳細設定」に畳んである。</p>`,
  },
  {
    slug: '05-joukowsky',
    title: 'A02 Joukowsky / Allievi で水撃圧を求める',
    lead: '成果品様式①「計算結果」シートの中核。',
    image: 's5-results',
    caption: '結果タブ。方式ごとの主要指標を単位つきで表示する。',
    body: `
      ${table(metricRows('a02Summary'))}
      <p>閉そく区分は 2L/a と等価閉そく時間 tν の比で決まる。急閉そくならジューコフスキー式、緩閉そくならアリエビ式を適用する（技術書 §8.3.2）。</p>
      <p>管路に許容圧力（呼び圧力）が入っていれば、設計水圧との判定がここで走る。判定結果は成果品様式①の「設計水圧／許容圧力／余裕度／判定」列に出力される。</p>
      <p class="talk">話す一言：「同じ入力なら同じ由来情報ハッシュになります。再現性の担保はここです」</p>`,
  },
  {
    slug: '06-longitudinal',
    title: 'L01 縦断水理計算で設計内圧を出す',
    lead: '成果品様式④「水理計算書」24列そのもの。',
    image: 's6-longitudinal-results',
    caption: '縦断水理計算の結果。',
    body: `
      ${table(metricRows('l01Summary'))}
      <p>測点ごとに、単距離 Lh・地盤高 GL・管中心高 FH・管長 SL・流量 Q・管径 D・流速係数 CI（入力側）と、動水勾配・流速 V・速度水頭 hv・摩擦損失水頭 hf・損失係数計 Σf・その他損失水頭計 Σhc・全損失水頭 h・ｴﾈﾙｷﾞｰ標高 EL・動水位 WLm・動水頭 hm・静水圧 Ps・水撃圧 Pi・設計内圧 Pp（計算側）を出す。</p>
      <p>水撃圧 Pi は、A02 で求めた値を「水撃圧 [MPa]」欄に入れると設計値として反映される。空欄なら静水圧×40%の仮算定になり、その旨が警告に出る。静水圧が0以下の区間では比例算定を適用せず、Pi・Pp とも空欄にする。</p>`,
  },
  {
    slug: '07-reports',
    title: '成果品様式を書き出す',
    lead: '再計算せず、保存済みの計算結果から1冊にまとめる。',
    image: 's7-reports',
    caption: measured.reportNote ?? '帳票タブ',
    body: `
      ${table([
        ['① 計算結果', 'ケース諸元・波速・T₀・α・閉そく区分・ΔH・水撃圧・設計水圧・許容圧力・余裕度・判定（21列）'],
        ['④ 水理計算書_&lt;ケース名&gt;', '測点ごとの26列（成果品様式24列＋許容圧力・判定）'],
        ['② 管路データ', '管路ID・管種・D・t・L・粗度係数・始終点節点（9列）'],
        ['③ 案件情報', '案件名・設計者・作成日付・適用基準・バージョン・計算方法（8行）'],
      ], ['シート', '内容'])}
      <p>帳票の対象はプロジェクト内の成功した計算結果すべて。①と④が別ファイルに分かれない。</p>
      <p>あわせて、選択した計算結果1件の Excel帳票（<code>.xlsx</code>）と計算記録JSON（<code>.json</code>）も書き出せる。JSONには由来情報のハッシュが入る。</p>`,
  },
  {
    slug: '08-transient',
    title: 'T01 単一管路の過渡解析（補足）',
    lead: '時刻歴と圧力包絡を図で見せる。',
    image: 's8-transient-results',
    caption: '時系列・圧力包絡・縦断の3図。CSV / SVG / PNG で書き出せる。',
    body: `
      ${table(metricRows('t01Summary'))}
      <p>ジューコフスキー式は最大値だけを与えるが、特性曲線法は時刻歴を出す。最小水頭が負圧域に入る管路は自動判定で指摘され、水柱分離の検討が要ることが分かる。</p>
      <p>成果品様式には直接載らないため、時間があるときだけ見せる。</p>`,
  },
  {
    slug: '09-compare',
    title: '比較案を並べる',
    lead: '条件と結果の差分を、採否ではなく比較材料として出す。',
    image: 's7-compare',
    caption: '比較タブ。変更理由・系譜・最新の計算結果と、条件・結果の差分。',
    body: `
      <p>計算に成功した比較案は固定され、条件を変えるには「複製して編集」で変更理由を残す。系譜と変更理由が残るので、なぜその条件にしたかが後から追える。</p>
      <p>差分表は要約値だけを並べる。時系列や圧力包絡の格子点ごとの値は、結果タブの図に任せる。</p>`,
  },
]

const STYLE = `:root {
  --bg: #ffffff; --fg: #1b1d21; --muted: #5f646d; --line: #d8dce3;
  --accent: #1a3d6d; --card: #f6f7f9;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #14161a; --fg: #e8eaee; --muted: #a2a8b3; --line: #333941; --accent: #8fb6ea; --card: #1b1e24; }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
  line-height: 1.75;
}
header.site {
  display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center;
  padding: 12px 24px; border-bottom: 1px solid var(--line);
  position: sticky; top: 0; background: var(--bg); z-index: 2;
}
header.site strong { font-size: 14px; letter-spacing: .02em; }
header.site nav { display: flex; flex-wrap: wrap; gap: 14px; font-size: 13px; }
header.site a { color: var(--muted); text-decoration: none; }
header.site a:hover, header.site a[aria-current] { color: var(--accent); text-decoration: underline; }
main { max-width: 980px; margin: 0 auto; padding: 28px 24px 72px; }
h1 { font-size: 24px; line-height: 1.4; margin: 0 0 6px; }
h2 { font-size: 16px; margin: 32px 0 8px; }
.eyebrow { font-size: 12px; letter-spacing: .14em; color: var(--muted); text-transform: uppercase; }
.lead { color: var(--muted); margin: 0 0 24px; }
figure { margin: 0 0 20px; }
figure img {
  width: 100%; height: auto; display: block;
  border: 1px solid var(--line); border-radius: 8px; background: var(--card);
}
figcaption { font-size: 12px; color: var(--muted); margin-top: 8px; }
.table-scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 0 0 16px; }
th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: var(--card); font-weight: 600; white-space: nowrap; }
ul { padding-left: 22px; }
li { font-size: 13px; margin: 3px 0; }
code { background: var(--card); padding: 1px 5px; border-radius: 4px; font-size: .92em; }
.talk { border-left: 3px solid var(--accent); padding: 4px 0 4px 14px; margin: 16px 0; color: var(--muted); }
.muted { color: var(--muted); font-size: 13px; }
.pager { display: flex; justify-content: space-between; gap: 16px; margin-top: 48px; padding-top: 20px; border-top: 1px solid var(--line); font-size: 13px; }
.pager a { color: var(--accent); text-decoration: none; }
.pager a:hover { text-decoration: underline; }
ol.toc { padding-left: 0; list-style: none; counter-reset: step; display: grid; gap: 10px; }
ol.toc li { counter-increment: step; margin: 0; }
ol.toc a {
  display: block; padding: 12px 16px; border: 1px solid var(--line); border-radius: 8px;
  text-decoration: none; color: inherit; font-size: 14px;
}
ol.toc a:hover { border-color: var(--accent); }
ol.toc a::before { content: counter(step, decimal-leading-zero) " · "; color: var(--muted); }
ol.toc small { display: block; color: var(--muted); font-size: 12px; }
`

function page({ title, activeSlug, content }) {
  const nav = STEPS.map((step) => {
    const current = step.slug === activeSlug ? ' aria-current="page"' : ''
    return `<a href="./${step.slug}.html"${current}>${escapeHtml(step.title.split('（')[0].slice(0, 12))}</a>`
  }).join('')
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Open Waterhammer デモ手順</title>
<meta name="description" content="Open Waterhammer のデモ手順（画面写真つき）。Excel入力からブラウザ内計算、農水省 成果品様式の書き出しまで。">
<link rel="stylesheet" href="./style.css">
</head>
<body>
<header class="site">
  <strong>Open Waterhammer</strong>
  <nav aria-label="デモ手順">
    <a href="../">作業画面</a>
    <a href="./">デモ手順 目次</a>
    ${nav}
  </nav>
</header>
<main>
${content}
</main>
</body>
</html>
`
}

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'style.css'), STYLE, 'utf8')

// 目次
const toc = STEPS.map((step) => `<li><a href="./${step.slug}.html">${escapeHtml(step.title)}<small>${escapeHtml(step.lead)}</small></a></li>`).join('\n      ')
writeFileSync(join(OUT, 'index.html'), page({
  title: 'デモ手順',
  activeSlug: null,
  content: `<span class="eyebrow">静的版</span>
<h1>デモ手順（画面写真つき）</h1>
<p class="lead">Excelの入力テンプレートを落とし、そのまま取り込み、ブラウザ内で計算し、農水省の成果品様式で書き出すまで。実際にアプリを操作して撮った画面です。</p>
<h2>手順</h2>
<ol class="toc">
      ${toc}
</ol>
<h2>この手順でカバーする成果品様式</h2>
${table([
  ['① 計算結果', 'ケース諸元・波速 a・振動周期 T₀・α・閉そく区分・ΔH・水撃圧・設計水圧・許容圧力・余裕度・判定', '05'],
  ['② 管路データ', '管路ID・管路名・管種・内径 D・管厚 t・延長 L・粗度係数・始終点節点', '02'],
  ['③ 案件情報', '案件名・設計者・作成日付・適用基準・バージョン・計算方法', '03'],
  ['④ 水理計算書', '測点ごとの Lh/GL/FH/SL/Q/D/CI・動水勾配・V/hv/hf・fb/fv/fβ/Σf/Σhc・h/EL/WLm/hm・Ps/Pi/Pp・許容圧力・判定', '06'],
], ['シート', '項目', '手順'])}
<p class="muted">この一連のページは <code>scripts/build-demo-pages.mjs</code> が生成し、画面写真は Playwright の <code>demo-capture.spec.ts</code> が実機から撮っています。実装を変えたら再生成してください。</p>`,
}), 'utf8')

// 各手順
STEPS.forEach((step, index) => {
  const previous = STEPS[index - 1]
  const next = STEPS[index + 1]
  const content = `<span class="eyebrow">手順 ${String(index + 1).padStart(2, '0')} / ${String(STEPS.length).padStart(2, '0')}</span>
<h1>${escapeHtml(step.title)}</h1>
<p class="lead">${escapeHtml(step.lead)}</p>
<figure>
  <img src="./img/${step.image}.png" alt="${escapeHtml(step.title)}の画面">
  <figcaption>${escapeHtml(step.caption)}</figcaption>
</figure>
${step.body}
<nav class="pager">
  <span>${previous ? `<a href="./${previous.slug}.html">← ${escapeHtml(previous.title)}</a>` : '<a href="./">← 目次</a>'}</span>
  <span>${next ? `<a href="./${next.slug}.html">${escapeHtml(next.title)} →</a>` : '<a href="./">目次へ →</a>'}</span>
</nav>`
  writeFileSync(join(OUT, `${step.slug}.html`), page({ title: step.title, activeSlug: step.slug, content }), 'utf8')
})

console.log(`デモページを生成しました: ${STEPS.length + 1} ファイル → ${OUT}`)
