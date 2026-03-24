# Excel帳票スキーマ定義

出典: 土地改良事業計画設計基準 設計「パイプライン」技術書（農水省、平成21年3月・令和3年6月改訂）

---

## 1. 基本方針

- 入力は原則として所定Excelワークブック（`.xlsx`）とする
- 1ワークブック = 1案件
- ケース別シートを持ち、ケース間で管路・節点情報を共有する
- 各セルには単位・適用条件・警告を明示する
- OSS版は所定帳票の入出力を無料範囲とする

---

## 2. シート構成

| シートID | シート名（案） | 内容 |
|---------|------------|------|
| `meta` | 案件情報 | プロジェクト名、設計者、日付、採用基準 |
| `standard` | 基準設定 | 採用基準プロファイル、初期パラメータ |
| `network` | 管路・節点 | 管種、管径、管厚、延長、節点高さ |
| `facilities` | 附帯施設 | ポンプ・弁・附帯施設の仕様 |
| `cases` | ケース設定 | 運転条件、操作シナリオのケース一覧 |
| `simple_formula` | 簡易式 | 簡易式入力・結果（予備検討・概算用） |
| `steady_result` | 定常計算結果 | EPANET系による定常流況 |
| `transient_result` | 過渡計算結果 | 水撃圧計算結果（ケース別） |
| `envelope` | エンベロープ | 最大・最小圧力包絡線 |
| `judgement` | 判定 | 設計水圧・耐圧強度判定 |
| `input_check` | 入力チェック | 入力値の範囲・整合性チェック結果 |

---

## 3. シート別フィールド定義

### 3.1 `meta` — 案件情報

| フィールドID | 表示名 | 型 | 単位 | 必須 | 備考 |
|------------|------|----|------|------|------|
| `project_name` | 案件名 | string | — | ○ | |
| `designer` | 設計者名 | string | — | — | |
| `date` | 設計年月日 | date | — | ○ | |
| `standard_id` | 採用基準ID | enum | — | ○ | 例: `nochi_pipeline_2021` |
| `version` | ソフトウェアバージョン | string | — | ○ | 自動入力 |
| `method_id` | 手法識別子 | string | — | ○ | 例: `joukowsky_v1` |
| `notes` | 備考 | string | — | — | |

---

### 3.2 `network` — 管路・節点情報

#### 節点（Node）テーブル

| フィールドID | 表示名 | 型 | 単位 | 必須 | 備考 |
|------------|------|----|------|------|------|
| `node_id` | 節点ID | string | — | ○ | |
| `node_name` | 節点名 | string | — | — | |
| `elevation` | 地盤高 | float | m | ○ | T.P.基準推奨 |
| `hydraulic_grade` | 動水位（初期値） | float | m | — | 定常計算で更新 |
| `node_type` | 節点種別 | enum | — | ○ | `reservoir`, `junction`, `tank`, `pump_node`, `valve_node` |

#### 管路区間（Pipe）テーブル

| フィールドID | 表示名 | 型 | 単位 | 必須 | 備考 |
|------------|------|----|------|------|------|
| `pipe_id` | 管路ID | string | — | ○ | |
| `pipe_name` | 管路名 | string | — | — | |
| `start_node` | 始点節点ID | string | — | ○ | |
| `end_node` | 終点節点ID | string | — | ○ | |
| `pipe_type` | 管種 | enum | — | ○ | 下記管種コード参照 |
| `inner_diameter` | 管内径 D | float | m | ○ | 波速計算に使用 |
| `wall_thickness` | 管厚 t | float | m | ○ | 波速計算に使用 |
| `length` | 管路延長 L | float | m | ○ | |
| `roughness_coeff` | 粗度係数 | float | — | ○ | ハーゼン・ウィリアムスCまたはマニング n |
| `youngs_modulus` | ヤング係数 Eₛ | float | kN/m² | — | 管種から自動参照（上書き可） |
| `c1_coeff` | 埋設状況係数 C₁ | float | — | — | デフォルト: 1.0 |

