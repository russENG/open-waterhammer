# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "marimo",
#     "numpy",
#     "matplotlib",
# ]
# ///
"""Joukowsky vs Allievi — 急閉そく/緩閉そくの境界と最大水撃圧の比較.

土地改良設計基準 設計「パイプライン」技術書（令和3年6月改訂）
§8.3.4 単管路の最大水撃圧評価式の挙動を、閉そく時間 tν をスライドして探索する.

実装の本体: packages/core-py/open_waterhammer/formulas.py
"""

import marimo

__generated_with = "0.23.5"
app = marimo.App(width="medium")


@app.cell(hide_code=True)
def _():
    import marimo as mo

    mo.md(
        r"""
        # Joukowsky vs Allievi 〜 急閉そく/緩閉そくの境界

        ## 背景

        単管路の最大水撃圧評価は**閉そく時間 \( t_\nu \) と圧力波往復時間 \( 2L/a \) の大小**で式が切り替わる:

        | 区分 | 条件 | 適用式 |
        |---|---|---|
        | 急閉そく | \( t_\nu \le 2L/a \) | **Joukowsky** \(\Delta H = a\,V_0/g\) |
        | 緩閉そく | \( t_\nu > 2L/a \) かつ \( t_\nu > L/300 \) | **Allievi** |
        | 数値解析要 | 上記以外（極短時間） | MOC等を別途使用 |

        ## Joukowsky の式（急閉そく）

        $$\Delta H = -\frac{a}{g}\,\Delta V = \frac{a\,V_0}{g}$$

        ## Allievi 近似式（緩閉そく）

        K₁ = (L·V₀)/(g·H₀·tν) と置くと

        $$\frac{H_{\max}}{H_0} = \frac{K_1}{2} + \sqrt{\frac{K_1^2}{4} + K_1}$$

        本ノートブックでは \( t_\nu \) を変化させた時の最大水撃圧水頭の遷移を観察する。
        """
    )
    return (mo,)


@app.cell
def _():
    import math

    GRAVITY = 9.8  # m/s²

    def joukowsky_delta_h(a: float, V0: float) -> float:
        """急閉そく時の圧力上昇水頭 [m]."""
        return a * V0 / GRAVITY

    def allievi_k1(L: float, V0: float, H0: float, t_nu: float) -> float:
        """アリエビ定数 K₁."""
        return (L * V0) / (GRAVITY * H0 * t_nu)

    def allievi_hmax(H0: float, k1: float) -> float:
        """緩閉そく時の最大水頭 Hmax [m] (技術書 式8.3.7)."""
        return H0 * (k1 / 2 + math.sqrt((k1 * k1) / 4 + k1))

    def vibration_period(L: float, a: float) -> float:
        return 4 * L / a

    return GRAVITY, allievi_hmax, allievi_k1, joukowsky_delta_h, vibration_period


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        r"""
        ## パラメータ設定
        """
    )
    return


@app.cell
def _(mo):
    L_slider = mo.ui.slider(start=100, stop=3000, step=100, value=1000, label="管路延長 L [m]")
    a_slider = mo.ui.slider(start=300, stop=1300, step=50, value=1100, label="波速 a [m/s]")
    V0_slider = mo.ui.slider(start=0.5, stop=3.0, step=0.1, value=1.0, label="初期流速 V₀ [m/s]")
    H0_slider = mo.ui.slider(start=10, stop=100, step=5, value=30, label="初期水頭 H₀ [m]")
    mo.vstack([L_slider, a_slider, V0_slider, H0_slider])
    return H0_slider, L_slider, V0_slider, a_slider


@app.cell
def _(
    H0_slider,
    L_slider,
    V0_slider,
    a_slider,
    allievi_hmax,
    allievi_k1,
    joukowsky_delta_h,
    mo,
    vibration_period,
):
    L = L_slider.value
    a = a_slider.value
    V0 = V0_slider.value
    H0 = H0_slider.value

    two_la = 2 * L / a  # 急閉そく上限
    T0 = vibration_period(L, a)
    dH_j = joukowsky_delta_h(a, V0)
    Hmax_j = H0 + dH_j  # Joukowsky による最大水頭

    mo.md(
        f"""
        ### 派生量

        | 量 | 値 |
        |---|---|
        | 2L/a（急閉そく上限） | **{two_la:.3f} s** |
        | T₀ = 4L/a（振動周期） | **{T0:.3f} s** |
        | Joukowsky ΔH = aV₀/g | **{dH_j:.2f} m** |
        | Hmax (急閉そく時) = H₀ + ΔH | **{Hmax_j:.2f} m** |
        """
    )
    return H0, Hmax_j, L, T0, V0, a, dH_j, two_la


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        r"""
        ## 閉そく時間スイープ
        \( t_\nu \) を 0.1 s から 60 s まで動かして最大水頭の変化を見る。
        """
    )
    return


