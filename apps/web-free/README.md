# apps/web-free

設計比較支援ワークスペースのブラウザアプリ。React 19 + Vite、`react-router-dom` の `HashRouter`
（`#/projects/:projectId/cases/:caseId/:tab`）で静的ホスティング（GitHub Pages）に対応する。
全体のアーキテクチャは [`../../docs/architecture.md`](../../docs/architecture.md)、ドメインモデル・
実行境界の設計は [`../../docs/design-workspace.md`](../../docs/design-workspace.md) を参照。

## 開発コマンド

```bash
npm run dev -w apps/web-free       # 開発サーバ
npm test -w apps/web-free          # Vitest（コンポーネント・統合テスト）
npm run build -w apps/web-free     # tsc -b && vite build
npm run test:e2e -w apps/web-free  # Playwright（axe アクセシビリティ監査を含む）
npm run typecheck -w apps/web-free
npm run lint -w apps/web-free
```

## ワークスペース UI の構造

```
src/
├── workspace/
│   ├── WorkspaceApp.tsx / WorkspaceLayout.tsx   ← ルーティング・左ツリー・右 Run Inspector を含む全体シェル
│   ├── WorkspaceTree.tsx                         ← Project → Alternative → Case ツリー
│   ├── RunInspector.tsx                          ← 選択中 Run のマニフェスト・自動評価・再帰的差分
│   ├── workspace-context.tsx                     ← WorkspaceRepository への唯一のアクセス経路（React Context）
│   ├── run-policy.ts                             ← RunKind 別トポロジゲート
│   ├── engineering-fields.ts                     ← RunKind ごとの工学フォームフィールド定義
│   ├── excel-import.ts / schematic.ts / comparison.ts / focus.ts
│   ├── sample-workspace.ts / bootstrap.ts        ← 初回起動時のデモプロジェクト自動投入
│   └── tabs/                                     ← 中央タブ: Overview / Model+GIS(ExcelIoCard含む) / Scenario / Analysis / Compare / Reports
├── gis/                                            ← OpenLayers + Proj4（遅延ロード）
├── results/                                        ← 永続化済み Run から結果を導出（run-visuals.ts）、CSV/SVG/PNG 出力
├── reports/                                        ← Excel/Run JSON/水理計算書・検討書の出力
├── runner/                                         ← ブラウザ側 CalculationRunner 実行エントリポイント
├── lib/                                            ← pyodide-bridge・legacy-hash 等の横断ユーティリティ
├── hooks/                                          ← usePyodideStatus 等
├── data/                                           ← 計算ライブラリ用の式メタデータ（formulaCatalog）
└── pages/                                          ← 計算ライブラリ・基準照会・設計フロー等のドキュメントページ
```

production の計算は必ず `workspace-context.tsx` の `run()` → 共有 `CalculationRunner` → Python
プロトコル（Pyodide）/ EPANET アダプタ、という経路を通る。UI から直接 `@open-waterhammer/core` の
計算関数を呼ぶ経路は存在しない。

## Pyodide の自己ホスティング

計算コア（`packages/core-py/open_waterhammer/`）はブラウザ内では Pyodide 0.29.0 経由で実行する。
CDN からは取得しない——`vite.config.ts` のプラグインが、ビルド時に `pyodide-assets.ts` に列挙した
アセット（`pyodide-lock.json` / `pyodide.asm.js` / `pyodide.asm.wasm` / `pyodide.js` / `pyodide.mjs` /
`python_stdlib.zip`）を npm パッケージ `pyodide` から `dist/pyodide/` へコピーし、開発サーバも同じ
ファイルを明示的な MIME type 付きで配信する。`lib/pyodide-bridge.ts` は `import.meta.env.BASE_URL`
から `indexURL` を解決し、この自己ホストされたアセットのみを読み込む（CSP は
`script-src 'self' 'wasm-unsafe-eval'` のみで、外部スクリプト読み込みを許可していない）。
