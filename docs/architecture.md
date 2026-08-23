# アーキテクチャ設計

最終更新: 2026-08-24　対象バージョン: `0.2.0-alpha.1`

本書は現在実装されているパッケージ構成・技術スタック・実行境界を記録する。ドメインモデル
（Project/Alternative/Case/Scenario/Run）・Run マニフェスト・決定性バンドル形式・防護設備や自動評価
の意味論といった設計判断の詳細は [`docs/design-workspace.md`](./design-workspace.md) を参照。

---

## 1. リポジトリ構成（モノレポ）

```
open-waterhammer/
├── package.json          # ルート (npm workspaces)
├── tsconfig.json          # ルート TSConfig（contracts/workspace/runner/cli の project references）
├── packages/
│   ├── contracts/         # 正準スキーマ・型・ライフサイクル（新設）
│   ├── workspace/         # WorkspaceRepository・決定性バンドル・移行（新設）
│   ├── runner/            # 共通計算実行境界（新設）
│   ├── cli/                # `owh` コマンド（新設）
│   ├── core-py/            # Python 計算コア — 単一の真理源
│   ├── core/                # TypeScript 計算実装（参照/V&V 専用、production 未使用）
│   ├── epanet-adapter/     # epanet-js (WASM) ラッパ — 定常網
│   ├── excel-io/           # Excel 入出力（Run からの帳票生成・取込マッピング）
│   ├── sample-data/        # デモデータ・Excel テンプレート定数
│   ├── standards/          # 基準プロファイルメタ情報
│   └── report-basic/       # 未実装スタブ（`// TODO: report-basic`、他パッケージから未参照）
└── apps/
    └── web-free/           # React + Vite ブラウザワークスペース
```

11 パッケージ + 1 アプリ。`report-basic` は初期スペック（Phase 1 想定）の名残で、現在は空のスタブで
あり、帳票出力は `excel-io` が担っている。

---

## 2. パッケージ責務と依存関係

```
                         packages/contracts
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
   packages/workspace   packages/runner   packages/excel-io ──→ packages/core（型・単位変換のみ）
              │                 │
              │      ┌──────────┼───────────────┐
              │      ▼                          ▼
              │  packages/core-py       packages/epanet-adapter
              │  (Python, CPython/Pyodide)  (epanet-js, WASM)
              ▼
       packages/cli (owh)

apps/web-free ──→ contracts, workspace, runner, excel-io
                    (+ Pyodide 経由で packages/core-py をブラウザ内実行)
```

**依存の向きは常に `contracts` に収束する。** `contracts` は他のワークスペースパッケージに依存しない。

### `@open-waterhammer/contracts`
Project/Alternative/Case/Scenario/Run/RunManifest/AutomatedAssessment/LegacyArtifact の正準
TypeScript 型と JSON Schema（`SCHEMA_VERSION = "1.0.0"`）、CSP 下でも動く schema-derived スタンドアロン
Ajv バリデータ（`packages/contracts/scripts/generate-validators.ts` で生成、`src/generated/` に
コミット済み — 実行時の動的 `Function` 生成を使わない）、純粋なライフサイクル関数を提供する。

### `@open-waterhammer/workspace`
`WorkspaceRepository`（インメモリ実装／`idb` を使った IndexedDB 実装）、決定性 `.owhproj` バンドルの
export/import/validate/inspect、`owh_sessions` からのレガシー移行を提供する。詳細は
[`docs/design-workspace.md`](./design-workspace.md) §5。

### `@open-waterhammer/runner`
全 11 種類の `RunKind` に対応するエグゼキュータレジストリ。Case/Scenario の不変スナップショット検証、
正準入力ハッシュ計算、エンジン実行、マニフェスト/サマリー/時系列/自動評価の組み立て、
`WorkspaceRepository.appendRun` による永続化までを担う、production の計算が必ず通る唯一の境界。

### `@open-waterhammer/cli`
`owh` 実行ファイル（`validate`/`inspect`/`run`）。`packages/runner`・`packages/workspace` を直接呼び、
CPython サブプロセス経由で計算する。

### `open_waterhammer`（`packages/core-py`, pyproject `open-waterhammer`）
計算ロジックの単一の真理源。標準入出力 JSON プロトコル
（`open_waterhammer.protocol.run_protocol_json`）で CPython からも Pyodide からも同一関数が呼ばれる。
波速・簡易式（ジューコフスキー／アリエビ／経験則）・定常（Hazen-Williams/Darcy-Weisbach・自前定常網）・
縦断水理・MOC（特性曲線法、単管路／管路網／ポンプ／防護設備）・自動評価（`judge_design_pressure`）を実装する。

### `@open-waterhammer/core`（TypeScript）
波速・ジューコフスキー・アリエビ・等価管路長・設計水圧・簡易定常網などの **参照/V&V 専用**
実装。既存テストと共に保持するが、production の UI・CLI・runner のいずれからも呼ばれない
（`packages/core-py` への移行完了後の位置づけ）。

### `@open-waterhammer/epanet-adapter`
`epanet-js`（USEPA/OWA EPANET を WebAssembly 化した JS ラッパ）を用いた定常網計算。
`steady_network_epanet` の実行エンジンとして runner から呼ばれる。

### `@open-waterhammer/excel-io`
Excel ワークブックの読み込み（`parseWorkbook`）・入力テンプレート生成（`generateTemplate`）・
永続化済み Run からの帳票生成（`generateRunReport` / `generateReport`）。**自ら計算はしない**——
Run に記録済みの値のみを使う。

### `@open-waterhammer/sample-data` / `@open-waterhammer/standards`
デモケース・Excel テンプレート既定値、基準プロファイル（`nochi_pipeline_2021` 等）のメタ情報。

---

## 3. 実行境界（UI → repository → runner → protocol）

```
apps/web-free (ワークスペース UI)
   │  Analysis タブでフォーム入力を保存（saveModel）
   ▼
