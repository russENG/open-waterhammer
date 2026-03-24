# 基準プロファイル定義（standards-mapping）

出典: 土地改良事業計画設計基準 設計「パイプライン」技術書（農水省、平成21年3月・令和3年6月改訂）
参照章: 第8章「非定常的な水理現象の解析」〔基準9、運用9-2〕

---

## 1. StandardProfile の構造

各基準は `StandardProfile` として定義し、以下の要素を持つ。

```typescript
interface StandardProfile {
  id: string;                        // 基準識別子
  name: string;                      // 基準名（表示用）
  version: string;                   // 版・改訂年
  scope: string;                     // 適用対象
  terms: TermDictionary;             // 用語定義
  designFlow: DesignFlowStep[];      // 設計フロー
  calculationMethods: CalcMethod[];  // 選択可能な計算方法
  defaultParameters: ParameterSet;  // 初期パラメータ
  judgementCriteria: Criterion[];    // 判定観点
  outputItems: OutputItem[];         // 出力必須項目
  warnings: Warning[];               // 注意書き
  references: Reference[];           // 参照情報
}
```

---

## 2. 農水パイプライン基準プロファイル

### 基本情報

```yaml
id: nochi_pipeline_2021
name: 土地改良事業計画設計基準 設計「パイプライン」（令和3年6月改訂）
version: "2021-06"
scope: |
  農業用パイプライン（土地改良事業）における
  水撃圧・非定常流況の解析および設計水圧の算定
publisher: 農林水産省農村振興局
source_url: https://www.maff.go.jp/j/nousin/pipeline/pipeline.html
primary_chapter: "8. 非定常的な水理現象の解析"
```

---

### 2.1 用語定義

| 用語ID | 用語 | 定義 | 単位 |
|--------|------|------|------|
| `wave_speed` | 水撃波の伝播速度 (a) | 管内を伝わる圧力波の速度 | m/s |
| `joukowsky_head` | ジューコフスキー水頭 (ΔH) | 急閉そく時の理論最大水撃圧水頭 | m |
| `hmax_allievi` | アリエビ最大水頭 (Hmax) | 緩閉そく時の最大水撃圧水頭 | m |
| `vibration_period` | 圧力振動周期 (T₀) | 4L/a | s |
| `rapid_closure` | 急閉そく | tν ≦ 2L/a の条件 | — |
| `slow_closure` | 緩閉そく | tν > 2L/a の条件 | — |
| `equivalent_close_time` | 等価閉そく時間 (tν) | バルブ閉そくに要する有効時間 | s |
| `design_pressure` | 設計水圧 | 静水圧 + 水撃圧 | MPa |
| `static_head` | 静水圧水頭 (H₀) | バルブ位置における静水頭 | m |
| `alpha_value` | α値 | t₀/T₀ による基礎式適用判定値 | — |
| `c1_coeff` | 埋設状況係数 (C₁) | 管の埋設条件による係数 | — |
| `youngs_modulus_short` | 短期ヤング係数 (Eₛ) | 管材の短期弾性係数 | kN/m² |

---

### 2.2 設計フロー

```
Step 1. 解析目的の確認
  ├── (a) 施設設計（内圧荷重の決定）→ 水撃圧計算
  └── (b) 施設機能検討 → 非定常流況解析

Step 2. 解析方法の選択（8.3.2 図-8.3.4）
  ├── 経験則による方法（条件付き）
  │     条件: 給水栓を有する水田用配水系パイプライン
  │           かつ 低圧（静水圧 < 0.35MPa）
  │           かつ オープンタイプ
  └── 計算による方法（原則）
        ├── 理論解法（簡易計算）
        │     ├── 急閉そく → ジューコフスキーの式
        │     └── 緩閉そく → アリエビの近似式
        └── 数値解法
              ├── 特性曲線法
              └── 中心差分法

Step 3. 入力データの整備
  ├── 管種・管径・管厚・管路延長
  ├── 節点高さ（縦断情報）
  ├── 附帯施設（ポンプ・弁）の仕様
  ├── 運転条件（ケース設定）
  └── 定常計算結果（初期条件）

Step 4. 波速 a の算定（式8.2.4）
  └── a = 1 / √( w₀/g × (1/K + D·C₁/(Eₛ·t)) )

Step 5. 急/緩閉そく判定
  └── α = tν / (2L/a)
        α ≦ 1: 急閉そく → ジューコフスキー式
        α > 1: 緩閉そく → アリエビ式
              ただし tν > L/300 を確認
              tν ≦ L/300 → 数値解法必須

Step 6. 水撃圧の計算
  ├── 急閉そく: ΔH = -(a/g)·ΔV
  └── 緩閉そく: Hmax = H₀/2 × (K₁ + √(K₁² + 4))

Step 7. 設計水圧の算定
  └── 設計水圧 = 静水圧 + 水撃圧

Step 8. 負圧チェック
  └── 最大下降圧力 < 0 → 対策施設の検討

Step 9. 結果整理・帳票出力
  ├── ケース別シート
  ├── エンベロープ（最大・最小包絡線）
  └── 判定表
```

