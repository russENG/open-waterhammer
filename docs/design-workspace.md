# 設計比較支援ワークスペース — アーキテクチャ・設計文書

最終更新: 2026-08-24　対象バージョン: `0.2.0-alpha.1`

本書は、open-waterhammer を「単発の水撃圧計算ツール」から「設計比較支援ワークスペース」へ再編した
実装（ブランチ `feature/design-workspace`）の設計を記録する、恒久的なアーキテクチャ文書である。
再編は承認済みの内部戦略文書（Word、非同梱）に基づいて実施された。戦略文書そのものはリポジトリに
含めない（バイナリを配布物に混在させない方針）が、その要旨と、実装過程で生じた拡張合意
（Approved Continuation Amendment A1〜A11）は本書に統合し、`.superpowers/` 配下の作業ログのみに
存在する状態を解消する。

対応する制約・設計判断の全体像は [`docs/architecture.md`](./architecture.md)（パッケージ構成・技術スタック）、
検証状況は [`docs/validation-plan.md`](./validation-plan.md) を参照。

---

## 1. 何が変わったか

再編前は「Excel入力 → 簡易式/MOC（特性曲線法）計算 → 結果表示」という単一セッションの計算機だった。
再編後は次のドメインモデルに基づく、比較・追跡可能な設計ワークスペースになっている。

```
Project ── Alternative ── Case（不変・履歴付き） ── Scenario ── Run（マニフェスト＋ハッシュ） ── 自動評価
```

- **ローカルファースト**: プロジェクトデータはブラウザの IndexedDB、またはローカルの `.owhproj`
  決定性バンドルにのみ存在する。計算・入力データの外部送信は行わない（§5, §12）。公開サイトのみ
  匿名・クッキーなしのアクセス計測を行う。ローカル・フォーク・オフライン版には含めない。
- **Python が計算の単一の真理源**: ブラウザは Pyodide、CLI は CPython で同じ `open_waterhammer`
  パッケージを実行する（§6）。
- **ローカル CLI `owh`**: ブラウザなしで `.owhproj` の検証・検査・計算実行ができる（§7）。
- **alpha・設計比較支援**: UI 常時表示。本ツールは基準適合の判定システムではなく、設計比較のための
  参考情報を提供する（§13）。

---

## 2. レイヤードアーキテクチャ

```
apps/web-free  ───────────────┐
  (React 19 + Vite, HashRouter) │
                                ▼
packages/runner  ← packages/workspace  ← packages/contracts
      │                    │
      ├─→ packages/core-py (Python, CPython 実行 / Pyodide 実行)
      └─→ packages/epanet-adapter (epanet-js, WASM)

packages/cli (owh) ──→ packages/runner, packages/workspace, packages/contracts
packages/excel-io   ──→ packages/core, packages/contracts（Run からの帳票生成のみ）
```

- **`@open-waterhammer/contracts`**: Project/Alternative/Case/Scenario/Run/RunManifest/
  AutomatedAssessment/LegacyArtifact の正準 TypeScript 型・JSON Schema（schema version `1.0.0`）・
  Ajv バリデータ・純粋なライフサイクル関数（`createCase`/`forkCase`/`archiveCase`/`applyFinalRun`/
  `deriveScenarioState`）を提供する。ストレージや実行手段には関知しない、最も下位の依存先。
- **`@open-waterhammer/workspace`**: `WorkspaceRepository`（インメモリ／IndexedDB の2実装）、決定性
  `.owhproj` バンドルの入出力、レガシーセッション移行を提供する。contracts のスキーマ・ライフサイクル
  を再実装せず呼び出すのみ。
- **`@open-waterhammer/runner`**: 全 11 種類の `RunKind` を実行する共通境界。Case/Scenario の不変
  スナップショットを検証し、正準ハッシュを計算し、エンジン（Python または EPANET）を呼び、完全な
  マニフェスト・サマリー・時系列・自動評価を組み立て、`WorkspaceRepository.appendRun` を通じて
  最終 Run を永続化する。
