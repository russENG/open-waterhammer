# UI 文言辞書

Open Waterhammer の利用者向け画面で使う用語と表記を定める。コード、スキーマ、ファイル形式で使う英語の内部名と、画面に表示する日本語を混同しない。

## 運用ルール

1. 新規機能の追加、既存画面の改修、エラーメッセージの変更前にこの辞書を確認する。
2. 利用者に見える本文、見出し、ボタン、入力ラベル、ツールチップ、代替テキスト、状態表示には「画面で使う表記」を使う。
3. TypeScript の型名、API、JSONキー、URL、ファイル形式、計算方式の正式名は内部表記のままでよい。
4. 辞書にない用語を追加するときは、画面実装と同じ変更でこの辞書にも追記する。
5. 変更後は `npm run lint:wording` を実行する。

## 基本用語

| 内部表記・避ける表記 | 画面で使う表記 | 使用上の補足 |
|---|---|---|
| Workspace | 作業画面 | 製品機能の説明では「設計比較ワークスペース」も可 |
| Project | プロジェクト | 日本語表記に統一する |
| Alternative | 代替案 | 設計上の大きな方針を表す |
| Case | 比較案 | 「計算ケース」のように水理分野の意味が明確な場合のみ「ケース」を可とする |
| Scenario | シナリオ | 一般化したカタカナ語として使用する |
| Run | 計算、計算結果、計算記録 | 操作は「計算」、保存物は「計算結果」または「計算記録」とする |
| manifest | 計算記録 | 検証用JSONの項目名を説明するときのみ `manifest` を併記できる |
| provenance | 由来情報 | 技術者向け詳細表示で併記する場合は「由来情報（provenance）」とする |
| local-first | ローカル保存 | 保存先を説明するときは「このブラウザ内に保存」と具体化する |
| offline build | バージョン固定のオフライン版 | 公開サイトと区別し、組織内で配信する静的成果物を指す |
| static hosting | 静的配信 | 技術構成の説明に限って使用する |
| evidence preserved | 証跡保持 | 計算条件・結果・由来情報を保持することを表す |
| source of truth / master | 正本 | 複数の入力元がある場合に、以後の確認・修正で基準とするデータを指す。初出では何が正本か具体的に書く |
| initial import / initial input | 初期一括入力 | Excelからプロジェクト開始時のデータをまとめて読み込む用途を指す |

## 作業状態

| 内部状態・避ける表記 | 画面で使う表記 | 意味 |
|---|---|---|
| `draft` / draft | 編集中 | 入力条件を変更できる比較案 |
| draft data / drafts | 編集中データ | 未接続・不正要素を含め、修正可能な状態で保持するデータ |
| `locked` / locked | 計算済み・固定 | 計算成功後に入力条件を固定した比較案 |
| `archived` / archived | 保管済み | 通常作業から外して保管した比較案 |
| fork / Fork | 複製して編集 | 固定済みの比較案から編集可能な比較案を作る操作 |

状態名は、色だけに依存せず必ず文字でも表示する。

## 計算・評価状態

| 内部状態 | 画面で使う表記 |
|---|---|
| `pending` | 計算待ち |
| `running` | 計算中 |
| `succeeded` | 計算完了 |
| `failed` | 計算失敗 |
| `interrupted` | 中断 |
| `pass` | 適合 |
| `warning` | 注意 |
| `fail` | 不適合 |
| `needs_review` | 要確認 |
| `not_applicable` | 対象外 |

画面実装では `apps/web-free/src/workspace/run-display-labels.ts` の共通表示名を使い、画面ごとに別の訳語を定義しない。

## 操作文言

| 避ける表記 | 画面で使う表記 |
|---|---|
| New Case | 新しい比較案 |
| Start from Excel | Excelから開始（実案件の主操作） |
| Save input | 入力条件を保存 |
| Run calculation | 計算を実行 |
| Import as drafts | 編集中データとして読み込む |
| Export | 書き出す |
| Import | 読み込む |
| Open Project | プロジェクトを開く |
| Replace Project | プロジェクトを置き換える |
| Re-import | 読み直す / 再読込 | ボタンは動作が分かる「確認して上書き」を優先する |
| Cancel | キャンセル |
| Close | 閉じる |

## 技術用語として使用できる表記

次はファイル形式・座標系・一般的な製品名または技術名のため、必要な説明を添えて使用できる。

- GIS、GeoJSON、CRS、EPSG、WGS84、Proj4
- IndexedDB、GitHub Pages、Pyodide
- JSON、Excel、`.xlsx`、`.owhproj`
- Joukowsky、Allievi、Hazen–Williams、Darcy–Weisbach、EPANET

英略語だけで意味が伝わりにくい場合は、初出で日本語の説明を付ける。
