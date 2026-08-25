# バージョン固定オフライン版

GitHub の `v*` タグごとに、GitHub Release へ次のファイルを公開する。

- `open-waterhammer-<tag>-offline.zip`: ブラウザー版の静的ファイル
- `open-waterhammer-<tag>-offline.zip.sha256`: ZIP の SHA-256
- `open-waterhammer-<tag>-sbom.cdx.json`: npm 依存関係の CycloneDX SBOM

## 取得と検証

ZIP と `.sha256` を同じリリースから取得し、例えば次のように照合する。

```bash
sha256sum -c open-waterhammer-<tag>-offline.zip.sha256
```

PowerShell では次の値と `.sha256` の先頭値を比較する。

```powershell
(Get-FileHash .\open-waterhammer-<tag>-offline.zip -Algorithm SHA256).Hash.ToLowerInvariant()
```

SHA-256 は同一リリース上の偶発的な破損や差し替えの検出用であり、リポジトリ・GitHub アカウント
自体の侵害に対する独立した署名ではない。

## 組織内で配信する

ZIP を組織内のディレクトリに展開し、`file://` ではなく HTTP サーバーから配信する。
WebAssembly と ES Modules の読み込みに HTTP が必要である。

```bash
python -m http.server 8080 --directory open-waterhammer-<tag>-offline
```

ブラウザーで `http://127.0.0.1:8080/` を開く。組織内サーバーへ配置する場合は HTTPS を使い、
ZIP に同梱される `_headers` と同等のレスポンスヘッダーを配信環境で設定する。

## ソースから作成する

Node.js、Python、Marimo/uv を準備し、通常の依存関係・notebook ビルド後に相対パスで Web 版を
ビルドする。

```bash
npm ci
pip install marimo uv
npm run build
node scripts/build-notebooks.mjs
VITE_BASE_PATH=./ npm run build --workspace=apps/web-free
```

Windows PowerShell の最後の行は次の形にする。

```powershell
$env:VITE_BASE_PATH='./'; npm run build --workspace=apps/web-free; Remove-Item Env:VITE_BASE_PATH
```

成果物は `apps/web-free/dist/` に出力される。
