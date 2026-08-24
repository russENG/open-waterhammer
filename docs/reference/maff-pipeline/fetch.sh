#!/usr/bin/env bash
# 土地改良事業計画設計基準 設計「パイプライン」技術書（令和3年6月改訂）
# 章別PDFを MAFF 公式サイトからローカルキャッシュにダウンロードする。
#
# 出力: docs/reference/maff-pipeline/ch{N}.pdf, ch{N}.txt
#
# このディレクトリの PDF / テキストは .gitignore で除外されている（再配布回避）。
# 開発者は各自このスクリプトを実行してローカルに取得する。
#
# 依存: curl, pdftotext (poppler)。Git Bash (mingw64) では /mingw64/bin/pdftotext。

set -euo pipefail
cd "$(dirname "$0")"

BASE="https://www.maff.go.jp/j/nousin/pipeline/attach/pdf"

# 章番号 → MAFF ファイル番号
declare -A CHAPTERS=(
  [1]=24
  [3]=6
  [6]=8
  [7]=49
  [8]=58
  [9]=61
  [10]=16
  [13]=48
  [14]=68
)

PDFTOTEXT="${PDFTOTEXT:-pdftotext}"
if [ ! -x "$(command -v "$PDFTOTEXT" 2>/dev/null || true)" ] && [ -x /mingw64/bin/pdftotext ]; then
  PDFTOTEXT=/mingw64/bin/pdftotext
fi

for ch in "${!CHAPTERS[@]}"; do
  num="${CHAPTERS[$ch]}"
  url="${BASE}/pipeline-${num}.pdf"
  pdf="ch${ch}.pdf"
  txt="ch${ch}.txt"

  if [ ! -f "$pdf" ]; then
    echo "[fetch] ch${ch} <- ${url}"
    curl -fsSL -o "$pdf" "$url"
  else
    echo "[skip ] ch${ch} (cached)"
  fi

  if [ ! -f "$txt" ] || [ "$pdf" -nt "$txt" ]; then
    echo "[text ] ch${ch}"
    "$PDFTOTEXT" -layout -enc UTF-8 "$pdf" "$txt"
  fi
done

echo "Done. Files in $(pwd):"
ls -1 ch*.pdf ch*.txt 2>/dev/null
