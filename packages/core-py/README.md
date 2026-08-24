# open_waterhammer (Python)

農業用パイプライン水撃圧計算の **計算コア** — Python 実装。

本パッケージは、本プロジェクトの計算ロジックの **単一の真理源** である。
ブラウザアプリは [Pyodide](https://pyodide.org/) 経由で同じ `.py` を実行し、
学習・検算用の Marimo ノートブックも同じパッケージを import する。

## セットアップ

```bash
cd packages/core-py
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -e ".[dev]"
pytest
```

## 設計原則

- 土地改良設計基準 設計「パイプライン」技術書（令和3年6月改訂）に準拠
- 各関数のドキュメントに条文番号を明記
- 標準ライブラリ + numpy のみ依存（Pyodide 互換性のため）
- 重力加速度は技術書に従い `g = 9.8 m/s²` を採用（9.81 ではない）

## ライセンス

GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
