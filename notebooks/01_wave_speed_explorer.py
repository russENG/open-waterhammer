# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "marimo",
#     "numpy",
#     "matplotlib",
# ]
# ///
"""波速エクスプローラ — 管種・管厚・管径が波速 a に与える影響を可視化する.

土地改良設計基準 設計「パイプライン」技術書（令和3年6月改訂）§8.2 式(8.2.4)
の波速算定式を、対話的に探索する学習用 notebook.

実装の本体: packages/core-py/open_waterhammer/formulas.py の calc_wave_speed()
"""

import marimo

__generated_with = "0.23.5"
app = marimo.App(width="medium")


@app.cell(hide_code=True)
def _():
    import marimo as mo

    mo.md(
        r"""
        # 波速エクスプローラ 〜 管種・管厚・管径と波速の関係

        ## 背景
        水撃圧の大きさは **波速 \( a \)** と **流速変化 \( \Delta V \)** の積に比例する（Joukowsky の式）。
        波速は管路の弾性に依存するため、**管種・管厚・管径**で大きく変わる。

        本ノートブックでは技術書 §8.2 式(8.2.4) を素直に実装し、設計実務で
        遭遇するパラメータ範囲で波速がどう動くかを観察する。

        ## 基礎式

        $$
        a = \frac{1}{\sqrt{\dfrac{w_0}{g}\left(\dfrac{1}{K} + \dfrac{D \cdot C_1}{E_s \cdot t}\right)}}
        $$

        | 記号 | 説明 | 単位 |
        |---|---|---|
        | \( a \) | 波速 | m/s |
        | \( w_0 \) | 水の単位体積重量 = 9.8 | kN/m³ |
        | \( g \) | 重力加速度 = 9.8 | m/s² |
        | \( K \) | 水の体積弾性係数 = 2.03×10⁶ | kN/m² |
        | \( D \) | 管内径 | m |
        | \( t \) | 管厚 | m |
        | \( E_s \) | 管材ヤング係数（短期） | kN/m² |
        | \( C_1 \) | 埋設状況係数（既定 1.0） | — |
        """
    )
    return (mo,)


@app.cell
def _():
    import math

    # 物理定数 — 技術書 §8.2 既定値
    GRAVITY = 9.8  # m/s²
    BULK_MODULUS_WATER = 2.03e6  # kN/m²
    WATER_UNIT_WEIGHT = 9.8  # kN/m³

    # 管種別 ヤング係数 Es [kN/m²]（短期）
    # packages/core-py/open_waterhammer/pipe_materials.py と整合
    PIPE_MATERIALS = {
        "steel": ("鋼管", 206e6),
        "ductile_iron": ("ダクタイル鋳鉄管", 157e6),
        "rcp": ("遠心力鉄筋コンクリート管", 35e6),
        "cpcp": ("コア式PCCP管", 39e6),
        "upvc": ("硬質塩ビ管", 2.94e6),
        "pe2": ("PE管(2種)", 8.8e5),
        "pe3_pe100": ("PE管(3種 PE100)", 1.27e6),
        "wdpe": ("水道配水用PE管", 7.85e5),
    }

    def wave_speed(D_m: float, t_m: float, Es_kN_m2: float, c1: float = 1.0) -> float:
        """技術書 式(8.2.4) — 波速 a [m/s]."""
        term = (WATER_UNIT_WEIGHT / GRAVITY) * (
            1 / BULK_MODULUS_WATER + (D_m * c1) / (Es_kN_m2 * t_m)
        )
        return 1 / math.sqrt(term)

    return PIPE_MATERIALS, wave_speed


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        """
        ## インタラクティブ探索

        スライダーで管径・管厚を変えると、全管種の波速が更新される。
        """
    )
    return


@app.cell
def _(mo):
    D_slider = mo.ui.slider(start=50, stop=1500, step=50, value=300, label="管内径 D [mm]")
    t_slider = mo.ui.slider(start=2, stop=30, step=1, value=7, label="管厚 t [mm]")
    c1_slider = mo.ui.slider(start=0.5, stop=1.5, step=0.05, value=1.0, label="埋設状況係数 C₁")
    mo.vstack([D_slider, t_slider, c1_slider])
    return D_slider, c1_slider, t_slider


@app.cell
def _(D_slider, PIPE_MATERIALS, c1_slider, mo, t_slider, wave_speed):
    D = D_slider.value / 1000.0  # mm → m
    t = t_slider.value / 1000.0
    c1 = c1_slider.value

    rows = []
    for code, (label, Es) in PIPE_MATERIALS.items():
        a = wave_speed(D, t, Es, c1)
        T0 = 4 * 1000.0 / a  # L=1000m の振動周期 (参考)
        rows.append({"管種": label, "Es [kN/m²]": f"{Es:.2e}", "波速 a [m/s]": f"{a:.0f}", "T₀ (L=1000m) [s]": f"{T0:.3f}"})

    mo.md(f"### 結果（D={D_slider.value} mm, t={t_slider.value} mm, C₁={c1}）")
    return D, c1, rows, t


@app.cell
def _(mo, rows):
    import pandas as pd
    df = pd.DataFrame(rows)
    mo.ui.table(df, selection=None)
    return (df,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        r"""
        ## 観察ポイント

        - **鋼管・ダクタイル鋳鉄管**: 高弾性 → 波速 1000〜1300 m/s 程度
        - **塩ビ管・PE管**: 低弾性 → 波速 200〜500 m/s 程度
        - **同じ流速変化でも、ダクタイル鋳鉄管は塩ビ管の3〜5倍の水撃圧が発生**しうる

        管厚を増やすと波速は上昇するが効果は限定的。管径の影響が大きい。

        ## 管径スイープ（t/D 比一定）
        """
    )
    return


@app.cell
def _(PIPE_MATERIALS, c1, t, wave_speed):
    import numpy as np
    import matplotlib.pyplot as plt

    D_range = np.linspace(0.05, 1.5, 80)

    fig, ax = plt.subplots(figsize=(8, 5))
    for code, (label, Es) in PIPE_MATERIALS.items():
        a_values = [wave_speed(d, t, Es, c1) for d in D_range]
        ax.plot(D_range * 1000, a_values, label=label, linewidth=1.5)

    ax.set_xlabel("管内径 D [mm]")
    ax.set_ylabel("波速 a [m/s]")
    ax.set_title(f"管径と波速の関係（管厚 t = {t * 1000:.0f} mm 固定）")
    ax.legend(fontsize=8, loc="best")
    ax.grid(True, linestyle="--", linewidth=0.4, alpha=0.6)
    ax.set_xlim(0, 1500)

    fig.tight_layout()
    fig
    return ax, fig


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        r"""
        ## 補足: 実装ソース

        本ノートブックの波速関数は教育用に簡略化した版。実装の単一の真理源は
        Python core 側にある:

        - [`packages/core-py/open_waterhammer/formulas.py`](https://github.com/russENG/open-waterhammer/blob/master/packages/core-py/open_waterhammer/formulas.py#L38) — `calc_wave_speed()`
        - [`packages/core-py/open_waterhammer/pipe_materials.py`](https://github.com/russENG/open-waterhammer/blob/master/packages/core-py/open_waterhammer/pipe_materials.py) — 管種別ヤング係数

        ## ライセンス
        AGPL-3.0-or-later. 改変・再配布は自由。出典として
        「open-waterhammer プロジェクト」と土地改良基準を併記してください。
        """
    )
    return


if __name__ == "__main__":
    app.run()
