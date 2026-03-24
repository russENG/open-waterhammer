# アーキテクチャ設計

## 1. リポジトリ構成（モノレポ）

```
open-waterhammer/
├── package.json          # ルート (npm workspaces)
├── tsconfig.json         # ルートTSConfig（全パッケージ継承）
├── .gitignore
├── docs/
│   ├── spec.md
│   ├── architecture.md   # 本ファイル
│   ├── excel-template-spec.md
│   ├── standards-mapping.md
│   ├── validation-plan.md    (予定)
│   └── contributing.md       (予定)
├── packages/
│   ├── core/             # 計算エンジン・ドメインモデル
│   ├── standards/        # 基準プロファイル
│   ├── excel-io/         # Excel入出力
│   ├── epanet-adapter/   # 定常計算（EPANET連携）
│   ├── report-basic/     # 無料版出力（表・グラフ）
│   └── sample-data/      # サンプル・デモデータ
└── apps/
    ├── web-free/         # 無料Webアプリ
    └── web-pro/          (Phase 2以降)
```

---

## 2. パッケージ責務と依存関係

```
sample-data ──→ core
standards   ──→ core
excel-io    ──→ core
epanet-adapter ──→ core
report-basic ──→ core

web-free ──→ core, standards, excel-io, report-basic, sample-data
```

**依存の向きは常に `core` に向かう。`core` は他パッケージに依存しない。**

### `@open-waterhammer/core`
- ドメインモデル型定義（`types.ts`）
- 管材物性値テーブル（`pipe-materials.ts`）
- 基礎式実装（`formulas.ts`）
  - 波速算定: 式(8.2.4)
  - ジューコフスキーの式: 式(8.3.6)
  - アリエビの近似式: 式(8.3.7, 8.3.8)
  - 等価管路長: 式(8.3.9)
  - 設計水圧: 式(8.3.2)
- 簡易計算エンジン（`simple-calculation.ts`）

### `@open-waterhammer/standards`
- `StandardProfile` 型定義
- `nochi_pipeline_2021`: 農水パイプライン基準プロファイル
- （Phase 3以降）水道・下水・発電用水力基準プロファイル

### `@open-waterhammer/excel-io`
- Excelワークブックの読み込み・書き出し
- `excel-template-spec.md` のスキーマに準拠
- ライブラリ候補: [xlsx](https://www.npmjs.com/package/xlsx)（ブラウザ対応）

### `@open-waterhammer/epanet-adapter`
- EPANET系による定常流況計算
- 初期流速・動水位を計算してcoreに渡す
- ブラウザ内処理優先（WASM版EPANET検討）

### `@open-waterhammer/report-basic`
- 結果表・グラフ・画像出力（無料版）
- ケース別シート出力
- エンベロープ（最大・最小包絡線）
- 採用基準・手法識別子・バージョンを必ず記載

### `@open-waterhammer/sample-data`
- デモケース（Excelテンプレート不要で即実行可能）
- 検証データ（参照例題との比較用）
- ダウンロード可能なExcelテンプレート（`.xlsx`）を同梱

---

## 3. 設計原則

### 3.1 ブラウザファーストの処理フロー

```
ブラウザ
  ↓ Excelアップロード または デモデータ選択
excel-io（Excel解析）または sample-data（デモ）
  ↓ PipelineNetwork + CalculationCase[]
epanet-adapter（定常計算・WASM）
  ↓ 初期流速・動水位
core（水撃圧計算）
  ↓ SimpleFormulaResult[] or TransientResult[]
report-basic（表・グラフ生成）
  ↓ ダウンロード または 画面表示
```

サーバ不要。計算はすべてブラウザ内で完結する。

### 3.2 透明性の確保

各計算結果には必ず以下を付与する:
- 採用基準 ID（例: `nochi_pipeline_2021`）
- 手法識別子（例: `joukowsky_v1`, `allievi_v1`）
- 入力値サマリー
- 適用条件の充足状況
- 警告・注意事項
- ソフトウェアバージョン

### 3.3 デモデータ戦略

初見ユーザーがExcelテンプレートなしで即座に計算結果を確認できるよう、
`sample-data` パッケージに以下を用意する:

| デモID | 内容 | 計算方法 |
|--------|------|---------|
| `demo-case-01` | バルブ急閉そく（ダクタイル鋳鉄管） | ジューコフスキー |
| `demo-case-02` | バルブ緩閉そく（同管路）| アリエビ |
| `demo-case-03` | 硬質塩ビ管との波速比較 | ジューコフスキー |
| `demo-case-04` | 経験則適用例（低圧オープン系） | 経験則 |

Excelテンプレート（`.xlsx`）はデモデータから自動生成してダウンロード提供する。
ユーザーはテンプレートを入手して自分の案件データを入力できる。

---

## 4. 技術スタック

| レイヤ | 技術 | 理由 |
|--------|------|------|
| 言語 | TypeScript | 型安全性・計算ロジックの明示 |
| パッケージ管理 | npm workspaces | 追加ツール不要 |
| ビルド | tsc | シンプル |
| テスト | Node.js test runner / Jest | ユニットテスト必須 |
| Excel | xlsx (SheetJS) | ブラウザ対応 |
| EPANET | epanet-wasm（検討中） | ブラウザ内定常計算 |
| Webフレームワーク | 未定（Next.js / SvelteKit 候補） | Phase 1で決定 |

---

## 5. バージョニング・識別子

- パッケージバージョン: semver (`0.x.x` → MVP、`1.0.0` → 初回安定リリース)
- 手法識別子: `{method}_{engine}_v{n}`（例: `joukowsky_simple_v1`）
- 基準プロファイル ID: `{org}_{target}_{year}`（例: `nochi_pipeline_2021`）
- BuildID: 計算実行時のタイムスタンプ + パッケージバージョン
