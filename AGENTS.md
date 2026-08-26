# Repository instructions

## 開発ワークフロー

機能追加・不具合修正は Superpowers の7段階ワークフロー（ブレインストーミング → git worktree →
計画 → サブエージェント駆動 → TDD → コードレビュー → ブランチ完了）に従う。
以下は、このリポジトリ固有の制約として上書きする事項。

### 計画を分割するときの制約

- **TypeScript と Python の数値実装は分割しない。** `packages/core` と `packages/core-py` は
  同じ計算の二重実装で、自動テストが数値一致を固定している。片方だけ変えるとテストが落ちるため、
  対応する変更・ゴールデン値・ドキュメントは1つのタスク（1コミット）にまとめる。
- 受入スクリプトの数値ゴールデン（`scripts/acceptance.mjs` の `GOLDEN_NUMERICS`）が動いたときは、
  値を書き換えるだけで済ませない。**なぜ動いたのかをコメントに残す**（旧値・変化の物理的な理由）。
  ドキュメントに同じ数字が載っていることが多いので、あわせて追う。
- 作業ログ・設計メモは `.superpowers/` に置かれるが、ここは gitignore 対象である。
  **ブランチを終える前に、設計判断は `docs/` 配下の恒久文書へ移すこと。**
  過去に拡張合意 A1〜A11 が作業ログにしか存在しない状態が生じ、`docs/design-workspace.md` へ
  統合して解消した経緯がある。

### 完了の判定

「動いた」ではなく、**CIと同じ手順で確認できた**ことをもって完了とする。CIは次の順に実行する。

```bash
npm run build && npm run test --workspaces --if-present && npm run typecheck && npm run lint
python -m pytest packages/core-py -q
npm run acceptance
npx playwright test --config apps/web-free/playwright.config.ts
```

落とし穴が3つある。いずれも実際に誤った報告を生んだもの。

- **`npm run build` / `npm run typecheck` は、テストファイルを追加・変更した後にもう一度通す。**
  ビルドはインクリメンタルなので、追加前のビルド結果が再利用され、型エラーがCIで初めて出ることがある。
  疑わしいときは `.tsbuildinfo` を消してから走らせる。
- **web-free のテストはワークスペース単位で起動する**（`npm run test --workspace web-free`）。
  リポジトリ直下で `vitest` を直接叩くと jsdom 環境設定が効かず、無関係な失敗が大量に出る。
  ワーカー起動がタイムアウトする場合は `-- --maxWorkers=2` を付ける。
- **`npm run acceptance` は worktree が汚れていると最後の1項目が必ず落ちる**（意図した挙動）。
  コミット後に確認する。

## UI wording

利用者向け画面の新規機能追加・改修・レビューを行う前に、`docs/ui-terminology.md` を読むこと。

- 内部の状態名やスキーマ名を、そのまま画面に表示しない。
- 新しい利用者向け用語を導入するときは、実装と同じ変更で辞書を更新する。
- UI変更後は `npm run lint:wording` を実行する。