- **`@open-waterhammer/cli`**: `owh` 実行ファイル（`validate`/`inspect`/`run`）。ブラウザなしで
  runner・workspace を直接呼び出す。
- **`packages/core-py`**: `open_waterhammer` Python パッケージ。全計算ロジックの単一の真理源。
  標準入出力 JSON プロトコル（`open_waterhammer.protocol.run_protocol_json`）を CPython 直接実行
  （CLI）と Pyodide 経由実行（ブラウザ）の両方が同一関数として呼ぶ。
- **`apps/web-free`**: React 19 + Vite の SPA。`HashRouter`（`#/projects/:projectId/cases/:caseId/:tab`）
  でワークスペース UI を提供する。production の計算はすべて runner を経由し、UI から Python/EPANET
  を直接呼ぶ経路は残していない。
- **参照専用**: `packages/core`（TypeScript の簡易式・定常網実装。V&V／既存テストのために保持するが、
  production の UI・CLI からは呼ばれない）、`packages/epanet-adapter`（`epanet-js` WASM ラッパ、
  `steady_network_epanet` の実行エンジン）、`packages/excel-io`（Excel 入出力。Run から帳票を生成する
  のみで、独自に計算しない）、`packages/sample-data` / `packages/standards`（デモデータ・基準メタ情報）。

依存の向きは常に `contracts` に収束する。UI・CLI・帳票生成のいずれも、独自の計算ロジックやスキーマ
複製を持たない。

---

## 3. Case ライフサイクルとロック

- **Project**: id・名称・`standardSelection`（基準プロファイルID・版）・CRS・タイムスタンプ。
- **Alternative**: Project 配下の代替案（名称・説明）。
- **Case**: `draft | locked | archived` の3状態。`parentCaseId` で派生元 Case を辿れる（不変の履歴・
  リネージ）。子 Case を作る（fork）には空でない `revisionReason` が必須。`modelSnapshot` に計算入力
  一式（`runInputs`・GIS ドラフト・Excel 取込データなど、§9・§11 参照）を保持する。
- **Scenario**: 境界条件・イベント設定・防護設備設定を持つ。**状態を自身で保持しない** ——
  `deriveScenarioState(caseRecord, scenario)` が所属 Case の状態からその場で導出する。Scenario の
  タイムスタンプを書き換えることなく、常に所属 Case と矛盾しない状態が得られる。

ロック意味論（`packages/contracts/src/lifecycle.ts`）:

| 遷移 | 結果 |
|---|---|
| `createCase` | 新規 `draft`、`lockProvenance: null` |
| 成功 Run が `applyFinalRun` を通過 | `draft` → `locked`、`lockProvenance: "successful_run"` |
| 失敗・中断 Run | Case は `draft` のまま（ロックしない） |
| `forkCase`（`draft`/`locked` から） | 新規 `draft` 子 Case を作成（親は変更しない）。`archived` からは不可 |
| `archiveCase` | `draft` の Case のみ可能 |
| レガシーインポート | `lockProvenance: "legacy_import"` で `locked`。成功 Run なしにロックされる唯一の例外 |

`locked`/`archived` な Case への直接編集は拒否される。変更したい場合は必ず `revisionReason` を伴う
fork で新しい `draft` 子 Case を作る。これにより「同じ Case が後から書き換わる」ことがなく、比較
（§8 の Compare タブ）が指す対象は常に固定される。

`WorkspaceRepository.appendRun` が Run 永続化と Case ロックを **同一トランザクションで** 行う唯一の
経路であり（Tasks 2↔3 ルーリング）、runner はロックを直接操作しない。これにより Run 永続化とロック
状態が分離してしまう split-brain を防いでいる。

---

## 4. Run とマニフェスト

