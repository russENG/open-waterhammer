# scripts/

リポジトリ全体に関わる軽量スクリプト。各 workspace 固有のものは
それぞれの `apps/*/scripts/` または `packages/*/scripts/` に置く。

## check-ui-wording.mjs — UI 文言チェッカ

ユーザー画面に表示される文字列に「英略語」「設計基準と異なる用語」が
混入することを防ぐ AST ベースの lint。

### 何をチェックするか

`apps/web-free/src/**/*.{ts,tsx}` を TypeScript の AST で歩き、
**ユーザーに表示される可能性が高い文字列ノードのみ** を対象に禁止語の有無を判定する。

対象:
- JSX テキスト（`<div>これ</div>` の「これ」）
- JSX 属性 `title` / `aria-label` / `placeholder` / `alt` / `label` の文字列値
- オブジェクトプロパティで、キーが `title` / `label` / `name` / `desc` /
  `description` / `text` / `message` / `hint` / `tooltip` / `ariaLabel` /
  `placeholder` の文字列値

対象外（誤検知の原因になるため意図的に除外）:
- `import` / `export` / 型注釈 / 関数名 / クラス名 / ファイル名
- コードコメント（`//` `/* */`）
- 内部用の任意のキー名（`key`, `id`, `pipeId` 等）

### 実行

```bash
# 単独実行
npm run lint:wording

# `npm run lint` の最後にも実行される
npm run lint
```

### 禁止語の追加

`scripts/check-ui-wording.mjs` の `FORBIDDEN` 配列に
`{ term, reason, suggest }` を追加する。`term` は `RegExp`。

```js
const FORBIDDEN = [
  {
    term: /\bMOC\b/,
    reason: '設計基準では「数値解法 / 数値解析」、その下位手法として「特性曲線法」と呼称している',
    suggest: '一般カテゴリは「数値解析」、アルゴリズム参照が必要なら「特性曲線法」',
  },
  // ↓ ここに追加
];
```

### なぜ ESLint プラグインではないか

ESLint の `no-restricted-syntax` でも JSX テキストや特定属性は拾えるが、
**「特定キー名 (`desc` 等) の値である文字列のみ」** という条件を素直に書きづらく、
独自プラグインが必要になる。リポジトリ既存の `typescript` を直接使う
スクリプトのほうが依存追加なしで保守しやすいため、こちらを採用した。