##### 管種コード（参照: 表-8.2.1）

| コード | 管種名 | Eₛ (×10⁶ kN/m²) |
|--------|--------|-----------------|
| `steel` | 鋼管 | 200 |
| `ductile_iron` | ダクタイル鋳鉄管 | 160 |
| `rcp` | 遠心力鉄筋コンクリート管 | 20 |
| `cpcp` | コア式PCCP管 | 39 |
| `upvc` | 硬質塩ビ管 | 3 |
| `pe2` | 一般用PE管（2種） | 1 |
| `pe3_pe100` | 一般用PE管（3種 PE100） | 1.3 |
| `wdpe1`〜`wdpe5` | 水道配水用PE管 1〜5種 | 21.6/19.6/16.7/15.2/14.7 |
| `grp_fw` | FW成形強化プラスチック複合管 | 51 |
| `gfpe` | GF強化ポリエチレン管 | 2.5 |

---

### 3.3 `facilities` — 附帯施設

#### ポンプ（Pump）テーブル

| フィールドID | 表示名 | 型 | 単位 | 必須 | 備考 |
|------------|------|----|------|------|------|
| `pump_id` | ポンプID | string | — | ○ | |
| `node_id` | 設置節点ID | string | — | ○ | |
| `hq_curve` | H-Q特性曲線 | table | m, m³/s | ○ | 複数点 |
| `rated_flow` | 定格流量 | float | m³/s | ○ | |
| `rated_head` | 定格揚程 | float | m | ○ | |
| `gd2` | GD²（はずみ車効果） | float | kN·m² | — | ポンプ停止計算に使用 |
| `inertia_time` | 慣性時間定数 | float | s | — | |

#### バルブ（Valve）テーブル

| フィールドID | 表示名 | 型 | 単位 | 必須 | 備考 |
|------------|------|----|------|------|------|
| `valve_id` | バルブID | string | — | ○ | |
| `node_id` | 設置節点ID | string | — | ○ | |
| `valve_type` | バルブ種別 | enum | — | ○ | `gate`, `butterfly`, `air_release`, `check`, `pressure_relief` |
| `hq_curve` | H-Q特性曲線 | table | m, m³/s | — | |
| `close_time` | 閉そく時間 tν | float | s | ○ | 等価閉そく時間 |
| `open_time` | 開操作時間 | float | s | — | |

#### サージ防護施設

| フィールドID | 表示名 | 型 | 単位 | 必須 | 備考 |
|------------|------|----|------|------|------|
| `surge_id` | 施設ID | string | — | ○ | |
| `facility_type` | 施設種別 | enum | — | ○ | `air_chamber`, `surge_tank`, `one_way_surge_tank`, `flywheel`, `relief_valve` |
| `node_id` | 設置節点ID | string | — | ○ | |
| `volume` | 容量 | float | m³ | — | 空気槽・サージタンク |
| `initial_air_volume` | 初期空気容積 | float | m³ | — | 空気槽 |
| `throttle_area` | オリフィス断面積 | float | m² | — | |

---

### 3.4 `cases` — ケース設定

| フィールドID | 表示名 | 型 | 必須 | 備考 |
|------------|------|----|------|------|
| `case_id` | ケースID | string | ○ | |
| `case_name` | ケース名 | string | ○ | |
| `description` | 説明 | string | — | |
| `operation_type` | 操作種別 | enum | ○ | `valve_close`, `valve_open`, `pump_stop`, `pump_start`, `combined` |
| `target_facility_id` | 対象施設ID | string | ○ | |
| `initial_flow` | 初期流速 V₀ | float | ○ | m/s |
| `initial_head` | 初期圧力水頭 H₀ | float | ○ | m |
| `output_sheet` | 出力シートID | string | ○ | |

---

### 3.5 `simple_formula` — 簡易式

#### 波速計算