`Run` は `id`・`caseId`・`scenarioId`・`kind`（`RunKind`）・`status`
（`pending | running | succeeded | failed | interrupted`）・`manifest`・`summary`・`timeSeries?`・
`assessment`・`error` を持つ。

`RunManifest` のフィールド:

| フィールド | 内容 |
|---|---|
| `schemaVersion` / `productVersion` | 常に `1.0.0` / `0.2.0-alpha.1`（`@open-waterhammer/contracts` から） |
| `runId` / `caseId` / `scenarioId` | 対象の識別子 |
| `createdAt` / `completedAt` | ISO-8601 UTC |
| `engine` / `runtime` | 実行エンジン識別（例: `open-waterhammer-python` + `cpython-<version>`、`epanet-js` + `javascript-wasm`） |
| `gitSha` | ビルドの Git SHA。ブラウザは Vite の `define`（`apps/web-free/vite.config.ts`）で埋め込む——優先順位は環境変数 `VITE_GIT_SHA`（CI が設定）→ ビルド時の `git rev-parse --short HEAD` → 取得不可なら `unknown`。CLI は環境変数 `OWH_GIT_SHA` → 実行時の `git rev-parse --short HEAD` → `unknown` の優先順位で解決する（`packages/cli/src/git-sha.ts`）。`browser-build` は、この Vite `define` を経由しない文脈（Vitest のユニットテスト環境など）専用のフォールバック値であり、実ブラウザビルドには現れない |
| `inputHashes` / `outputHashes` | 正準 JSON（`workspace` の `canonicalJson`）を SHA-256 したハッシュ群 |
| `method` | 手法識別子（例 `moc-network`） |
| `numericParameters` / `boundaryParameters` | 判定済みの数値入力・境界条件のスナップショット |
| `standard` / `rulesVersion` | 採用基準・ルール版 |
| `warnings` / `errors` | エンジンからの警告・エラー文字列 |
| `finalStatus` | `succeeded \| failed \| interrupted` |

**入力ハッシュの整合性**: runner は Case/Scenario スナップショットから `workspace` の `canonicalJson`
でハッシュを計算し、Python プロトコルが返す正規化ハッシュとバイト単位で突き合わせる。不一致は
`INPUT_HASH_MISMATCH` の失敗 Run になる（＝ブラウザとCLIで異なる入力が計算されるのを防ぐ仕組み）。

**成功と評価は別軸**: 計算が正常終了すれば、自動評価（§10）が `fail` でも Run は `succeeded` であり、
Case はロックされる。「評価が悪い」ことと「計算が失敗した」ことは異なる——設計上、悪い結果も
記録として保持する。エンジン／プロトコル自体のエラー（Python 未検出・入力検証エラー・EPANET
ソルバエラーなど）は `failed` Run になり、Case はロックされない。

---

## 5. 決定性バンドル形式（`.owhproj`, format version `1`）

`.owhproj` は ZIP アーカイブで、次の固定レイアウトを持つ（`packages/workspace/src/bundle.ts`）:

```
bundle.json
project.json
alternatives/<id>.json
cases/<id>/case.json
cases/<id>/model.json
cases/<id>/scenarios/<id>.json
runs/<id>/run.json
runs/<id>/manifest.json
runs/<id>/summary.json
runs/<id>/timeseries.json        # 存在する場合のみ
runs/<id>/assessment.json
legacy/<id>.json
checksums.json
```

- 各エントリは正準 UTF-8 JSON（キーをソートし、配列順は保持、循環参照・`undefined`・非有限数を拒否）。
- `checksums.json` は他の全メンバーの SHA-256（自分自身は含まない）。
- ZIP メタデータは固定タイムスタンプ（1980-01-01 相当、タイムゾーン非依存に構成）を用い、エクスポート
  時刻などの揮発情報を含めない。**同一内容を2回エクスポートするとバイト単位で同一のアーカイブになる**
  （ドメインの作成・実行時刻はコンテンツとして残るため、バンドル自体は毎回変わるわけではないが、
  同一状態からのエクスポートは再現可能）。