---

### 2.3 計算方法

#### (1) ジューコフスキーの式

```
id: joukowsky
name: ジューコフスキーの式（急閉そく）
formula: ΔH = -(a/g) × ΔV
applicable_when: tν ≦ 2L/a
inputs:
  - wave_speed (a)
  - velocity_change (ΔV)
  - gravity (g = 9.8 m/s²)
outputs:
  - pressure_rise_head (ΔH)  [m]
limitations:
  - 単一均質管路の単純急閉そくのみ
  - 多段管路は等価管路長換算が必要（式8.3.9）
```

#### (2) アリエビの近似式

```
id: allievi
name: アリエビの近似式（緩閉そく）
formula_close: Hmax = H₀/2 × (K₁ + √(K₁² + 4))
formula_open:  Hmax = H₀/2 × (K₁ - √(K₁² + 4))
k1_formula: K₁ = (L·V) / (g·H₀·tν)²
applicable_when: tν > 2L/a かつ tν > L/300
inputs:
  - pipe_length (L)
  - initial_velocity (V)
  - gravity (g)
  - static_head (H₀)
  - equivalent_close_time (tν)
outputs:
  - max_pressure_head (Hmax)  [m]
limitations:
  - tν ≦ L/300 の場合は適用不可 → 数値解析へ
  - 単純管路（単段）の場合に厳密適用
  - 多段管路は等価管路長換算
```

#### (3) 経験則による方法

```
id: empirical
name: 経験則による水撃圧設定
applicable_when:
  - 系統: 給水栓を有する水田用配水系パイプライン
  - 形式: オープンタイプ
  - 静水圧: < 0.35MPa

rules:
  open_gravity:
    description: 自然圧送・オープンタイプ
    formula: 水撃圧 = 動水勾配線による水圧の 20%

  closed_gravity_low:
    description: 自然圧送・クローズド/セミクローズド（低圧）
    condition: 静水圧 < 0.35MPa
    formula: 水撃圧 = 静水圧の 100%

  closed_gravity_high:
    description: 自然圧送・クローズド/セミクローズド（高圧）
    condition: 静水圧 ≧ 0.35MPa
    formula: 水撃圧 = max(静水圧の 40%, 0.35MPa)

  pump_tank_low:
    description: ポンプ系・配水槽方式（低圧）
    condition: 通水時水圧 < 0.45MPa
    formula: 水撃圧 = 動水圧の 100%

  pump_tank_high:
    description: ポンプ系・配水槽方式（高圧）
    condition: 通水時水圧 ≧ 0.45MPa
    formula: 水撃圧 = max(動水圧の 60%, 0.45MPa)

  pump_direct_low:
    description: ポンプ圧送方式・コントロールなし（低圧）
    condition: 静水圧 < 0.45MPa
    formula: 水撃圧 = 静水圧の 100%

  pump_direct_high:
    description: ポンプ圧送方式・コントロールなし（高圧）
    condition: 静水圧 ≧ 0.45MPa
    formula: 水撃圧 = max(静水圧の 60%, 0.45MPa)

  pump_pressure_tank_low:
    description: 圧力タンクを持つ圧送系（OFFライン・低圧）
    condition: 静水圧 < 0.35MPa
    formula: 水撃圧 = 静水圧の 100%

  pump_pressure_tank_high:
    description: 圧力タンクを持つ圧送系（OFFライン・高圧）
    condition: 静水圧 ≧ 0.35MPa
    formula: 水撃圧 = max(静水圧の 40%, 0.35MPa)
```