WorkspaceRepository（IndexedDB、契約ライフサイクルを強制）
   │  Case/Scenario の draft を永続化
   ▼
CalculationRunner.execute(request)  ← production の計算はすべてここを通る
   │  不変スナップショット化 → 正準ハッシュ → エグゼキュータ選択
   ├─→ Python（10種類）: ブラウザは自己ホスト Pyodide、CLI/Node は CPython サブプロセス
   │       └─ 両方とも open_waterhammer.protocol.run_protocol_json を呼ぶ（同一実装）
   └─→ epanet-js（steady_network_epanet のみ）: JavaScript/WASM
   │
   ▼
WorkspaceRepository.appendRun（Run 永続化 + Case ロックの唯一の原子的経路）
   │
   ▼
Results / Compare / Reports タブ（永続化済み Run のみを読む。再計算しない）
```

UI から Python/EPANET を直接呼ぶ経路は残していない（`rg` で `@open-waterhammer/core` や個々の計算
関数の直接呼び出しが production ソースに存在しないことを各タスクで確認済み）。

---

## 4. 技術スタック

| レイヤ | 技術 | 備考 |
|---|---|---|
| UI フレームワーク | React 19 + Vite 8（rolldown ベース） | ルーティングは `react-router-dom` の `HashRouter`（静的ホスティング対応、`#/projects/:projectId/cases/:caseId/:tab`） |
| ブラウザ計算実行 | Pyodide 0.29.0（バージョン固定・自己ホスト） | `pyodide.asm.wasm` 等をビルド時に `dist/pyodide/` へ配置。CDN・jsDelivr は使用しない |
| CLI 計算実行 | CPython（`--python` 明示可、既定は `PATH` の `python`） | 標準入出力 JSON プロトコル |
| 定常網（EPANET） | `epanet-js`（USEPA/OWA EPANET の WASM 移植） | ブラウザ・Node 両方で動く WASM アダプタ |
| GIS | OpenLayers (`ol`) + `proj4` | 遅延ロード。EPSG:4326・EPSG:3857・JGD2011 平面直角座標系 I〜XIX（EPSG:6669–6687）・ローカル XY（明示的変換必須）に対応。ベースマップは既定 OFF |
| Excel | `exceljs` | `excel-io` パッケージ経由。ブラウザ向けに polyfill 非依存の bare ビルドへ alias |
| パッケージ管理 | npm workspaces | ルート `package.json` の `workspaces: ["packages/*", "apps/*"]` |
| ビルド（TS 系） | `tsc --build`（contracts/workspace/runner/cli は project references でルート `tsconfig.json` に接続。core/epanet-adapter/excel-io/sample-data/standards は個別ビルド） | `apps/web-free` は `tsc -b && vite build` |
| CSP | `script-src 'self' 'wasm-unsafe-eval'` | 汎用 `'unsafe-eval'` や外部 CDN を含まない。任意でベースマップを有効化した場合のみ `tile.openstreetmap.org` への接続を許可 |

---

## 5. テストフレームワークの実態

| 対象 | フレームワーク | 実行コマンド |
|---|---|---|
| `packages/contracts` / `workspace` / `runner` / `cli` | Node 標準 `node:test`（`node --test --import tsx/esm`） | `npm test --workspace @open-waterhammer/<pkg>` |
| `packages/core` / `epanet-adapter` / `excel-io` | Node 標準 `node:test` | 同上 |
| `packages/core-py` | pytest | `python -m pytest packages/core-py/tests -q` |
| `apps/web-free`（コンポーネント・ユニット） | Vitest（+ Testing Library） | `npm test -w apps/web-free` |
| `apps/web-free`（E2E） | Playwright（+ `@axe-core/playwright` によるアクセシビリティ監査） | `npm run test:e2e -w apps/web-free` |

`sample-data` / `standards` に専用のテストスクリプトはない（デモ定数・メタ情報のみ）。

各パッケージの `lint` は ESLint（`apps/web-free` はフラット設定）。ルートの `npm run lint` は全
ワークスペースの ESLint に加えて UI 文言チェック（`scripts/check-ui-wording.mjs`、「準拠」等の禁止語を
UI ソースから検出）を実行する。検証状況の詳細な件数・許容誤差は
[`docs/validation-plan.md`](./validation-plan.md) を参照。

---

## 6. バージョニング・識別子

- 製品バージョン: `0.2.0-alpha.1`（`@open-waterhammer/contracts` の `PRODUCT_VERSION` が正準値）。
  `contracts`/`workspace`/`runner`/`cli`/`core-py` の各パッケージ定義には既に反映済み。ルート
  `package.json` と `core`/`epanet-adapter`/`excel-io`/`sample-data`/`standards`/`report-basic`/
  `web-free` の各 `package.json` はバージョン統一の別タスクが対象で、本書執筆時点では旧プレース
  ホルダ値のままの箇所がある——UI の表示・ドキュメント記載は一貫して `0.2.0-alpha.1` を使う。
- 契約スキーマバージョン: `1.0.0`。
- バンドル形式バージョン: `1`。
- Python プロトコルバージョン: `1`。
