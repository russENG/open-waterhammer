#!/usr/bin/env node
/**
 * Marimo notebook を WASM HTML としてエクスポートし、
 * apps/web-free/public/notebooks/ に配置する。
 *
 * Stage 8（Python 移行 §計画）:
 * 学習用・検算用 notebook を GitHub Pages 上に併置する。
 * 配置先 public/ は Vite ビルド時に dist/ にコピーされ、
 * /notebooks/index.html で一覧可能になる。
 *
 * 実行: node scripts/build-notebooks.mjs
 * 前提: pip install marimo （`python -m marimo` で起動できること）
 */

import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync, existsSync, rmSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const NOTEBOOKS_DIR = resolve(ROOT, "notebooks");
const OUTPUT_DIR = resolve(ROOT, "apps/web-free/public/notebooks");

// ─── ノートブック一覧（順序固定） ───────────────────────────────────────────

const NOTEBOOKS = [
  {
    file: "01_wave_speed_explorer.py",
    slug: "wave-speed",
    title: "波速エクスプローラ",
    description: "管種・管厚・管径が波速 a に与える影響を可視化する（技術書 §8.2 式 8.2.4）",
  },
  {
    file: "02_joukowsky_vs_allievi.py",
    slug: "joukowsky-vs-allievi",
    title: "Joukowsky vs Allievi",
    description: "急閉そく/緩閉そくの境界と最大水撃圧の遷移を観察する（技術書 §8.3.4）",
  },
  {
    file: "03_air_chamber_effect.py",
    slug: "air-chamber-effect",
    title: "エアチャンバの防護効果",
    description: "MOC でポンプ急停止時の包絡線をエアチャンバありなしで比較（技術書 §8.4）",
  },
  {
    file: "04_verification_benchmarks.py",
    slug: "verification-benchmarks",
    title: "検証ベンチマーク",
    description: "定常・非定常の計算が解析解（H-W 閉形式／ジューコフスキー／アリエビ連鎖式）と一致することを確認し、適用限界を示す",
  },
];

// ─── ビルド本体 ─────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[build-notebooks] ${msg}`);
}

/** marimo が cwd から拾ってしまうノートブック無関係ファイル */
const SPURIOUS_FILES = ["CLAUDE.md", "README.md", "LICENSE", "AGENTS.md"];

function cleanSpuriousFiles(dst) {
  for (const f of SPURIOUS_FILES) {
    const p = resolve(dst, f);
    if (existsSync(p)) rmSync(p, { force: true });
  }
}

function buildOne(notebook) {
  const src = resolve(NOTEBOOKS_DIR, notebook.file);
  const dst = resolve(OUTPUT_DIR, notebook.slug);

  if (!existsSync(src)) {
    throw new Error(`Source notebook not found: ${src}`);
  }

  log(`Building ${notebook.file} → ${notebook.slug}/`);
  execSync(
    `python -m marimo export html-wasm "${src}" -o "${dst}" --mode run`,
    { stdio: "inherit", cwd: ROOT },
  );
  cleanSpuriousFiles(dst);
}

function dirSize(p) {
  let total = 0;
  for (const f of readdirSync(p, { withFileTypes: true })) {
    const fp = resolve(p, f.name);
    total += f.isDirectory() ? dirSize(fp) : statSync(fp).size;
  }
  return total;
}