---

### 2.4 初期パラメータ（defaultParameters）

| パラメータID | 値 | 単位 | 根拠 |
|------------|-----|------|------|
| `gravity` | 9.8 | m/s² | 基準書既定値 |
| `bulk_modulus_water` | 2.03×10⁶ | kN/m² | 基準書表-8.2.1 |
| `c1_default` | 1.0 | — | 基準書式(8.2.4)注 |
| `water_unit_weight` | 9.8 | kN/m³ | — |

管材別ヤング係数（短期）:

| 管種コード | Eₛ (kN/m²) |
|-----------|------------|
| `steel` | 200×10⁶ |
| `ductile_iron` | 160×10⁶ |
| `rcp` | 20×10⁶ |
| `cpcp` | 39×10⁶ |
| `upvc` | 3×10⁶ |
| `pe2` | 1×10⁶ |
| `pe3_pe100` | 1.3×10⁶ |
| `wdpe1` | 21.6×10⁶ |
| `wdpe2` | 19.6×10⁶ |
| `wdpe3` | 16.7×10⁶ |
| `wdpe4` | 15.2×10⁶ |
| `wdpe5` | 14.7×10⁶ |
| `grp_fw` | 51×10⁶ |
| `gfpe` | 2.5×10⁶ |

長期ヤング係数: `E_long = Eₛ × 0.8`（樹脂系管材）

---

### 2.5 判定観点

| 判定ID | 判定名 | 条件 | 重要度 |
|--------|--------|------|--------|
| `alpha_check` | 基礎式適用判定 | α = t₀/T₀ ≦ 1.0 で弾性体理論必須 | INFO |
| `closure_type` | 急/緩閉そく判定 | tν vs 2L/a | INFO |
| `allievi_applicable` | アリエビ式適用条件 | tν > L/300 | WARNING |
| `negative_pressure` | 負圧発生チェック | 最小圧力 < 0 | WARNING |
| `design_pressure_ok` | 設計水圧 ≦ 許容水圧 | 管種耐圧強度との比較 | ERROR |
| `empirical_condition` | 経験則適用条件 | 低圧・オープン系条件 | INFO |

---

### 2.6 注意書き

1. 数値解法が必要なケース:
   - `tν ≦ L/300`（アリエビ式適用不可の中間域）
   - 負圧・気泡発生の恐れがある系
   - ポンプ急停止（詳細は設計「ポンプ場」を参照）
   - サージタンク・空気槽等の防護施設を持つ系

2. 多段口径管路:
   - 等価管路長 L = L₁ + L₂·(A₁/A₂) + ... を用いる（式8.3.9）

3. 樹脂系管材:
   - 長期ヤング係数 = 短期値 × 0.8 で再評価が必要な場合あり

4. 経験則の限界:
   - 給水栓を持たない系・クローズド系・ポンプ系には原則適用不可
   - 静水圧 ≧ 0.35MPa の場合は計算法が原則

---

### 2.7 参照情報

| 参照ID | タイトル | URL |
|--------|---------|-----|
| `maff_pipeline_main` | 土地改良事業計画設計基準 設計「パイプライン」 | https://www.maff.go.jp/j/nousin/pipeline/pipeline.html |
| `maff_pipeline_ch8` | 技術書 第8章（PDF） | https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-58.pdf |
| `maff_pipeline_full` | 基準・運用・解説 全文（PDF） | https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-67.pdf |

---

## 3. 他基準との比較整理（今後の展開）

| 基準 | ID（予定） | 主な違い | 実装優先度 |
|------|-----------|---------|-----------|
| 水道施設設計指針 | `suido_2012` | 給水圧の考え方、管種の違い | Phase 3 |
| 下水道管きょ設計指針 | `gesui_2014` | 低圧系、負圧が主 | Phase 3 |
| 発電用水力設備関係基準 | `denki_suiryoku` | 高揚程・ポンプ水車系 | Phase 3 |

各基準の差分は `standards-comparison.md`（別途作成予定）に整理する。