- インポートは書き込み前に完全検証する: 未知のバンドル版・不正スキーマ・欠落メンバー・重複 ID・
  安全でない ZIP パス（絶対パス・ドライブ文字・`..`）・チェックサム不一致を拒否する。既存データとの
  ID 衝突は、インポート先の6ストア全体を対象に、書き込み前にチェックする。
- `validateProjectBundle` / `inspectProjectBundle` / `importProjectBundle` / `exportProjectBundle`
  が公開 API（`WorkspaceRepository` からも委譲呼び出しできる）。

### レガシーセッション移行

ブラウザの `IndexedDBWorkspaceRepository` を開くと、`localStorage` の `owh_sessions` キーを自動的に
読み、冪等に移行する:

- 各レガシーセッションは、ロック済み Case（`lockProvenance: "legacy_import"`）＋生データを保持する
  `LegacyArtifact`（`provenance: "incomplete"`）になる。**Run にはならない**（再現可能な計算記録では
  ないため）。
- 移行元 ID を記録し、繰り返し実行しても重複しない。
- `owh_sessions` 自体は一切書き換えない（`getItem` のみ呼び、`setItem`/`removeItem` は呼ばない）。

---

## 6. 実行境界（Runner）と計算エンジン

`packages/runner` のレジストリは、`@open-waterhammer/contracts` が定義する 11 種類の `RunKind` すべて
にエグゼキュータを持つ:

| 分類 | RunKind | 実行エンジン |
|---|---|---|
| 波速・簡易式 | `wave_speed`, `joukowsky_allievi`, `empirical_pressure` | Python |
| 定常 | `steady_single_pipe`, `steady_network_python` | Python |
| 定常（EPANET） | `steady_network_epanet` | `epanet-js`（JavaScript/WASM） |
| 縦断 | `longitudinal_hydraulics` | Python |
| 非定常（MOC） | `transient_single_pipe`, `transient_network`, `transient_pump`, `transient_protection_device` | Python |

10 種類が Python 側で処理される。ブラウザは自己ホストした Pyodide（バージョン固定・CDN 不使用）、
CLI/Node は CPython サブプロセスで、**どちらも同一の `run_protocol_json` 関数**を呼ぶ——ブラウザと
CLI で計算ロジックが分岐しない設計。`steady_network_epanet` のみ既存の JavaScript/WASM `epanet-js`
アダプタを使う。

runner は Case/Scenario の不変スナップショットを構築し、正準ハッシュを計算し、選択したエグゼキュータ
を実行し、完全なマニフェスト・サマリー・時系列・自動評価を組み立て、`WorkspaceRepository.appendRun`
で永続化する。TypeScript の計算実装（`packages/core`）は参照・V&V 用途で残るのみで、production の
実行経路には含まれない。

---

## 7. ローカル CLI（`owh`）

```
owh validate <bundle>
owh inspect <bundle>
owh run <bundle> --case <id> --scenario <id> --out <new-bundle> [--python <path>]
```

- `validate` / `inspect` は `.owhproj` の検証・検査結果を表示する。
- `run` は指定 Case/Scenario（`Scenario.eventSettings.runKind` で選択された `RunKind`）を runner で
  実行し、新しいバンドルに Run を追記して出力する。**入力バンドルへの上書きは常に拒否**（パスの
  正規化・実体（inode/device）比較で別名・ハードリンックでも防止）し、既存の出力先パスとの衝突も
  計算前に拒否する。最終書き込みは排他生成（`wx`）で行う。
- `--python` を指定すればそのパスが優先される。指定がなければ `PATH` 上の `python` を使う。Python
  未検出・エンジン非対応・ID 不正・チェックサム/スキーマ不正・出力衝突・**対象 Case がロック済み**
  （`WorkspaceRepositoryBase.appendRun` が `"Case is not editable"` を返す——過去に成功 Run を持つ
  Case は再実行できず、fork して新しい draft Case を作る必要がある）は、簡潔なメッセージとともに
  非ゼロ終了する。エンジン失敗時も失敗 Run を出力バンドルに書き込み、Case はロックしない。
