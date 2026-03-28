# コントリビュートガイド

open-waterhammer へのコントリビュートを歓迎します。

---

## 開発環境のセットアップ

```bash
# リポジトリをクローン
git clone <repository-url>
cd open-waterhammer

# 依存パッケージをインストール（npm workspaces）
npm install

# core パッケージのテストを実行
cd packages/core
npm test

# web-free の開発サーバーを起動
cd apps/web-free
npm run dev
```

**必要な環境:**
* Node.js 22 以上
* npm 10 以上

---

## ディレクトリ構成

```
packages/
  core/          計算エンジン・型定義・基礎式
  standards/     基準プロファイル（StandardProfile）
  excel-io/      Excel 入出力
  sample-data/   デモ・検証用データ
  epanet-adapter/ 定常計算接続（将来）
  report-basic/  出力生成（将来）
apps/
  web-free/      ブラウザ向け無料版 UI（Vite + React）
docs/            仕様・設計・検証文書
```

---

## コントリビュートの種類

### バグ報告

Issue に以下を記載してください：

1. 再現手順（入力値・操作）
2. 期待した結果
3. 実際の結果
4. 環境（OS・Node.js バージョン・ブラウザ）

### 計算式・基準の誤り指摘

公共設計ツールとして計算の正確性は最重要です。誤りを見つけた場合：

1. 参照した基準書・式番号を明記してください
2. 正しい式・パラメータを提示してください
3. 可能であれば数値例を添えてください

### 新しい基準プロファイルの追加

`packages/standards/src/` に新しい `StandardProfile` を実装してください。既存の `nochi-pipeline-2021.ts` を参考にしてください。

### コードの修正・機能追加

1. Issue を立ててから作業を開始することを推奨します
2. `packages/core` に変更を加える場合は必ずユニットテストを追加・更新してください
3. 型定義（`types.ts`）の変更は影響範囲が広いため、事前に相談してください

---

## コーディング規約

* **言語:** TypeScript（strict モード）
* **モジュール:** ESM（`.js` 拡張子付きインポート）
* **フォーマット:** 特定のフォーマッターは現時点で未設定。既存コードのスタイルに合わせてください
* **テスト:** Node.js built-in test runner（`node:test`）+ `tsx`

---

## 計算ロジックの変更方針

* すべての計算式には出典（基準書名・式番号）をコメントで記載する
* 適用条件・限界を関数コメントに明示する
* 基準書の解釈に複数の流派がある場合は、採用した解釈とその理由を記載する

---

## ライセンス

コントリビュートされたコードは本リポジトリのライセンス（AGPL-3.0-or-later）に従います。
詳細は [license.md](./license.md) を参照してください。
