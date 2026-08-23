# 検証計画

最終更新: 2026-08-24

本書は open-waterhammer の計算結果の信頼性を確保するための検証方針・手順・記録フォーマットを定める。
設計比較支援ワークスペースへの再編（`0.2.0-alpha.1`）に伴い、Run 単位の再現性検証（マニフェスト
ハッシュ・ブラウザ/CLI 間のクロスランタイム一致）という新しい検証レイヤーが加わったため、本書もその
実態に合わせて更新している。

---

## 1. 検証の目的

* 計算ロジックが参照基準（土地改良設計基準パイプライン等、技術書 §7・§8）の式を正しく実装している
  ことを確認する
* 適用範囲・限界・非適用ケースを明示し、ユーザーが結果を適切に解釈できるようにする
* 同一入力・同一バージョンで同一結果が再現できることを保証する——本リリースでは、この再現性を
  「入力・出力の正準ハッシュを Run マニフェストに記録する」という形で機械的に検証可能にした
  （§3）

本書は「準拠」の宣言ではなく、何を・どこまで・どのように検証しているかの記録である。包括的な基準
適合の宣言はしない（[`docs/design-workspace.md`](./design-workspace.md) §13 の適用限界を参照）。

---

## 2. 検証レベル

### Level 1 — 単体検証（Unit Verification）

各関数・式を個別に検証する。計算実装の単一の真理源は `packages/core-py`（Python）であり、
`packages/core`（TypeScript）は既存テストとともに参照/V&V 専用として保持している。

| 対象 | 検証内容 | 実装場所 |
|------|----------|----------|
| 波速・ジューコフスキー・アリエビ・等価管路長・経験則・`judge_design_pressure` | 各式の単体挙動、数値ゴールデン | `packages/core-py/open_waterhammer/tests/`（pytest） |
| MOC（特性曲線法、単管路・管路網・ポンプ・防護設備）・境界条件（弁・ポンプ・空気室・サージタンク・吸気弁・減圧弁・行き止まり・接合点） | 数値解析コアの単体・結合検証 | `packages/core-py/tests/test_moc.py`, `test_protocol.py` |
| 同上（参照/V&V 実装） | TypeScript 版との数値一致確認用 | `packages/core/src/__tests__/` |
| 契約スキーマ・Case ライフサイクル | フィクスチャによるスキーマ受理/拒否、状態遷移 | `packages/contracts/src/__tests__/` |
| 決定性バンドル・レガシー移行 | バイト同一性、破損/経路検証、冪等移行 | `packages/workspace/src/__tests__/` |
| 実行境界・CLI | RunKind ディスパッチ、マニフェスト完全性、ロック意味論、入出力同一性保護 | `packages/runner/src/__tests__/`, `packages/cli/src/__tests__/` |
| ワークスペース UI | フォーム・GIS・比較・帳票・Run Inspector | `apps/web-free/src/**/__tests__/`（Vitest） |

**合格基準**: 全ユニットテスト pass、既存の数値許容誤差（下記 Level 2/3・§3）を満たすこと。

**既知の検証ギャップ**: `judge_design_pressure` の判定境界（設計水圧 = 許容圧力 × 0.9 で pass、
= 許容圧力で warning となる境界そのもの）を直接ピンする単体テストは、本書執筆時点ではまだ追加
されていない（実装・結合テストでの間接的なカバーはある）。既知の未解消項目として記録する。

### Level 2 — 参照例検証（Reference Verification）

基準書・教科書の例題と突き合わせる。

| 参照資料 | 例題 | 検証項目 | 許容誤差 |
|----------|------|----------|----------|
| 土地改良設計基準パイプライン技術書 第8章 | 8章掲載例題（取得次第追加） | 波速・水撃圧水頭 | ±1% |
| 水撃圧計算の実務（参考文献） | 標準例題 | K₁・Hmax | ±1% |

**記録フォーマット:** `docs/validation/ref-YYYY-MM.md`（比較対象・条件・結果・差異・差異理由を記載）。
既存記録: `docs/validation/ref-2026-03-wave-speed-formulas.md`。

### Level 3 — 実務検証（Practical Verification）

既存成果品・商用ソフトとの比較。

| 比較対象 | 目的 | 状況 |
|----------|------|------|
| 過去の手計算成果品 | 実務との整合確認 | 未実施 |
| 商用ソフト（未定） | 差異の定量化 | 未実施 |

**差異が生じた場合:** 差異の大きさ・推定原因・適用判断を `docs/validation/` に記録する。差異が基準書の
解釈の違いによる場合は、採用した解釈を明示する。

**Level 2/3 は追加の V&V ベンチマークプログラムとして今後の課題に位置づけており、本リリースでは
既存の記録を超える拡充は行っていない**（[`docs/roadmap.md`](./roadmap.md) の「本リリースでは意図的に
対象外としている事項」を参照）。数値の妥当性そのものは Level 1（単体・エンジン間比較）で日常的に
検証している。