- **本リリースの `run` はブラウザが書き出した `.owhproj` を実行できない**——ブラウザの Case は全
  RunKind 入力を1つの `modelSnapshot.runInputs` にラップした形状を持ち、ブラウザ UI 自体は
  `Scenario.eventSettings.runKind` を書き込まないため（`run` が読む形状と異なる）。ブラウザ製
  バンドルに対しては `validate` / `inspect` のみ対応する。`run` の対象になるのは、CLI で組み立てた
  バンドル、または golden 受け入れスクリプト（`scripts/acceptance.mjs`）と同じ形の Case/Scenario を
  持つバンドル。

---

## 8. 防護設備（Protection Devices）の意味論

`transient_protection_device` は独立ハンドラを持つ:

1. 有効化された防護設備が1つもなければ、通常の `transient_network` と完全に同じ経路で実行する
   （後方互換）。
2. 有効化された設備がある場合、**同じネットワークに対してベースライン（設備なし）と防護後（設備を
   対象節点の境界条件として代入）の2回 MOC 計算**を実行する。防護後の設備は、対象節点 ID の境界条件
   （BC）を丸ごと置き換える形で表現される（MOC は1節点につき1つの BC しか持てない設計のため）。
3. **設備は「イベントを保持する節点」を対象にできない**——対象節点の元の BC 種別が `valve` または
   `pump` の場合、`ProtocolError`（`INVALID_INPUT`）で拒否される。バルブ・ポンプの節点を設備で置換
   すると、閉鎖・起動イベント自体が消えてしまい、「防護によって何が緩和されたか」を測定できなくなる
   ためのガード。防護設備は、イベント節点とは別に用意した中立な接続点（`junction`、MOC の通過点として
   の疑似 BC）などに配置する。
4. `summary.protection` に `baseline`（設備なしの各管の Hmax/Hmin）・`protected`（防護後の各管の
   Hmax/Hmin）・`reductionRate`（= `(ベースライン全体最大Hmax − 防護後全体最大Hmax) / ベースライン
   全体最大Hmax`、ベースラインが非正なら 0）を記録する。`timeSeries` と他のサマリー項目は防護後の
   計算結果のみを反映する。

シードされたサンプルワークスペース（`transient_protection_device` の初期ケース）では、貯水池
`R-01` — 管路 `P-01` — 接続点 `J-01` — 管路 `P-02` — バルブ `V-01`（2秒閉鎖）というネットワークに
対し、`J-01` にサージタンクを配置した結果、EPANETで求めた初期定常状態から、ベースライン最大水頭
≈115.7 m → 防護後 ≈84.5 m、reductionRate ≈ 27.0% という緩和を示す。

これらの値は issue #47・#50 の修正後のものである。`J-01` は管路の途中の接合点なので、旧実装は
サージタンクを `P-01` の末端として解き、`P-02` の流量を 0 に固定したまま計算していた（タンクが
閉そくを兼ねていた）。装置を接合点から分岐する枝として解くようになり、両管路に流量が通るため、
緩和率は 29.7% から 27.0% に下がっている（過大評価の解消）。

**適用限界（重要）**: 本ツールは**柱分離（キャビテーション・気柱分離）モデルを実装していない**。
動水頭（水頭 − 管中心高）が水蒸気圧水頭（既定 −10.33 m、`MocOptions.vaporPressureHead` で変更可）
を下回った場合は、発生位置・時刻を warning で通知するが、その後の気液二相の挙動は計算しないため、
それ以降の結果は参考値として扱う。実務では負圧が生じる区間は吸気弁等の追加対策を要する
（§13、`docs/roadmap.md` の既知の制約も参照）。

---

## 9. RunKind 別トポロジゲート

