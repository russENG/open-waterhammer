# open-waterhammer

> 農業用パイプライン水撃圧計算のオープンソース実装
> Open-source water hammer calculation for agricultural pipelines

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

土地改良事業計画設計基準 設計「パイプライン」技術書（令和3年6月改訂）に準拠した
水撃圧計算ツール。**ブラウザだけで動作**し、サーバーは不要。

🌐 **公開サイト**: <https://russeng.github.io/open-waterhammer/>

---

## 特徴

- **設計基準準拠**: 技術書 §7（定常流）・§8（非定常／水撃圧）の式を素直に実装
- **ブラウザ完結**: GitHub Pages にホスト。Pyodide で Python core をブラウザ実行
- **計算ライブラリ層**: 全計算式を一覧・トレース可能にした計算ライブラリページを併設
- **学習用ノートブック**: Marimo によるリアクティブ notebook をブラウザ上で実行
- **EPANET 統合**: 定常網計算は米国 EPA EPANET の WASM 移植 (`epanet-js`) に委譲
- **Excel 入出力**: 入力テンプレート・成果品様式（水理計算書）の生成に対応
- **セッション機能**: 入力条件・計算条件・結果を一体的に保存・比較・出力

---

## 提供する計算

| カテゴリ | 主な内容 |
|---|---|
| **波速・閉そく判定** | 技術書 式(8.2.4) 波速 a、振動周期 T₀、急/緩閉そく区分 |
| **単管路の簡易式** | Joukowsky（急閉そく）、Allievi（緩閉そく） |
| **経験則** | 給水栓配水系の5系統別評価（§8.3.5） |
| **定常流** | Hazen-Williams 式・Darcy-Weisbach 式 |
| **管路網定常** | 樹枝状管路網（EPANET エンジン + 自前実装の選択可能） |
| **MOC（特性曲線法）** | 単管路・管路網の非定常水撃圧解析（§8.4） |
| **防護工** | エアチャンバ、サージタンク、吸気弁、減圧バルブ、行き止まり |
| **判定** | 設計水圧 vs 許容圧の3段階判定 |
| **帳票** | 水理計算書（成果品様式）、セッションレポート（Excel） |

---

## 使う

ブラウザで <https://russeng.github.io/open-waterhammer/> を開くだけ。インストール不要。

### 動線

- **計算** — メイン計算ページ。Excel 入力、簡易式、MOC、防護工、帳票出力
- **基準照会** — 土地改良基準 PDF の関連箇所をトピック単位で参照
- **計算ライブラリ** — 全計算式の数式・入出力・適用条件・GitHub ソースを一覧
- **計算ノートブック** — Marimo による対話的学習 notebook（[notebooks/](./notebooks/)）
- **設計フロー** — 標準的な水撃圧検討の流れ
- **水理俯瞰** — 定常〜非定常までの理論的な俯瞰

---

## 開発

### 構成

```
open-waterhammer/
├── packages/
│   ├── core/              ← TypeScript core（型・データ・薄いラッパ）
│   ├── core-py/           ← 計算実装の単一の真理源（Python, AGPL-3.0）
│   ├── epanet-adapter/    ← epanet-js (WASM) のラッパ — 定常網
│   ├── excel-io/          ← Excel 入出力（exceljs）
│   ├── sample-data/       ← デモデータ
│   └── standards/         ← 設計基準メタ情報
├── apps/
│   └── web-free/          ← React + Vite ブラウザアプリ
├── notebooks/             ← Marimo 学習用ノートブック
├── scripts/               ← ビルドスクリプト
└── docs/                  ← 設計ドキュメント・基準PDF参照
```

**単一の真理源**: 計算実装は `packages/core-py/open_waterhammer/` の Python パッケージ。
ブラウザでは Pyodide 経由で同じ `.py` を実行する。

### セットアップ

前提: Node.js ≥ 20、Python ≥ 3.11

```bash
npm install
pip install marimo  # ノートブックを書く/エクスポートする場合のみ
```

### 開発サーバ

```bash
npm run dev --workspace=apps/web-free
```

### ビルド

```bash
# Python core テスト
cd packages/core-py && pytest

# TS core テスト
npm test --workspaces

# ノートブックを WASM HTML にエクスポート
node scripts/build-notebooks.mjs

# 全体ビルド
npm run build
```

### テスト

| パッケージ | テスト数 |
|---|---|
| core (TS) | 156 |
| epanet-adapter | 9 |
| excel-io | 22 |
| core-py (pytest) | 108 |
| **合計** | **295件** |

`npm test --workspaces` で全 TS テストを実行。`cd packages/core-py && pytest` で Python テストを実行。

---

## 学術発表

第75回農業農村工学会大会講演会（2026年度）で発表予定:

> 設計実務者を対象とした水路非定常計算機能へのOSS適用と限界

要旨では本ツールの「計算ロジックの追跡可能性」「条件追跡・再計算性」「適用範囲と限界」を整理。

---

## ライセンス

[**AGPL-3.0-or-later**](https://www.gnu.org/licenses/agpl-3.0.html)

商用・非商用を問わず利用可能。ただし**改変・ネットワーク提供を行う場合はソースコードの公開**が必要。

### Why AGPL?

水撃圧の評価ロジックは公共財として共有されるべきという立場から、改変版を非公開のまま運用することを許容しない強コピーレフトを採用しています。詳細は本サイト「about」ページの思想節を参照。

---

## 参考文献

1. 農林水産省 農村振興局 整備部 設計課 (2021)
   *土地改良事業計画設計基準 設計「パイプライン」技術書（令和3年6月改訂）*
2. Raymond, E. S. (1999) *The Cathedral and the Bazaar*
3. Lessig, L. (2001) *The Future of Ideas*

---

## クレジット

- **EPANET**: U.S. Environmental Protection Agency (https://www.epa.gov/water-research/epanet)
- **epanet-js**: Luke Butler ほか (https://github.com/epanet-js/epanet-js, MIT)
- **Pyodide**: Mozilla / Open Source contributors (https://pyodide.org/, MPL-2.0)
- **Marimo**: marimo team (https://marimo.io/, Apache-2.0)
- **exceljs**: guyonroche (https://github.com/exceljs/exceljs, MIT)
- **KaTeX**: Khan Academy (https://katex.org/, MIT)
- **React / Vite**: Meta / Evan You ほか