---

## 3. Run 単位の再現性検証（本リリースで追加）

計算結果の物理的妥当性（Level 1〜3）とは別の軸として、「同じ入力から同じ結果が得られるか」を
Run 単位で機械的に検証する仕組みを導入した。

- **正準入力/出力ハッシュ**: すべての Run 実行で、Case/Scenario の入力を正準 JSON
  （キーをソートした UTF-8、循環参照・`undefined`・非有限数を拒否）にしてから SHA-256 を取る。
  Python 側が独立に返す正規化ハッシュとバイト単位で突き合わせ、不一致は `INPUT_HASH_MISMATCH`
  として失敗 Run に記録する。
- **クロスランタイム一致（ブラウザ Pyodide ⇄ CLI CPython）**: 両ランタイムは同一の
  `open_waterhammer.protocol.run_protocol_json` 関数を呼ぶため、正準化の実装（ECMAScript の数値
  表記に合わせた JSON エンコード）まで含めて一致させている。既存の許容誤差:

  | 対象 | 許容誤差 |
  |---|---|
  | 波速（Python 内部） | 相対誤差 1e-12 |
  | 波速（CPython アダプタのハッシュ・数値比較） | 絶対誤差 1e-9 未満 |
  | 自前実装の定常網（Python/参照実装比較） | 相対・絶対誤差 1e-12 |
  | EPANET（自前実装との比較） | 流量 1%、節点水頭 0.1 m |
  | MOC / ジューコフスキー（相互検証） | 10% |

  Run ID・タイムスタンプは実行のたびに新規生成されるため、正規化比較からは除外する。
- **決定性バンドルの往復（round-trip）**: 同一内容を `.owhproj` として2回エクスポートするとバイト
  単位で同一になることを検証している（`packages/workspace` のバンドルテスト）。
- **golden `.owhproj` 受け入れスクリプト（`scripts/acceptance.mjs`、`npm run acceptance`）**: 着地済み。
  golden ワークスペース（11 RunKind 全種）を組み立て、決定性バンドルの往復・実 CLI 経由の CPython
  実行・5種類の数値ゴールデン（1e-9 許容誤差）に加え `transient_protection_device` の防護効果
  （`reductionRate`）ゴールデン・ハッシュのクロスランタイム一致・レガシー移行の冪等性・実行後の
  ワークツリークリーン性を、エンドツーエンドの golden フィクスチャで一括検証する。計23件のチェック
  （うち1件は実行後の `git status --porcelain` が空であることの確認——このリポジトリでの作業中は
  当然満たされない）。

---

## 4. 現在の検証状況