ネットワーク（節点・管路グラフ）を実際に消費する `RunKind` は4種類のみ:

| ネットワーク必須（`TOPOLOGY_REQUIRED_KINDS`） | フォーム完結（ゲートなし・新規 Case でも即実行可） |
|---|---|
| `steady_network_python` | `wave_speed`, `joukowsky_allievi`, `empirical_pressure` |
| `steady_network_epanet` | `steady_single_pipe`, `longitudinal_hydraulics` |
| `transient_network` | `transient_single_pipe`, `transient_pump` |
| `transient_protection_device` | — |

根拠は `packages/core-py/open_waterhammer/protocol.py` のハンドラが実際に何を読むかを追跡した結果
（`steady_network_*` は `pipes[]`/`nodes[]`、`transient_network`/`transient_protection_device` は
`network.pipes[]`/`network.nodes{}` を必須で読み、他の7種は単一管路または測点列のみを読む）。

GIS の編集中データ（`modelSnapshot.geoDrafts`）と、Run が実際に消費する `runInputs[kind]` は
**独立した並行データ**である。GISの同一IDの座標・中心線は正準水理モデルへ統合されるが、GISデータ
だけから `runInputs` を自動作成する経路はない（フォーム入力・Excel取込（§11）がそれぞれ
`runInputs` を書く）。現行ゲートは次の OR 条件で判定する:

- 永続化された GIS ドラフトが有効（`validateHydraulicDrafts` が通る）、**または**
- 保存済み `runInputs[kind]` が構造的に完結したネットワーク（空でない節点・管路配列/レコード）を
  持っている

いずれも満たさない場合、GISデータが1件もなければ `topology_required`、データはあるが検証エラー
を含む場合は `topology_invalid` を返す。参照整合性（存在しない節点 ID の参照など）はこのゲートでは
見ない——それは Analysis タブの保存時検証と、最終防衛線としての Python プロトコル側の入力検証
（不正な入力は失敗 Run として記録される）が担う。

このゲートで有効と判定されるのはGISのID・接続・内径までであり、完全な解析入力が揃ったという意味では
ない。alpha版の保証範囲と将来ロードマップは[GIS機能のalpha版範囲](./gis-alpha-scope.md)を参照する。

---

## 10. 自動評価（Assessment）ルール

自動評価は 5 状態ぴったり: `pass | warning | fail | needs_review | not_applicable`。人間による
「承認（Approval）」記録は本リリースには存在しない。画面では評価の近くに、採用前に入力条件と
計算結果を確認する旨を短く表示する（§13）。

`judge_design_pressure`（技術書 式8.3.2 に基づく判定、`packages/core-py/open_waterhammer/formulas.py`）
は、設計水圧と入力された許容圧力を比較する:

| 判定 | 条件 | 評価ステータス |
|---|---|---|
| OK | 設計水圧 ≤ 許容圧力 × 0.9（余裕度 10% 以上） | `pass` |
| WARNING | 設計水圧 ≤ 許容圧力（余裕度 10% 未満） | `warning` |
| NG | 設計水圧 > 許容圧力 | `fail` |

この判定は、モデル入力に **正の数値として** `allowablePressureMpa`（許容圧力）が与えられたときのみ、
次の3種類の `RunKind` に配線されている:

| RunKind | `targetRef` | 判定対象の設計水圧 |
|---|---|---|
| `joukowsky_allievi` | 管路 `pipe.id` | 静水頭 + 水撃圧水頭（急閉そく: ΔH、緩閉そく: Hmax − H₀。数値解析必須域では判定なし） |
| `empirical_pressure` | `model.systemType`（送配水方式） | 静水圧 + 経験則水撃圧 |
| `longitudinal_hydraulics` | 各測点の `point.point_id`（`location` も同値） | 各測点の設計水圧（測点ごとに個別判定、最も厳しい判定が Run 全体のステータスになる） |

