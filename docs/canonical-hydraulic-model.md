# 正準水理モデル

## 目的

Excel、GIS、Web入力、定常解析、縦断水理計算、MOCの間で、管径・粗度・延長・接続関係を個別に持たないための共通モデルを定める。実装上のスキーマは `open-waterhammer/hydraulic-model` version 1 とする。

## ER図

```mermaid
erDiagram
  HYDRAULIC_MODEL ||--o{ NODE : contains
  HYDRAULIC_MODEL ||--o{ PIPE : contains
  HYDRAULIC_MODEL ||--o{ MEASUREMENT_POINT : contains
  HYDRAULIC_MODEL ||--o{ HYDRAULIC_UNIT : derives
  NODE ||--o{ PIPE : from_node
  NODE ||--o{ PIPE : to_node
  PIPE ||--o{ MEASUREMENT_POINT : positions
  NODE o|--o| MEASUREMENT_POINT : same_location_only
  PIPE ||--o{ HYDRAULIC_UNIT : partitions
  HYDRAULIC_UNIT }o--o{ MEASUREMENT_POINT : covers

  NODE {
    string id PK
    string kind
    number elevation
    number boundaryHead
    coordinate coordinate
  }
  PIPE {
    string id PK
    string fromNodeId FK
    string toNodeId FK
    string material
    number innerDiameter
    number wallThickness
    number length
    number roughnessC
    coordinate-array centerline
  }
  MEASUREMENT_POINT {
    string id PK
    string pipeId FK
    string nodeId FK_optional
    number sequence
    number distanceAlongPipe
    number groundElevation
    number pipeCenterElevation
    number localLosses
  }
  HYDRAULIC_UNIT {
    string id PK
    string pipeId FK
    number fromDistance
    number toDistance
    number designFlow
  }
```

## エンティティの責務

### 節点

管路網の接続と境界を表す。分岐・合流、端点、貯水池・水槽、ポンプ、バルブを節点として扱う。接続用のID、種別、標高、実座標、貯水池等の固定水頭を保持する。解析結果の動水位は正準入力に上書きせず、計算記録に保存する。

### 管路

始点節点と終点節点を結ぶ有向区間である。管種、管内径、管厚、実延長、Hazen–Williams粗度係数、材料係数、GIS上の中心線を保持する。管径・粗度・管路延長の正本は管路とする。

### 測点

管路上の縦断・水理計算位置である。所属管路ID、管路始点からの実延長、順序、地盤高、管中心高、局部損失を保持する。測点自体は管路網を分岐させない。分岐、端点、施設と同一位置にある場合のみ `nodeId` で節点を参照できる。

### 水理ユニット

同じ管路上で、管路諸元と設計流量を1組として扱える最小解析区間である。正準管路を参照し、管種・管径・粗度を重複保持しない。シナリオや定常解析に依存する設計流量だけを持つ。

分割境界は次のいずれかとする。

- 管路の始終点
- 分岐・合流、取水、流量設定の変更位置
- 管径、管種、粗度が変わる位置。この場合は正準管路自体も別管路に分割する
- 解析手法が明示的な境界を要求する施設位置

隣接ユニットは、同じ管路、連続する距離、同じ設計流量、境界施設なしの全条件を満たす場合だけ結合できる。

## 正本と派生値

| 値 | 正本 | 派生・検証規則 |
|---|---|---|
| 管路接続 | 管路の始終点ID | GIS線形の端点は一致を検証する |
| 管種、管径、管厚、粗度 | 管路 | 旧測点列は取込時の照合にのみ使い、不一致時は管路値を採用して警告する |
| 管路実延長 | 管路 | GIS中心線長と測点の斜距離合計は照合値 |
| 実座標 | 節点の座標と管路中心線 | 測点は所属管路と実延長から平面位置を内挿できる |
| 測点距離 | 測点の管路始点からの実延長 | 単距離・斜距離は旧帳票の区間値として保持し、整合を検証する |
| 地盤高、管中心高、局部損失 | 測点 | 縦断図・縦断水理計算へ展開する |
| 設計流量 | 水理ユニット | 定常解析結果がある場合は計算記録側の結果と区別する |
| 動水位、最大・最小水頭 | 計算記録 | 正準入力に書き戻さない |

## 変換規則

### Excel

- 「管路・節点」を管路・節点の正本とする。
- 「測点データ」に `pipe_id`、任意の `node_id`、`distance_along_pipe` を追加する。
- 旧Excelで `pipe_id` がない場合は、管路の入力順と測点の斜距離累計から補完し、警告を残す。補完できない測点は `unresolved` として保持する。
- 旧測点の管径・粗度は互換入力と照合に使うが、不一致時は管路の値を採用する。

### GIS

- Pointは節点、LineStringは管路に対応させる。
- CRSはモデルに1つ保持し、節点座標と管路中心線はそのCRSで保持する。WGS84は書出し時の変換先であり正本ではない。
- GISにない管厚・粗度等は未解決項目とし、Excel/Webの値とIDで統合する。
- alpha版で利用できる操作、部分対応、未対応機能と統合時の責任分界は[GIS機能のalpha版範囲](./gis-alpha-scope.md)に従う。

### 数値解析と図面

- 定常管路網は管路と節点から導出する。ポンプ・バルブ・水槽の解析上の扱いはアダプタが明示する。
- 縦断水理計算は測点の位置・標高・局部損失と、参照先管路の管径・粗度、水理ユニットの設計流量から導出する。
- MOCは管路・節点・水理ユニットから計算格子を作り、波速、分割数、境界条件は解析入力とシナリオから与える。
- 平面図と縦断図は同じ正準IDを使い、Excel/GIS/Web別の描画ロジックを持たない。
- 平面図の実座標／模式配置の切替、入力仕様、接続エラーの表示は[管路平面図・模式図](./plan-view.md)に従う。
- 測点の入力確認図、計算結果の重ね合わせ、距離不整合の扱いは[入力・計算結果の縦断図](./longitudinal-profile.md)に従う。
- 保存済みMOC時系列の平面・縦断同期表示と描画用の間引きは[圧力波アニメーション](./pressure-wave-animation.md)に従う。正準モデルと計算記録自体は間引かない。

## `.owhproj` 互換と移行

- version 1 の正準モデルは `Case.modelSnapshot.canonicalModel` へ追加保存する。既存ファイルの必須項目を変更しないため、`.owhproj` 全体の形式は下位互換とする。
- 新しいExcel取込みでは `canonicalModel` と `canonicalIssues` を作り、各 `runInputs` は正準モデルから導出する。
- `canonicalModel` がない旧プロジェクトはそのまま読み込み、既存 `runInputs`、`excelImport`、`geoDrafts` は変更しない。Excel再読込みまたは将来の明示的な移行操作で正準モデルを追加する。
- 移行時に推定した管路参照と重複値の不一致は `canonicalIssues` に残し、利用者の確認なしに元データを削除しない。

## 実装位置

- 型・正規化・変換: `packages/core/src/canonical-model.ts`
- Excel列と後方互換読込み: `packages/excel-io/src/template.ts`, `packages/excel-io/src/reader.ts`
- Webプロジェクトへの保存: `apps/web-free/src/workspace/excel-import.ts`, `bootstrap.ts`, `workspace-context.tsx`