function generateIndex() {
  log("Generating index.html");
  const cards = NOTEBOOKS.map(
    nb => `    <li class="notebook-card">
      <a href="./${nb.slug}/" class="notebook-card-link">
        <h2 class="notebook-card-title">${nb.title}</h2>
        <p class="notebook-card-desc">${nb.description}</p>
        <p class="notebook-card-cta">notebook を開く →</p>
      </a>
    </li>`,
  ).join("\n");

  const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>計算ノートブック — open-waterhammer</title>
  <meta name="description" content="open-waterhammer 学習用ノートブック集（Marimo, ブラウザ上で実行可能）">
  <style>
    :root { --primary: #1a1a2e; --bg: #fafbfd; --card: #fff; --border: #d8dde7; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Hiragino Sans", "Yu Gothic", sans-serif; background: var(--bg); color: #1a1a1a; margin: 0; padding: 0; }
    .wrap { max-width: 900px; margin: 0 auto; padding: 32px 20px; }
    header { padding: 20px 24px; background: linear-gradient(135deg, #f8f9fb 0%, #eef2f6 100%); border-left: 4px solid var(--primary); border-radius: 4px; margin-bottom: 24px; }
    h1 { margin: 0 0 8px 0; font-size: 1.6rem; color: var(--primary); }
    .lead { margin: 0 0 6px 0; line-height: 1.6; color: #333; }
    .lead-sub { margin: 0; font-size: 0.88rem; color: #666; }
    .back-link { display: inline-block; margin-top: 16px; color: var(--primary); text-decoration: none; font-size: 0.9rem; }
    .back-link:hover { text-decoration: underline; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
    .notebook-card { background: var(--card); border: 1px solid var(--border); border-radius: 6px; transition: box-shadow 0.15s, border-color 0.15s; }
    .notebook-card:hover { border-color: var(--primary); box-shadow: 0 2px 8px rgba(26, 26, 46, 0.08); }
    .notebook-card-link { display: block; padding: 18px 22px; text-decoration: none; color: inherit; }
    .notebook-card-title { margin: 0 0 6px 0; font-size: 1.1rem; color: var(--primary); }
    .notebook-card-desc { margin: 0 0 10px 0; font-size: 0.92rem; line-height: 1.55; color: #444; }
    .notebook-card-cta { margin: 0; font-size: 0.85rem; color: var(--primary); font-weight: 500; }
    footer { margin-top: 32px; padding: 16px 20px; background: #fafbfd; border: 1px solid #e6e9ef; border-radius: 6px; font-size: 0.85rem; color: #555; line-height: 1.6; }
    footer code { background: #fff; padding: 1px 6px; border: 1px solid #ddd; border-radius: 3px; font-size: 0.85em; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>計算ノートブック</h1>
      <p class="lead">open-waterhammer の計算ロジックを <strong>ブラウザ上で対話的に探索</strong> できる学習用 notebook 集。</p>
      <p class="lead-sub">各ノートブックは <a href="https://marimo.io" target="_blank" rel="noreferrer">Marimo</a> 製。WebAssembly 上の Python (Pyodide) で実行され、サーバーは不要。</p>
      <a href="../" class="back-link">← トップに戻る</a>
    </header>

    <ul>
${cards}
    </ul>

    <footer>
      <p>計算実装の単一の真理源は <code>packages/core-py/open_waterhammer/</code> （AGPL-3.0-or-later）。</p>
      <p>ノートブックは教育目的の簡略実装を含むことがあるため、業務利用ではコア実装側を参照すること。</p>
    </footer>
  </div>
</body>
</html>
`;
  writeFileSync(resolve(OUTPUT_DIR, "index.html"), html, "utf8");
}

// ─── メイン ─────────────────────────────────────────────────────────────────

function main() {
  // marimo の存在確認
  try {
    execSync("python -m marimo --version", { stdio: "pipe" });
  } catch {
    console.error("[build-notebooks] ERROR: `python -m marimo` が見つかりません。`pip install marimo` してください。");
    process.exit(1);
  }

  // 出力ディレクトリの再作成
  if (existsSync(OUTPUT_DIR)) {
    log(`Cleaning ${OUTPUT_DIR}`);
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // 各ノートブックをビルド
  for (const nb of NOTEBOOKS) {
    buildOne(nb);
  }

  generateIndex();

  // 結果サマリ
  const built = readdirSync(OUTPUT_DIR).filter(f => f !== "index.html");
  const totalMB = (dirSize(OUTPUT_DIR) / 1024 / 1024).toFixed(1);
  log(`Built ${built.length} notebook(s): ${built.join(", ")}`);
  log(`Total size: ${totalMB} MB`);
  log("Done.");
}

main();