findings は契約スキーマのリテラルキー（`targetRef`/`observedValue`/`threshold`/`unit`/`ruleId`、
必要に応じ `location`）のみを持つ。`ruleId` は一貫して `"judge_design_pressure/8.3.2"`。余裕度や
メッセージ文言は `manifest.warnings` に入り、`findings` には入らない（findings は
`additionalProperties: false` のスキーマ制約のため）。

- **`allowablePressureMpa` が未入力**の場合、評価は既定の `needs_review`（findings 空）のまま
  ——**新規 Case のテンプレートはこの値を事前入力しない**（"隠れた既定値を持たない" 原則。デモ用の
  シードされたサンプルワークスペースのみ、実例として値を持つ）。
- **入力されているが判定不能**（数値でない・0以下・joukowsky で近似式が適用できない数値解析必須域）
  の場合も評価は `needs_review` のままだが、区別のため理由付きの警告
  （例:「許容圧力が指定されていますが判定できませんでした（許容圧力は正の数値で指定してください）。」）
  を `manifest.warnings` に追加する。
- **MOC 系（`transient_single_pipe`/`transient_network`/`transient_pump`/`transient_protection_device`）
  は常に `needs_review`**。旧実装にも対応する判定機能が存在しなかったため、この再編では判定を追加
  していない——**「11種別のうち判定対象になり得るのは3種別のみ」が本リリースの適用限界である**。

---

## 11. Excel 入出力

ExcelとWeb入力の責任分界、項目対応、再読込時の上書き規則は
[Excel入力とWeb入力の責任分界](./excel-web-input-policy.md)を正とする。
比較案、シナリオ、Excelのシナリオ設定の役割は
[比較案・シナリオ・Excel入力の役割](./comparison-scenario-model.md)に従う。

- **入力**: テンプレートダウンロード（`@open-waterhammer/excel-io` の `generateTemplate`）と
  ワークブック取込（`parseWorkbook`）を Model＋GIS タブに提供する。取込結果は
  `mapWorkbookToRunInputs` で各 `RunKind` の `runInputs` 候補（`wave_speed`/`joukowsky_allievi`/
  `longitudinal_hydraulics`/`steady_network_python`/`steady_network_epanet`）にマッピングされ、
  省略・既定値化した項目は理由付きの警告として返す。生のワークブックデータ全体も
  `modelSnapshot.excelImport` として保持し、帳票生成時の詳細情報源にする。取込は **draft の Case
  にのみ**でき、`runInputs`、正準水理モデル、およびExcelの各行に対応するシナリオを書き込む。取込の時点で
  計算は一切走らない。検証エラーが1件でもある場合は更新せず、既存入力と競合する再読込は利用者の
  確認後にだけ実行する。
  **既知の制約**: Excel の節点シートには需要流量（demand）の列がないため、`steady_network_python`/
  `steady_network_epanet` を Excel 取込だけで構成すると、貯水池以外の節点はすべて需要ゼロの
  `junction` になる（＝計算結果の流量がすべてゼロになる）。定常網計算で Excel 取込を使う場合は、
  取込後に Analysis タブのフォームで需要流量を補う必要がある。
- **出力（成果品様式）**: 「水理計算書・検討書」（既存の `packages/excel-io` `generateReport` が生成
  する 24 列の水理計算書シート＋水撃圧検討書シート）を、**永続化済みの成功 Run から再計算なしで**
  生成する。`joukowsky_allievi` と `longitudinal_hydraulics` の成功 Run 群を集約し、`run.summary`
  （Python がキャメルケース化したフィールド名）を TypeScript の `SimpleFormulaResult` 型（一部
  スネークケースの命名を残す）へ 1 対 1 で明示的にマッピングする——汎用のケース変換では対応しきれない
  ため、フィールドごとに書き下している。既存の「Excel report（`generateRunReport`）」「Run JSON」の
  2出力に加わる3つ目の出力である。計算結果 Excel と Run JSON には、ライセンス、ソースコード URL、
  無保証・責任制限を記録する。

