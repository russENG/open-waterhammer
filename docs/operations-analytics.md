# 運用: 公開サイトの日次アクセス数を見る

公開サイト <https://russeng.github.io/open-waterhammer/> の閲覧数を Cloudflare Web Analytics で
計測し、Cloudflare ダッシュボードで日次の推移を確認するための手順。

計測コード自体は実装済み（[`apps/web-free/web-analytics.ts`](../apps/web-free/web-analytics.ts)）だが、
**ビーコントークンが未設定のあいだは無効**であり、アクセス数は記録されない。有効化はリポジトリ変数
`CF_BEACON_TOKEN` を1つ登録するだけで完了する。

> **遡及計測はできない。** 記録が始まるのはトークン設定後に再デプロイされた時点からで、それ以前の
> アクセスは取得できない。

---

## 1. Cloudflare Web Analytics にサイトを登録する

1. [Cloudflare ダッシュボードの Web Analytics](https://dash.cloudflare.com/?to=/:account/web-analytics)
   を開く（メニューでは **Analytics & Logs → Web Analytics**）。
2. **Add a site**（サイトを追加）を選ぶ。
3. ホスト名に `russeng.github.io` を入力する。

   ここで入力するのはホスト名までだが、**集計対象が `russeng.github.io` 全体に広がることはない**。
   本サイトはビーコンを手動で埋め込む方式（gray-clouded / manual setup）であり、Cloudflare の
   仕様上「スニペットを描画したページだけが報告される」ため、計測されるのはビーコンを含む
   `/open-waterhammer/` 配下のみ。同じ `russeng.github.io` で公開している他の GitHub Pages
   サイトは、そちらにも同じスニペットを入れない限り一切数えられない。
4. 発行された JS スニペットのうち、`data-cf-beacon='{"token": "……"}'` の**トークン文字列だけ**を
   コピーする。スニペット全体を貼り付ける必要はない（`<script>` タグの生成はビルド側が行う）。

   Cloudflare が表示するスニペットは `type="module"` 形式だが、こちらの実装は `defer` で読み込む。
   `beacon.min.js` は `import`/`export` を含まない IIFE バンドルであり、クラシックスクリプトとして
   問題なく動作することを確認済み（2026-08-25 時点）。両者に機能差はない。

Cloudflare のこのプランは無料で、DNS を Cloudflare に向ける必要はない（ビーコン方式のため）。

## 2. リポジトリ変数にトークンを登録する

トークンは配信される HTML に平文で埋め込まれる**公開情報**なので、Secret ではなく Variable を使う。

```bash
gh variable set CF_BEACON_TOKEN --repo russENG/open-waterhammer --body "<コピーしたトークン>"
```

GitHub の画面から設定する場合は
[Settings → Secrets and variables → Actions → Variables](https://github.com/russENG/open-waterhammer/settings/variables/actions)
→ **New repository variable**、名前 `CF_BEACON_TOKEN`。

トークンは英数字 8〜64 文字であることをビルド時に検証している。形式が不正なら
`VITE_CF_BEACON_TOKEN must be 8-64 alphanumeric characters` でビルドが失敗する（HTML 属性への
文字列注入を構造的に防ぐため）。

### 付録: 手順 1〜2 を CLI で行う

Cloudflare の公式 CLI である **wrangler は Web Analytics に対応していない**。wrangler の守備範囲は
Workers / Pages / D1 / R2 / KV / Queues / Vectorize などで、RUM（＝Web Analytics）のコマンドは
存在しないため、サイト登録もトークン取得も wrangler ではできない。

CLI で完結させたい場合は REST API を curl で叩く。前提として、Cloudflare ダッシュボードの
[My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens) で API トークンを発行しておく（サイト登録には **Account Settings: Edit**
権限が必要。読み取りだけなら Account Analytics: Read）。トークンはシェル履歴に残さないよう、
変数へは対話的に読み込む。

```bash
read -rs -p "CF_API_TOKEN: " CF_API_TOKEN && export CF_API_TOKEN
```

アカウント ID を確認する。

```bash
curl -s https://api.cloudflare.com/client/v4/accounts -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[] | [.id, .name] | @tsv'
```

既存の登録サイトを一覧する（すでに登録済みならここでトークンが取れる）。ホスト名など全項目を
見たいときは `jq .result` に替える。

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/rum/site_info/list" -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[] | [.site_tag, .site_token] | @tsv'
```

未登録なら新規作成する。GitHub Pages は Cloudflare のプロキシ配下ではない（gray-clouded）ため、
`host` を指定し `auto_install` は `false` にする——スニペットの注入はビルド側が行うため、
Cloudflare に自動注入させる必要はない。

```bash
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/rum/site_info" -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" -d '{"host":"russeng.github.io","auto_install":false}' | jq -r .result.site_token
```

出力された `site_token` が手順 2 で登録するビーコントークン。そのままリポジトリ変数へ渡せる。

```bash
gh variable set CF_BEACON_TOKEN --repo russENG/open-waterhammer --body "$(curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/rum/site_info/list" -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[0].site_token')"
```

参考: Terraform を使っている場合は `cloudflare_web_analytics_site` リソースが同じ API を包んでいる。

## 3. 再デプロイする

`master` への push で [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) が動く。
コード変更なしで反映したい場合は、
[Actions の Deploy to GitHub Pages](https://github.com/russENG/open-waterhammer/actions/workflows/pages.yml)
から `workflow_dispatch`（Run workflow）で手動実行する。

```bash
gh workflow run pages.yml --repo russENG/open-waterhammer
```

## 4. 有効化を確認する

デプロイ完了後、配信中の HTML にビーコンが入っていることを確認する。

```bash
curl -s https://russeng.github.io/open-waterhammer/ | grep -o 'data-cf-beacon'
```

`data-cf-beacon` が1件出力されれば有効。何も出なければ変数が未設定か、デプロイが未完了。
ブラウザの開発者ツールでは、Network タブに `static.cloudflareinsights.com/beacon.min.js` の
読み込みと `cloudflareinsights.com` への POST が見える。

## 5. 日次アクセス数の見方

[Cloudflare ダッシュボードの Web Analytics](https://dash.cloudflare.com/?to=/:account/web-analytics)
→ 対象サイトを選ぶ。

| 指標 | 意味 |
|---|---|
| **Page views** | ページ表示回数。同一利用者の複数ページ閲覧・再読込も各回数える |
| **Visits** | 訪問数。外部参照元から遷移してきた一連の閲覧を1と数える |
| **Visitors** | 概算の利用者数（クッキーを使わない推定値） |

期間セレクタで **Last 24 hours / Last 7 days / Last 30 days** を切り替えると、上部のグラフが日次
（または時間別）の推移になる。データ保持期間は無料プランで直近6か月。

このサイトに表示される数値は最初から open-waterhammer の分だけである（手順1の注記を参照）。
さらにページ単位で内訳を見たい場合は、**Path** ディメンションで絞り込む——例えば
`/open-waterhammer/` は作業画面、`/open-waterhammer/#/docs/library` は式集ページの閲覧数になる。
利用できるディメンションは Country / Host / Path / Referer / Device type / Browser /
Operating system / Site / Navigation type と、ボット除外（Exclude Bots）。

---

## 計測されないもの

- **ローカル開発・E2E・フォークのビルド**: `VITE_CF_BEACON_TOKEN` が渡されないため、ビーコンも
  対応する CSP 許可も注入されず、`index.html` はバイト単位で不変。「外部オリジンへの通信ゼロ」と
  いう不変条件がそのまま保たれる（E2E がこれを検証している）。
- **入力値・計算結果・プロジェクトデータ**: 計算はブラウザ内の Pyodide で完結し、作業状態は
  IndexedDB に留まる。Cloudflare に送られるのはページ単位の閲覧記録（URL・参照元・UA・IP から
  推定される大まかな地域）のみで、クッキーも個人識別 ID も使わない。README の
  「データ境界」を参照。

## 定期メールについて

Cloudflare Web Analytics（ビーコン方式）に**定期レポートのメール送信機能はない**。メール通知は
DNS を Cloudflare に向けたゾーン向けの機能で、GitHub Pages 上の `russeng.github.io` はゾーンでは
ないため対象外。定期メールが必要になった場合は、GitHub Actions のスケジュール実行で Cloudflare
GraphQL Analytics API を叩き、結果を送信する仕組みを別途作ることになる（要 API トークンと送信経路）。

---

## 参考リンク

- [Cloudflare Web Analytics — Get started](https://developers.cloudflare.com/web-analytics/get-started/)
- [Cloudflare Web Analytics — FAQ（手動設定ではスニペットのあるページのみ報告される）](https://developers.cloudflare.com/web-analytics/faq/)
- [Cloudflare Web Analytics — Dimensions（Path などの絞り込み軸）](https://developers.cloudflare.com/web-analytics/data-metrics/dimensions/)
- [Cloudflare API — RUM Site Info（サイト作成）](https://developers.cloudflare.com/api/resources/rum/subresources/site_info/methods/create/)
- [Cloudflare Analytics — API トークンの設定](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/)
- [GitHub Actions — 変数（Variables）](https://docs.github.com/actions/learn-github-actions/variables)