本書執筆時点（コミット `9338a2c` の直後、`feature/design-workspace` ブランチ——CLI 文字コード・
プロジェクト受け渡し到達性・`productVersion` 互換性緩和・ドキュメント訂正の最終 review wave
コミットが着地した直後）で確認した、全スイート green の最終値。パッケージ間バージョン統一など
進行中のリリース工程により件数は今後も動く見込み。正確な最新値は各テストコマンドを実行して確認
すること（コマンドは [`README.md`](../README.md#開発) を参照）。

| レイヤ | フレームワーク | 件数 |
|---|---|---|
| `packages/core-py`（Python） | pytest | 141 件 pass、警告 0件 |
| `packages/contracts` | node:test | 13 件 |
| `packages/workspace` | node:test | 23 件 |
| `packages/runner` | node:test | 25 件 |
| `packages/cli` | node:test | 12 件 |
| `packages/core`（参照/V&V） | node:test | 156 件 |
| `packages/epanet-adapter` | node:test | 9 件 |
| `packages/excel-io` | node:test | 25 件 |
| `apps/web-free`（コンポーネント・統合） | Vitest | 167 件（33ファイル） |
| `apps/web-free/e2e`（ブラウザ E2E） | Playwright | 4シナリオ（下記） |
| `scripts/acceptance.mjs`（golden 受け入れ） | 独自スクリプト | 23件のチェック（上記） |

Playwright E2E（`apps/web-free/e2e/workspace.spec.ts`）のシナリオ:

1. **一気通貫ワークフロー**: Case 作成 → 編集 → 実行 → ロック → fork → 比較 → リロード →
   GeoJSON/Excel/Run JSON の入出力。
2. **アクセシビリティ監査**: デスクトップ幅・390×844（モバイル相当）の両方で `@axe-core/playwright`
   を実行し、重大（critical）・深刻（serious）な違反がゼロであることを確認。
3. **全11 RunKind の production 実行**: 実際のブラウザ登録経由ですべての RunKind を実行し
   （10種類は自己ホスト Pyodide、`steady_network_epanet` は実際の `epanet-js`）、成功 Run の永続化と
   Case ロックを確認し、計算実行中に外部ネットワークリクエストが発生しないことを検証する（ベースマップ
   OFF 時）。
4. **フォームのみでの分岐実行**: GIS を使わない、新規 Case のフォーム入力のみで Darcy-Weisbach 法・
   ポンプ起動分岐を実行できることを確認する。

CI（`.github/workflows/ci.yml`）は本書執筆時点で `contracts`/`workspace`/`core`/`excel-io`/`runner`/
`web-free` のビルド・テストを実行するが、`packages/cli`・`packages/epanet-adapter` のテスト、Python
（pytest）、`typecheck`、Playwright E2E は含まれていない。フルテストマトリクスへの拡張は
[`docs/roadmap.md`](./roadmap.md) の短期課題として記録している。

---

## 5. 適用範囲と限界

### 簡易式（ジューコフスキー / アリエビ）の適用条件

| 条件 | 内容 |
|------|------|
| ジューコフスキー | tν ≦ 2L/a（急閉そく） |
| アリエビ | tν > 2L/a かつ tν > L/300（緩閉そく） |
| 上記いずれにも該当しない領域（2L/a < tν ≦ L/300） | 数値解析（MOC、`transient_single_pipe` 等）を使用する |

簡易式の適用条件を外れる場合に「将来実装予定」だった数値解析（MOC・特性曲線法）は現在実装済みで
あり、Analysis タブの方式選択ガイドが技術書 §8.3.2 の判定フローに沿って推奨手法を示す
（[`README.md`](../README.md#出力学習補助)）。

### 経験則の適用条件

給水栓を有する水田用配水系パイプラインで、オープンタイプまたは低圧（系統ごとにしきい値が異なる。
詳細は [`docs/standards-mapping.md`](./standards-mapping.md) §2.3・§2.6）の場合のみ推奨。それ以外は
計算による方法（ジューコフスキー/アリエビ、または MOC）を原則とする。

### 現バージョンの限界

* **柱分離（キャビテーション・気柱分離）は未対応**。MOC の境界条件は `H = max(CP, 0)` でクランプ
  するのみで、蒸気キャビティの形成・収縮・再衝突は計算しない。負圧（Hmin < 0）が生じる区間は、
  柱分離が発生し得るシグナルとして扱い、吸気弁等の追加対策を実務側で検討する前提とする。
* **自動評価（`judge_design_pressure`）は 11 種別中3種別のみ**（ジューコフスキー/アリエビ・経験則・
  縦断水理）、かつ許容圧力（MPa）を入力した場合に限る。MOC 系4種別は自動評価の対象外
  （`needs_review`）のまま。
* **防護設備はイベントを保持しない節点（バルブ・ポンプ以外）に対する境界条件の置換としてのみ機能する**。
* 自前実装の定常網計算は樹枝状（ループなし）管路網のみ対応。ループ網は EPANET エンジンを選択する。
* ポンプの4象限特性は H-Q放物線＋相似則トルクの簡易モデル。完全な逆流・逆転を含む詳細過渡解析は
  精度が劣化する（Suter 曲線 BC は将来対応）。

### 非適用ケース

* 管路内に気泡が存在する場合（水撃増幅の可能性）——柱分離モデルと同様、気液二相の詳細挙動は対象外
* ポンプ停止に伴う負圧・水柱分離を詳細（気液二相として）評価する場合
* クラウド・複数ユーザーでの共同編集や、人間による承認記録が必要な業務フロー
  （[`docs/roadmap.md`](./roadmap.md) 「本リリースでは意図的に対象外としている事項」を参照）

---

## 6. 検証記録の管理

* すべての Level 2 / Level 3 検証結果は `docs/validation/` ディレクトリに保存する
* ファイル名: `ref-YYYY-MM-{topic}.md`（例: `ref-2026-04-wave-speed.md`）
* 記録必須項目: 比較対象・比較条件・一致度・差異・差異理由・適用限界・非適用ケース
* バージョン変更時に影響を受ける検証結果は再検証する
* Run 単位の再現性（§3）は記録ファイルを都度作らず、Run マニフェスト自体（ハッシュ・警告・エラー）
  が個々の実行の検証記録を兼ねる

## 7. 自動化方針

* Level 1 テストのうち `contracts`/`workspace`/`core`/`excel-io`/`runner`/`web-free` は GitHub Actions
  CI（`.github/workflows/ci.yml`）で push/PR ごとに自動実行する。`cli`・`epanet-adapter`・Python
  （pytest）・typecheck・Playwright E2E は現時点では CI に含まれておらず、ローカルでの手動実行が必要
  （§4）。フルテストマトリクスへの CI 拡張は今後の課題（[`docs/roadmap.md`](./roadmap.md)）。
* テスト追加方針: 新しい計算ロジックを追加する際は、同時にユニットテスト（`packages/core-py` 側）を
  追加する。UI からの入力経路を追加する場合は、対応するワークスペーステスト（Vitest）も追加する。