---

## 12. レガシー URL 互換性

再編前の計算ライブラリページは `<公開URL>/#joukowsky` のような数式アンカー URL を提供しており、
外部から引用可能な形で公開されていた。HashRouter 化（`#/projects/...`）によりこれらは一時的に無効化
されていたが、`resolveLegacyHash`（`apps/web-free/src/lib/legacy-hash.ts`）が `#/...` 形式でない
アンカー状の `#<id>` を検出し、既知の数式 ID なら `#/docs/library?topic=<id>`、未知のアンカー状文字列
なら素の `#/docs/library` へ **`history.replaceState` で** 書き換える。`pushState` 相当の代入では
なく置換を使うことで、ブラウザの「戻る」操作がリダイレクトを無限に再生するトラップを避けている。

---

## 13. 横断的な適用限界（まとめ）

- 本リリースは **alpha**・**設計比較支援** であり、包括的な基準適合・検証済み宣言はしない。
- **柱分離（キャビテーション・気柱分離）モデルは未実装**。蒸気キャビティの形成・収縮・再衝突は
  計算しない。動水頭（水頭 − 管中心高）が水蒸気圧水頭（既定 −10.33 m）を下回った場合は、発生位置・
  時刻を warning で通知するが、それ以降の結果は参考値として扱う（§8）。判定を正しく行うには管路区間に
  管中心高（`upstreamElevation` / `downstreamElevation`）を与える必要がある。未指定なら基準面 0 m として
  判定し、その旨を warning に添える。
- **自動評価は 11 種別中 3 種別（joukowsky_allievi / empirical_pressure / longitudinal_hydraulics）
  のみ**、かつ許容圧力が入力された場合に限る。MOC 系はすべて `needs_review`（判定対象外）のまま。
- **防護設備はイベント節点以外の境界条件置換としてのみ機能する**。バルブ・ポンプを対象にした設備は
  拒否される（§8）。
- クラウドバックエンド・公開 HTTP API・認証/コラボレーション機能・電子署名・人間による承認
  （Decision/Approval）記録は本リリースに存在しない。追加の Level 2/3 V&V ベンチマークプログラムも
  対象外。
- ブランチ `feature/design-workspace` はローカルに留め、`main`/`master` へのマージ・push は行って
  いない（ユーザー承認済みの意思決定、A10）。統合は別途の判断に委ねる。

---

## 14. 正準水理モデル

管路・節点・測点・水理ユニットの責務、ER図、正本・派生規則、Excel/GIS/数値解析への変換は[正準水理モデル](./canonical-hydraulic-model.md) に定める。

---

## 15. GIS機能の範囲

GeoJSON読込、座標変換、接続検証、地図表示、WGS84書出しの対応状況と、GIS・Excel・正準モデルの責任分界は[GIS機能のalpha版範囲](./gis-alpha-scope.md)に定める。

---

## 16. 管路平面図・模式図

管路読込直後の自動表示、実座標と模式配置の切替、施設・接続不良の識別、座標入力の方針は[管路平面図・模式図](./plan-view.md)に定める。

---

## 17. 入力・計算結果の縦断図

測点読込直後の入力確認図、保存済み結果の重ね合わせ、欠損・順序・距離不整合の表示、平面図・GIS・結果系列との選択連動は[入力・計算結果の縦断図](./longitudinal-profile.md)に定める。

---

## 18. 圧力波アニメーション

保存済みMOC計算記録だけを用いる再生、平面図・模式図・縦断図・選択地点時系列の同期、描画上限とアクセシビリティは[圧力波アニメーション](./pressure-wave-animation.md)に定める。

---

## 19. 数値解析中心の解析メニュー

11計算方式の「主要解析・準備計算・簡易確認」への分類、推奨手順、入力欄の段階表示、既存計算記録との互換性は[数値解析中心の解析メニュー](./analysis-menu.md)に定める。