| フィールドID | 表示名 | 型 | 単位 | 備考 |
|------------|------|----|------|------|
| `pipe_ref` | 参照管路ID | string | — | |
| `wave_speed` | 波速 a | float | m/s | 式(8.2.4)で算出 |
| `vibration_period` | 圧力振動周期 T₀ | float | s | 4L/a |
| `alpha` | α値 | float | — | t₀/T₀ |
| `closure_type` | 急/緩閉そく判定 | enum | — | `rapid`, `slow` |

#### ジューコフスキー式（急閉そく）

| フィールドID | 表示名 | 型 | 単位 | 備考 |
|------------|------|----|------|------|
| `delta_v` | 流速変化 ΔV | float | m/s | |
| `delta_h_joukowsky` | 水撃圧水頭 ΔH | float | m | -(a/g)·ΔV |

#### アリエビ式（緩閉そく）

| フィールドID | 表示名 | 型 | 単位 | 備考 |
|------------|------|----|------|------|
| `k1` | K₁値 | float | — | (L·V)/(g·H₀·tν)² |
| `hmax_close` | 最大水撃圧水頭（閉） | float | m | 式(8.3.7) |
| `hmax_open` | 最大圧力低下（開） | float | m | 式(8.3.8) |
| `applicable` | 適用条件チェック | bool | — | tν > L/300 |

#### 経験則による推定

| フィールドID | 表示名 | 型 | 単位 | 備考 |
|------------|------|----|------|------|
| `system_type` | 系統種別 | enum | — | `open_gravity`, `closed_gravity`, `pump_tank`, `pump_direct`, `pump_pressure_tank` |
| `static_head` | 静水圧 | float | MPa | |
| `dynamic_head` | 動水圧 | float | MPa | |
| `waterhammer_empirical` | 経験則水撃圧 | float | MPa | |
| `empirical_applicable` | 経験則適用可否 | bool | — | 低圧・オープン系条件 |

---

### 3.6 出力フィールド（`transient_result` / `envelope`）

各ケースにつき以下を出力:

| フィールドID | 表示名 | 型 | 単位 | 備考 |
|------------|------|----|------|------|
| `case_id` | ケースID | string | — | |
| `pipe_id` | 管路ID | string | — | |
| `max_pressure_head` | 最大上昇圧力水頭 | float | m | |
| `min_pressure_head` | 最大下降圧力水頭 | float | m | 負圧チェック |
| `max_pressure_mpa` | 最大上昇圧力 | float | MPa | |
| `min_pressure_mpa` | 最大下降圧力 | float | MPa | |
| `design_pressure` | 設計水圧 | float | MPa | 静水圧+水撃圧 |
| `negative_pressure_flag` | 負圧発生フラグ | bool | — | 警告 |
| `time_series` | 圧力時刻歴データ | table | s, m | グラフ用 |

---

## 4. 出力必須記載事項

各出力シート・帳票に必ず含める情報:

- 採用基準（StandardProfile ID）
- 採用手法（手法識別子）
- 主要前提条件（管種、ヤング係数、埋設状況係数等）
- 注意事項・適用条件
- 結果解釈の注記（負圧の意味、適用限界等）
- ソフトウェアバージョン
- 計算日時

---

## 5. 入力チェック仕様（`input_check`）

| チェック項目 | 条件 | 重要度 | 対処 |
|------------|------|--------|------|
| 管内径 D | D > 0 | ERROR | 入力必須 |
| 管厚 t | t > 0 | ERROR | 入力必須 |
| 管路延長 L | L > 0 | ERROR | 入力必須 |
| ヤング係数 Eₛ | Eₛ > 0 | ERROR | 管種から自動参照 |
| 初期流速 V₀ | V₀ ≥ 0 | ERROR | |
| 閉そく時間 tν | tν ≥ 0 | ERROR | |
| アリエビ式適用条件 | tν > L/300 | WARNING | 数値解析を推奨 |
| 急/緩閉そく境界 | tν vs 2L/a | INFO | 自動判定・表示 |
| 負圧発生 | min圧力 < 0 | WARNING | 対策施設を検討 |
| 経験則適用条件 | 静水圧 < 0.35MPa（自然圧オープン系） | INFO | 条件外は計算法を使用 |
