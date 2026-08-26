# open-waterhammer

> 農業用パイプライン水撃圧の設計比較支援ワークスペース（alpha）
> Open-source water hammer design-comparison workspace for agricultural pipelines

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

土地改良事業計画設計基準 設計「パイプライン」技術書（令和3年6月改訂）第7章（定常流）・第8章
（非定常的な水理現象の解析）を**参照**し、水撃圧の検討を Project → Alternative → Case → Scenario →
Run という単位で追跡できるようにした、ローカルファーストの設計比較支援ワークスペース。
**ブラウザだけで動作**し、サーバーは不要。バージョン `0.2.0-alpha.1`（alpha）。

🌐 **公開サイト**: <https://russeng.github.io/open-waterhammer/>

> **適用限界**: 本ツールは alpha 版であり、包括的な基準適合・検証済みの宣言はしない。
> 自動評価の対象範囲や柱分離（キャビテーション）などの技術的な限界は
> 「[適用限界](#適用限界)」を参照。無保証・責任制限は AGPL-3.0-or-later 第15～17条および
> 「このサイトについて」の「ライセンス・無保証」に示す。

---

## これは何か

再編前は「Excel入力 → 計算 → 結果表示」の単発セッションだった。現在は次のドメインモデルに基づく
設計ワークスペースになっている。

```
Project ── Alternative ── Case（不変・履歴付き） ── Scenario ── Run（マニフェスト＋ハッシュ） ── 自動評価
```

- **Case は不変**: 一度成功した計算があると Case は固定（locked）される。変更したければ、理由を
  記録して新しい派生 Case を分岐（fork）する——過去の検討条件が後から書き換わらない。
- **Run は再現可能な記録**: 入力・手法・パラメータ・ハッシュ・警告・自動評価を1つの Run
  マニフェストに残す（詳細は [`docs/design-workspace.md`](./docs/design-workspace.md)）。
- **完全ローカル**: プロジェクトデータはブラウザの IndexedDB か、ローカルの `.owhproj` 決定性
  バンドルのどちらかにのみ存在する。外部へは送信しない（「[データ境界](#データ境界ローカルファースト)」参照）。

設計の詳細（レイヤードアーキテクチャ、Run マニフェストの全項目、決定性バンドル形式、防護設備・
自動評価・トポロジゲートの意味論）は [`docs/design-workspace.md`](./docs/design-workspace.md) を、
パッケージ構成・技術スタックは [`docs/architecture.md`](./docs/architecture.md) を参照。

---

## クイックスタート

### 公開サイトを開く

<https://russeng.github.io/open-waterhammer/> をブラウザで開くだけ。インストール不要。起動時は必ず開始画面
「作業を始める」が表示され、Excelから開始・`.owhproj` を開く・空から始める・架空データのサンプル
（「サンプル：N地区東部幹線水路」、4本の比較案）から選択する。前回の作業がブラウザに残っている場合は、
先頭の「このブラウザーの続きから再開」で「続ける」を押したときだけ作業画面へ入る（自動では開かない）。
入力条件と作業状態はブラウザ内の IndexedDB に保存され、GitHub Pages のサーバーには送信
されない。別の端末・ブラウザとは自動同期されないため、バックアップや共有には `.owhproj` を使用する。

### ローカル開発

前提: Node.js ≥ 20（CI は Node 24）、Python ≥ 3.10（`owh run` の CPython 経路のみ必要。追加の
pip install は不要——`open_waterhammer` は Python 標準ライブラリのみで動く）。

```bash
git clone https://github.com/russENG/open-waterhammer.git
cd open-waterhammer
npm install
npm run dev --workspace=apps/web-free
```

### CLI（`owh`）

ブラウザなしで `.owhproj` バンドルを検証・検査できるローカル CLI。`run` は、CLI 自身で組み立てた、
または golden 受け入れスクリプト（`scripts/acceptance.mjs`）と同じ形の Case/Scenario を持つバンドル
中の、未実行（draft）Case を実行する。

```bash
npm install
npm run build
npx owh validate path/to/project.owhproj
npx owh inspect  path/to/project.owhproj
npx owh run      path/to/project.owhproj --case <caseId> --scenario <scenarioId> --out out.owhproj [--python <path>]
```

`--python` を省略すると `PATH` 上の `python` を使う。入力バンドルへの上書きは常に拒否し、出力先が
既存ファイルと衝突する場合も計算前に拒否する。Python 未検出・エンジン非対応・ID 不正・チェックサム
/スキーマ不正・出力衝突・**対象 Case がロック済み**（過去に成功した Run を持つ）の場合は、簡潔な
メッセージとともに非ゼロ終了する。**本リリースの `run` はブラウザが書き出した `.owhproj` を実行
できない**——ブラウザの Case は全 RunKind 入力を `modelSnapshot.runInputs` にラップした形状を持ち、
UI 自体は `Scenario.eventSettings.runKind`（`run` が実行対象の RunKind を選ぶキー）を書き込まない
ため。ブラウザ製バンドルに対しては `validate` / `inspect` のみ対応する。

ブラウザワークスペース間でプロジェクトを受け渡す場合は、概要タブの「プロジェクトを書き出し」で
`.owhproj` をダウンロードし、別の環境の概要タブで「プロジェクトを読み込み」から取り込む
（同じ Project ID が既に存在する環境への読み込みは仕様として拒否される）。

---

## データ境界（ローカルファースト）

- プロジェクトデータは **ブラウザの IndexedDB**、または **ローカルの `.owhproj` ZIP バンドル**
  にのみ保存される。外部サーバーへの送信は行わない。
- ベースマップ（OpenStreetMap タイル）は**既定 OFF**。有効化した場合のみ `tile.openstreetmap.org`
  への通信が発生する。
- **計算・入力データの外部送信は一切行わない。** 計算はブラウザ内の Pyodide で実行され、管路諸元・
  シナリオ・計算結果がネットワークに出ることはない（E2E テストで、全 RunKind の実行中に自己オリジン
  以外への通信が発生しないことを機械的に検証している）。
- 例外として公開サイト（GitHub Pages 版）のみ、**匿名のアクセス計測**（Cloudflare Web Analytics）を
  実行する。収集されるのはページ単位の閲覧数・参照元・大まかな地域のみで、クッキーや
  個人識別 ID は使用しない。入力値・計算結果を計測データとして送る実装は持たない。
  ソースからのビルド、フォーク、オフライン版は `VITE_CF_BEACON_TOKEN` が未設定のため計測しない。
  実装と運用は [`docs/operations-analytics.md`](./docs/operations-analytics.md) を参照。
- クラウドバックエンド・公開 HTTP API・認証・アカウントは存在しない（「[繰延事項](#繰延事項)」参照）。

IndexedDB は暗号化保管庫ではない。機微な施設情報を扱う場合は、バージョン固定の
オフライン版を組織内で配信し、専用のブラウザープロファイルで利用する。詳細は
[`docs/security.md`](./docs/security.md) と [`docs/offline-use.md`](./docs/offline-use.md) を参照。

---

## Python が計算の真理源

計算ロジックの実装は `packages/core-py/open_waterhammer/`（Python）にのみ存在する。ブラウザは
自己ホストした Pyodide 0.29.0（バージョン固定・CDN 不使用）、CLI/Node は CPython サブプロセスで、
**どちらも同一の `open_waterhammer.protocol.run_protocol_json` 関数を呼ぶ**——ブラウザと CLI とで
計算結果が分岐しない設計。TypeScript 実装（`packages/core`）は既存テストとともに参照/V&V 用途で
残すのみで、production の計算経路（UI・CLI・runner）からは呼ばれない。

## 再現性（Run manifest とハッシュ）

すべての計算は `CalculationRunner` という単一の実行境界を通る。実行のたびに Case/Scenario の入力を
正準 JSON 化して SHA-256 ハッシュを取り、Python 側が返す正規化ハッシュとバイト単位で突き合わせる
（不一致は失敗 Run として記録される）。成功・失敗いずれの Run も、手法・数値パラメータ・境界条件・
警告・入出力ハッシュ・エンジン/ランタイム識別子を含む完全なマニフェストとして永続化される。詳細な
フィールド一覧は [`docs/design-workspace.md`](./docs/design-workspace.md#4-run-とマニフェスト) を参照。

---

## 機能一覧

### 計算（全11種類、共通の実行境界を経由）

| 分類 | RunKind | 内容 |
|---|---|---|
| 波速・簡易式 | Wave speed | 管材・管厚・拘束条件から波速 a・振動周期 T₀・急/緩閉そく区分 |
| | Joukowsky / Allievi | 急閉・緩閉の比較式 |
| | Empirical pressure | 経験則（送配水方式 6 系統別）による概略値 |
| 定常流 | Steady single pipe | 単管路の損失水頭と動水位（Hazen-Williams / Darcy-Weisbach） |
| | Steady network（Python） | 樹枝状管路網の定常水理計算（自前実装） |
| | Steady network（EPANET） | 同上、`epanet-js`（WASM 版 EPANET）エンジン |
| 縦断 | Longitudinal hydraulics | 測点列に沿った縦断水理・設計内圧 |
| 非定常（MOC・特性曲線法） | Transient single pipe | 単一路線の特性曲線法解析 |
| | Transient network | 分岐・合流を含む管路網の過渡解析 |
| | Pump transient | ポンプ停止・起動イベント |
| | Protection device | 防護設備（サージタンク・空気室等）ありなしの比較計算 |

### 判定・追跡
- **自動評価**: 許容圧力を入力した場合、設計水圧との比較（式8.3.2）を Joukowsky/Allievi・経験則・
  縦断水理の3種類に配線。判定は `pass`/`warning`/`fail`/`needs_review`/`not_applicable` の5状態
  （MOC 系はすべて `needs_review`——詳細は「[適用限界](#適用限界)」）。
- **Case 系譜・比較**: Project → Alternative → Case のツリーで draft/locked/archived と派生関係を
  可視化。2〜4件の Case を選び、条件・結果の差分を比較できる。
- **Run Inspector**: 選択中 Run のマニフェスト・自動評価・警告・来歴を表示し、任意の値を再帰的に
  差分表示する。

### GIS
OpenLayers + Proj4（遅延ロード）。EPSG:4326・EPSG:3857・JGD2011 平面直角座標系 I〜XIX
（EPSG:6669–6687）・ローカル XY（明示的な変換を保存するまで地図表示・WGS84 書き出しをブロック）に
対応。取込ウィザードは常に元 CRS と属性マッピングを明示させ、値を推測しない。不正・未接続の要素も
ドラフトとして保持し、要素単位でエラーを表示する。

### Excel 入出力・帳票
- 入力テンプレートのダウンロードとワークブック取込（管路・節点・ケース・測点 → 各計算の入力に
  マッピング。取込は draft の Case にのみ可能で、計算は一切自動実行しない）。
- 帳票は3種類: 計算結果 Excel レポート、Run JSON（正準エビデンス）、水理計算書・検討書
  （成果品様式、永続化済みの成功 Run から**再計算せずに**生成）。計算結果 Excel と Run JSON は
  ライセンス、ソースコード URL、無保証・責任制限を保持する。

### 出力・学習補助
- 各グラフ（時系列・エンベロープ・縦断プロファイル・ポンプ回転速度）から CSV / SVG / PNG を出力。
- Analysis タブに折りたたみ式の方式選択ガイド（技術書 §8.3.2 の判定フローを再現し、条件に応じた
  RunKind を推奨）。
- 全計算式の数式・入出力・適用条件・GitHub ソースを一覧する計算ライブラリページ（旧サイトで公開
  していた `#<式ID>` 形式の引用 URL も、`#/docs/library?topic=<式ID>` へ自動リダイレクトして
  無効化しないようにしている）。
- Marimo によるリアクティブ notebook 3本（ブラウザ上で実行、[notebooks/](./notebooks/)）。

---

## 適用限界

- **alpha・設計比較支援**: 包括的な基準適合・検証済みの宣言はしない。自動評価・自動生成帳票は
  設計比較のための参考情報であり、設計者による個別確認を前提とする。
- **柱分離（キャビテーション・気柱分離）は未対応**: 蒸気キャビティの形成・収縮・再衝突は計算しない。
  動水頭が水蒸気圧水頭（既定 −10.33 m、`MocOptions.vaporPressureHead` で変更可）を下回った場合は、
  発生位置・時刻を warning で通知するが、それ以降の計算結果は参考値として扱うこと。
  なお判定を正しく行うには管路区間に管中心高（`upstreamElevation` / `downstreamElevation`）を
  与える必要がある。未指定の場合は基準面 0 m として判定し、その旨を warning に添える。
  （かつては境界条件が `H = max(CP, 0)` で水頭を 0 m に打ち切っており、下降側の水撃圧が
  過小評価になっていた。issue #50 で解消済み。）
- **自動評価の対象は11種別中3種別のみ**（Joukowsky/Allievi・経験則・縦断水理）、かつ許容圧力
  （MPa）を入力した場合に限る。MOC 系（単管路/管路網/ポンプ/防護設備の過渡解析）は自動評価の対象外
  （`needs_review`）のまま。
- **防護設備はイベント節点以外の境界条件置換としてのみ機能する**: バルブ・ポンプの節点を対象にした
  設備は拒否される（イベント自体を消してしまい、緩和効果を測定できなくなるため）。
- 自前の定常実装は**樹枝状・単一貯水槽**のみ対応。ループ網・複数水源は EPANET エンジンを選択する。
  前提を外れた入力は、計算から除外される管路を閉路検出の warning で通知する。
  なお `junction` ノードの需要流量も集計対象である（issue #48）。
- **分岐管路では実務目安 Δx = 50〜200 m と共通 Δt が両立しないことがある**。
  `suggestReaches()` が Courant 誤差を許容内に収める分割数を提案し、目安を外れた場合はその理由を返す。
- ポンプの4象限特性は簡易モデル（H-Q放物線＋相似則トルク）——詳細な逆流・逆転解析は精度が劣化する。

---

## 繰延事項

以下は本リリースのスコープに含めないことを明示的に決定している（Global Constraints）。将来の
リリースでの検討対象。

- クラウドバックエンド・公開 HTTP API・認証・コラボレーション機能
- 電子署名・人間による承認（Decision / Approval）記録——本リリースの判定は自動評価のみで、
  人が承認した記録という概念自体が存在しない
- 追加の Level 2（参照例）／Level 3（実務・商用比較）V&V ベンチマークプログラム

---

## 開発

### 構成

```
open-waterhammer/
├── packages/
│   ├── contracts/          ← 正準スキーマ・型・Case ライフサイクル
│   ├── workspace/          ← WorkspaceRepository・決定性 .owhproj バンドル・レガシー移行
│   ├── runner/              ← 共通計算実行境界（全 RunKind）
│   ├── cli/                  ← `owh` コマンド
│   ├── core-py/              ← 計算実装の単一の真理源（Python, AGPL-3.0）
│   ├── core/                  ← TypeScript 計算実装（参照/V&V 専用）
│   ├── epanet-adapter/       ← epanet-js (WASM) のラッパ — 定常網
│   ├── excel-io/              ← Excel 入出力（exceljs）
│   ├── sample-data/           ← デモデータ
│   └── standards/             ← 設計基準メタ情報
├── apps/
│   └── web-free/               ← React 19 + Vite ワークスペース UI
├── notebooks/                   ← Marimo 学習用ノートブック
├── scripts/                      ← ビルド・lint スクリプト
└── docs/                          ← 設計ドキュメント・基準 PDF 参照
```

詳細なパッケージ責務・依存関係・技術スタックは [`docs/architecture.md`](./docs/architecture.md) を
参照。`apps/web-free` の内部構造は [`apps/web-free/README.md`](./apps/web-free/README.md)。

### ビルド・テスト

```bash
npm install

# 全ワークスペースのテスト（node:test / Vitest）
npm test

# Python core のテスト
python -m pytest packages/core-py/tests -q

# 型チェック・lint（UI 文言チェック含む）
npm run typecheck
npm run lint

# ブラウザ E2E（Playwright、axe アクセシビリティ監査を含む）
npm run test:e2e -w apps/web-free

# 全体ビルド
npm run build
```

現在のテスト件数・カバレッジ方針・許容誤差は [`docs/validation-plan.md`](./docs/validation-plan.md)
にまとめている。

---

## 学術発表

第75回農業農村工学会大会講演会（2026年度）で発表予定:

> 設計実務者を対象とした水路非定常計算機能へのOSS適用と限界

要旨では本ツールの「計算ロジックの追跡可能性」「条件追跡・再計算性」「適用範囲と限界」を整理。

---

## 外部 OSS との比較

水撃圧・過渡流解析の周辺分野には複数の OSS が存在する。以下は 2026-08-24 に一次情報源
（公式 GitHub リポジトリ・README・GitHub REST API・PyPI レジストリ）で確認した内容。

| プロジェクト | 公式リポジトリ | ライセンス | 最新版 | 直近の保守状況 |
|---|---|---|---|---|
| [TSNet](https://github.com/glorialulu/TSNet)（Python, MOC法） | glorialulu/TSNet | MIT | 0.3.1（PyPI, 2023-09-21）※GitHub Release タグは v0.1.0 のみ | 停滞。最終 push 2023-09-21、`Development Status :: 2 - Pre-Alpha` |
| [USEPA EPANET 2.2](https://github.com/USEPA/EPANET2.2) | USEPA/EPANET2.2 | MIT | 2.2.0（2020-07-24） | push は2025-09-15まで確認できるが新版タグなし。2.3の公式リリースは未確認 |
| [OWA EPANET](https://github.com/OpenWaterAnalytics/EPANET)（コミュニティ版） | OpenWaterAnalytics/EPANET | MIT | v2.3.5（2026-02-20） | 活発。最終 push 2026-07-23 |
| [WNTR](https://github.com/USEPA/WNTR) | USEPA/WNTR | Revised BSD License | 1.5.0（2026-07-01） | 活発。release 日と push 日が同日 |

参考: [epanet-js](https://github.com/epanet-js/epanet-js-toolkit)（npm パッケージ名 `epanet-js`、最新
0.9.0・MIT）は OWA EPANET を WebAssembly 化した TS/JS ラッパーで、本ツールの
`steady_network_epanet` エンジンとして採用している。

TSNet（本ツールと同じく MOC 法で過渡流を解析する数少ない OSS）との機能対応（TSNet 公式ドキュメント
記載ベース）:

| 機能 | TSNet | 本ツール |
|---|---|---|
| ポンプトリップ（慣性考慮） | 未対応（ユーザー指定の速度-時間カーブによる制御停止/起動のみ） | H-Q放物線＋相似則トルクの簡易モデルで対応 |
| 空気室・サージタンク BC | 対応（開放型・密閉型とも） | 対応（`transient_protection_device`） |
| 下流バルブ閉鎖 | 対応（開度-時間カーブ、既定はゲート弁特性） | 対応 |
| 保守状況 | 事実上停滞（約3年間動きなし、pre-alpha） | 活発に開発中（本リリース自体が alpha） |

WNTR・EPANET（USEPA/OWA いずれも）は定常・EPS 水理/水質解析が中心で、過渡（水撃圧）解析はスコープ
外——本ツールが対象とする領域を直接カバーする OSS は限定的、というのがこの調査の結論である。

---

## ライセンス

[**AGPL-3.0-or-later**](https://www.gnu.org/licenses/agpl-3.0.html)

商用・非商用を問わず利用可能。ただし**改変・ネットワーク提供を行う場合はソースコードの公開**が必要。
正文はリポジトリルートの [`LICENSE`](./LICENSE)、採用理由・適用範囲の解説は
[`docs/license.md`](./docs/license.md) を参照。

### Why AGPL?

水撃圧の評価ロジックは公共財として共有されるべきという立場から、改変版を非公開のまま運用することを
許容しない強コピーレフトを採用しています。詳細は本サイト「about」ページの思想節を参照。

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