@app.cell
def _(H0, Hmax_j, L, V0, a, allievi_hmax, allievi_k1, two_la):
    import numpy as np
    import matplotlib.pyplot as plt

    t_nu_range = np.linspace(0.05, 60.0, 600)

    H_results = []
    region_labels = []
    for t in t_nu_range:
        if t <= two_la:
            # 急閉そく: Joukowsky
            H_results.append(Hmax_j)
            region_labels.append("rapid")
        elif t > L / 300:
            # 緩閉そく: Allievi
            k1 = allievi_k1(L, V0, H0, t)
            H_results.append(allievi_hmax(H0, k1))
            region_labels.append("slow")
        else:
            H_results.append(np.nan)
            region_labels.append("numerical")

    fig, ax = plt.subplots(figsize=(8, 5))

    # 急閉そく区間
    mask_rapid = [r == "rapid" for r in region_labels]
    ax.plot(t_nu_range[mask_rapid], np.array(H_results)[mask_rapid], "r-", linewidth=2, label="急閉そく (Joukowsky)")

    # 緩閉そく区間
    mask_slow = [r == "slow" for r in region_labels]
    ax.plot(t_nu_range[mask_slow], np.array(H_results)[mask_slow], "b-", linewidth=2, label="緩閉そく (Allievi)")

    # 境界線
    ax.axvline(x=two_la, color="gray", linestyle="--", linewidth=1, alpha=0.6)
    ax.text(two_la, Hmax_j * 0.6, f" 2L/a = {two_la:.2f} s", fontsize=9, color="gray")

    # 静水頭
    ax.axhline(y=H0, color="black", linestyle=":", linewidth=1, alpha=0.5)
    ax.text(60 * 0.7, H0 + 2, f"H₀ = {H0} m (静水頭)", fontsize=9, color="black")

    ax.set_xlabel("閉そく時間 t_ν [s]")
    ax.set_ylabel("最大水頭 H_max [m]")
    ax.set_title("単管路の最大水撃圧 — 閉そく時間との関係")
    ax.set_xscale("log")
    ax.legend(loc="upper right", fontsize=9)
    ax.grid(True, which="both", linestyle="--", linewidth=0.4, alpha=0.6)

    fig.tight_layout()
    fig
    return ax, fig, t_nu_range


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        r"""
        ## 観察ポイント

        1. **急閉そく領域 (\( t_\nu \le 2L/a \))**: 最大水頭は閉そく時間に依存せず一定（Joukowsky の特徴）
        2. **緩閉そく領域 (\( t_\nu > 2L/a \))**: 閉そく時間を長くするほど最大水頭は低下
        3. **境界 \( t_\nu = 2L/a \)** で両式は連続に接続することが理論的に保証されている

        ## 設計実務での含意

        - 急閉そく圧が許容圧を超える場合、**バルブの閉そく時間を 2L/a より十分長くする**ことが第一の対策
        - 緩閉そくでも K₁ が大きい（長い管路・速い流速・低い静水頭）と Allievi も大きい値を出す
        - 緩閉そくの限界（\( t_\nu \le L/300 \)）に達するような極短閉そくは Joukowsky / Allievi で評価できず、**MOC（特性曲線法）で数値解析が必要**

        ## 実装ソース

        - [`joukowsky()`](https://github.com/russENG/open-waterhammer/blob/master/packages/core-py/open_waterhammer/formulas.py#L109)
        - [`allievi_close()`](https://github.com/russENG/open-waterhammer/blob/master/packages/core-py/open_waterhammer/formulas.py#L143)
        - [`determine_closure_type()`](https://github.com/russENG/open-waterhammer/blob/master/packages/core-py/open_waterhammer/formulas.py#L70)

        ## ライセンス
        AGPL-3.0-or-later
        """
    )
    return


if __name__ == "__main__":
    app.run()
