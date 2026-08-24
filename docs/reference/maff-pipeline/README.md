# MAFF パイプライン技術書 ローカルキャッシュ

土地改良事業計画設計基準 設計「パイプライン」技術書（令和3年6月改訂）の
章別PDF・抽出テキストを置くローカルキャッシュです。

**PDF/テキストはリポジトリにコミットされません**（`.gitignore` で除外）。
理由: 政府文書の著作権はMAFFが保有しており、本リポジトリ（AGPL-3.0）から
再配布するのは適切でないため。各開発者がMAFF公式サイトから直接取得します。

## 使い方

```bash
cd docs/reference/maff-pipeline
bash fetch.sh
```

`ch1.pdf`, `ch1.txt`, `ch3.pdf`, … が生成されます。
監査作業時は `ch8.txt` などをそのまま参照してください。

## 章とMAFFファイル番号

| 章 | 内容 | MAFFファイル |
|----|------|---------------|
| 1  | 総則 | pipeline-24.pdf |
| 3  | 管路の水理設計 | pipeline-6.pdf |
| 6  | 管種・継手 | pipeline-8.pdf |
| 7  | 定常水理計算 | pipeline-49.pdf |
| 8  | 非定常水理（水撃圧） | pipeline-58.pdf |
| 9  | 防護工 | pipeline-61.pdf |
| 10 | 付帯施設 | pipeline-16.pdf |
| 13 | 維持管理 | pipeline-48.pdf |
| 14 | 試験・検査 | pipeline-68.pdf |

出典: <https://www.maff.go.jp/j/nousin/pipeline/>

## 依存

- `curl`
- `pdftotext`（poppler）— Git Bash では `/mingw64/bin/pdftotext`
