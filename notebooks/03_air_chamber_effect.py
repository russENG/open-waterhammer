# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "marimo",
#     "numpy",
#     "matplotlib",
# ]
# ///
"""エアチャンバ（圧力タンク）の防護効果 — MOC ベースの簡易デモ.

土地改良設計基準 設計「パイプライン」技術書（令和3年6月改訂）
§8.4 特性曲線法（MOC）を用いて、ポンプ急停止時の水撃圧をエアチャンバ
ありなしで比較する.

実装の本体: packages/core-py/open_waterhammer/moc.py
"""

import marimo

__generated_with = "0.23.5"
app = marimo.App(width="medium")


@app.cell(hide_code=True)
def _():
    import marimo as mo

    mo.md(
        r"""
        # エアチャンバの防護効果 〜 MOC で見る圧力包絡線

        ## 背景

        ポンプ急停止時、流れの逆向き加速が逆止弁で止められる際に
        大きな圧力低下→反射→上昇 が起きる。**エアチャンバ（圧力タンク）**
        を上流に設置すると、圧縮空気が緩衝材として作用し、圧力変動が抑制される。

        本ノートブックでは、特性曲線法 (MOC) で単管路ポンプ系を解析し、
        エアチャンバの有無で圧力包絡線（Hmax/Hmin）がどう変わるかを比較する。

        ## 対象系

        ```
          [ポンプ] → 管路 (L=1000m, φ300mm, ductile_iron) → [貯水槽 H=60m]
        ```

        ポンプを `t=0` で急停止（逆止弁閉鎖）。エアチャンバを設置する場合は
        ポンプ吐出側に併設。

        ## MOC（特性曲線法）の要点

        - 管路を N 個の reach に分割し、CFL 条件 \(\Delta x = a \Delta t\) で時間進行
        - 内部点は C⁺/C⁻ 不変量の連立で更新
        - 境界条件（ポンプ・エアチャンバ・貯水槽）は各 BC モデルで C⁺/C⁻ と接続

        実装の単一の真理源:
        [packages/core-py/open_waterhammer/moc.py](https://github.com/russENG/open-waterhammer/blob/master/packages/core-py/open_waterhammer/moc.py)
        """
    )
    return (mo,)


@app.cell
def _():
    import math

    GRAVITY = 9.8

    def wave_speed(D, t, Es, c1=1.0):
        WATER_W = 9.8
        K = 2.03e6
        term = (WATER_W / GRAVITY) * (1 / K + (D * c1) / (Es * t))
        return 1 / math.sqrt(term)

    return GRAVITY, math, wave_speed


@app.cell
def _(GRAVITY, math, wave_speed):
    import numpy as np

    # ── 系のパラメータ ──
    PIPE_L = 1000.0   # m
    PIPE_D = 0.300    # m
    PIPE_T = 0.007    # m
    Es_DUCTILE = 157e6  # kN/m² (ダクタイル鋳鉄管)
    Q0 = 0.0707  # m³/s (V0 ≈ 1.0 m/s)
    H_PUMP = 50.0  # m (静水頭付近のポンプ揚程)
    H_RESERVOIR = 60.0  # m (下流貯水槽の固定水頭)

    A_PIPE = math.pi * PIPE_D * PIPE_D / 4
    V0 = Q0 / A_PIPE
    a = wave_speed(PIPE_D, PIPE_T, Es_DUCTILE)

    # ── MOC グリッド設定 ──
    N = 20  # 分割数
    dx = PIPE_L / N
    dt = dx / a  # CFL 条件 dx = a·dt
    T_MAX = 30.0
    NSTEPS = int(T_MAX / dt)

    # 摩擦項
    FRICTION_F = 0.02  # Darcy-Weisbach 摩擦係数
    R_PIPE = FRICTION_F * dx / (2 * GRAVITY * PIPE_D * A_PIPE * A_PIPE)

    def joukowsky_pred(a_val, dv):
        return a_val * dv / GRAVITY

    return (
        A_PIPE,
        Es_DUCTILE,
        FRICTION_F,
        H_PUMP,
        H_RESERVOIR,
        NSTEPS,
        N,
        PIPE_D,
        PIPE_L,
        PIPE_T,
        Q0,
        R_PIPE,
        T_MAX,
        V0,
        a,
        dt,
        dx,
        joukowsky_pred,
        np,
    )


@app.cell(hide_code=True)
def _(A_PIPE, PIPE_L, Q0, V0, a, joukowsky_pred, mo):
    mo.md(
        f"""
        ### 系の派生量

        | 量 | 値 |
        |---|---|
        | 断面積 A | {A_PIPE:.5f} m² |
        | 初期流速 V₀ | {V0:.3f} m/s |
        | 波速 a (ダクタイル鋳鉄管) | {a:.1f} m/s |
        | 2L/a | {2 * PIPE_L / a:.3f} s |
        | Joukowsky ΔH = aV₀/g（参考上限） | {joukowsky_pred(a, V0):.1f} m |
        | 初期流量 Q₀ | {Q0} m³/s |
        """
    )
    return


@app.cell
def _(
    A_PIPE,
    GRAVITY,
    H_PUMP,
    H_RESERVOIR,
    NSTEPS,
    N,
    Q0,
    R_PIPE,
    a,
    dt,
    np,
):
    """MOC ソルバ — 防護工なし版.

    - 上流境界: ポンプ急停止（t=0 で逆止弁 → 流量0、ただし下流側からの反射波を受ける）
    - 下流境界: 貯水槽（固定水頭 H_RESERVOIR）
    """

    def run_moc_no_protection():
        H = np.zeros((NSTEPS + 1, N + 1))
        Q = np.zeros((NSTEPS + 1, N + 1))

        # 初期条件: 定常流（簡略化のため水頭は線形）
        for i in range(N + 1):
            H[0, i] = H_PUMP + (H_RESERVOIR - H_PUMP) * i / N
            Q[0, i] = Q0

        for k in range(NSTEPS):
            # 内部点 (i=1..N-1)
            for i in range(1, N):
                CP = H[k, i - 1] + a / (GRAVITY * A_PIPE) * Q[k, i - 1] - R_PIPE * Q[k, i - 1] * abs(Q[k, i - 1])
                CM = H[k, i + 1] - a / (GRAVITY * A_PIPE) * Q[k, i + 1] + R_PIPE * Q[k, i + 1] * abs(Q[k, i + 1])
                H[k + 1, i] = 0.5 * (CP + CM)
                Q[k + 1, i] = (GRAVITY * A_PIPE / a) * (CP - H[k + 1, i])

            # 上流境界: ポンプ急停止 → Q=0
            CM_up = H[k, 1] - a / (GRAVITY * A_PIPE) * Q[k, 1] + R_PIPE * Q[k, 1] * abs(Q[k, 1])
            Q[k + 1, 0] = 0.0
            H[k + 1, 0] = max(CM_up + a / (GRAVITY * A_PIPE) * Q[k + 1, 0], 0)

            # 下流境界: 貯水槽 H=H_RESERVOIR
            CP_down = H[k, N - 1] + a / (GRAVITY * A_PIPE) * Q[k, N - 1] - R_PIPE * Q[k, N - 1] * abs(Q[k, N - 1])
            H[k + 1, N] = H_RESERVOIR
            Q[k + 1, N] = (GRAVITY * A_PIPE / a) * (CP_down - H[k + 1, N])

        return H, Q

    H_no, Q_no = run_moc_no_protection()
    return H_no, Q_no, run_moc_no_protection


@app.cell
def _(
    A_PIPE,
    GRAVITY,
    H_PUMP,
    H_RESERVOIR,
    NSTEPS,
    N,
    Q0,
    R_PIPE,
    a,
    dt,
    np,
):
    """MOC ソルバ — エアチャンバあり版.

    上流境界をエアチャンバに置換。空気はポリトロープ過程
    p·V^m = const で圧縮/膨張。
    """

    def run_moc_with_air_chamber(V_air0=0.5, H_air0=50.0, m_poly=1.2):
        """エアチャンバ初期: 空気容積 V_air0 [m³], 水面水頭 H_air0 [m]."""
        H = np.zeros((NSTEPS + 1, N + 1))
        Q = np.zeros((NSTEPS + 1, N + 1))

        for i in range(N + 1):
            H[0, i] = H_PUMP + (H_RESERVOIR - H_PUMP) * i / N
            Q[0, i] = Q0

        # 空気量と水頭の状態量
        V_air = V_air0
        # 絶対圧 = 大気圧(10.33m) + 水頭
        p_atm = 10.33
        p_air0 = p_atm + H_air0  # m (水頭換算絶対圧)
        K_const = p_air0 * (V_air0 ** m_poly)  # ポリトロープ定数

        for k in range(NSTEPS):
            # 内部点
            for i in range(1, N):
                CP = H[k, i - 1] + a / (GRAVITY * A_PIPE) * Q[k, i - 1] - R_PIPE * Q[k, i - 1] * abs(Q[k, i - 1])
                CM = H[k, i + 1] - a / (GRAVITY * A_PIPE) * Q[k, i + 1] + R_PIPE * Q[k, i + 1] * abs(Q[k, i + 1])
                H[k + 1, i] = 0.5 * (CP + CM)
                Q[k + 1, i] = (GRAVITY * A_PIPE / a) * (CP - H[k + 1, i])

            # 上流境界: エアチャンバ（ポンプ急停止後、空気が圧縮/膨張で吸収）
            # Q_into_chamber = -Q[0] （管路から空気側への流入を正方向）
            CM_up = H[k, 1] - a / (GRAVITY * A_PIPE) * Q[k, 1] + R_PIPE * Q[k, 1] * abs(Q[k, 1])

            # 空気状態の更新: 簡略化された陰解法（実装の本体は moc.py の AirChamber BC を参照）
            # H_air^(k+1) - p_atm = K_const / V_air^(k+1)^m
            # V_air^(k+1) = V_air - Q_into·dt （Q_into = -Q[0]）
            # Q[0]^(k+1) を C⁻ から決定: H_air = CM_up + a/gA·Q[0]
            # 反復解法:
            V_air_new = V_air
            for _ in range(8):
                p_air = K_const / (V_air_new ** m_poly)
                H_air = p_air - p_atm
                Q_up = (GRAVITY * A_PIPE / a) * (H_air - CM_up)
                V_air_new = V_air + Q_up * dt  # Q が正なら管路から空気を押す → V_air 減少
                V_air_new = max(V_air_new, 0.05)  # クランプ

            Q[k + 1, 0] = Q_up
            H[k + 1, 0] = max(H_air, 0)
            V_air = V_air_new

            # 下流境界: 貯水槽
            CP_down = H[k, N - 1] + a / (GRAVITY * A_PIPE) * Q[k, N - 1] - R_PIPE * Q[k, N - 1] * abs(Q[k, N - 1])
            H[k + 1, N] = H_RESERVOIR
            Q[k + 1, N] = (GRAVITY * A_PIPE / a) * (CP_down - H[k + 1, N])

        return H, Q

    H_with, Q_with = run_moc_with_air_chamber()
    return H_with, Q_with, run_moc_with_air_chamber


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        r"""
        ## 圧力包絡線の比較

        最大・最小水頭を全時刻で取って管路位置に対してプロット。
        """
    )
    return


@app.cell
def _(H_no, H_with, N, PIPE_L, np):
    import matplotlib.pyplot as plt

    x = np.linspace(0, PIPE_L, N + 1)
    Hmax_no = H_no.max(axis=0)
    Hmin_no = H_no.min(axis=0)
    Hmax_w = H_with.max(axis=0)
    Hmin_w = H_with.min(axis=0)

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.fill_between(x, Hmin_no, Hmax_no, color="#dc3545", alpha=0.18, label="防護なし 範囲")
    ax.plot(x, Hmax_no, "r-", linewidth=1.6, label="防護なし Hmax")
    ax.plot(x, Hmin_no, "r--", linewidth=1.4, label="防護なし Hmin")

    ax.fill_between(x, Hmin_w, Hmax_w, color="#1976d2", alpha=0.18, label="エアチャンバあり 範囲")
    ax.plot(x, Hmax_w, "b-", linewidth=1.8, label="エアチャンバあり Hmax")
    ax.plot(x, Hmin_w, "b--", linewidth=1.6, label="エアチャンバあり Hmin")

    ax.set_xlabel("管路位置 x [m]")
    ax.set_ylabel("水頭 H [m]")
    ax.set_title("ポンプ急停止時の最大・最小水頭分布")
    ax.legend(loc="upper right", fontsize=8)
    ax.grid(True, linestyle="--", linewidth=0.4, alpha=0.6)
    ax.set_xlim(0, PIPE_L)

    fig.tight_layout()
    fig
    return (
        Hmax_no,
        Hmax_w,
        Hmin_no,
        Hmin_w,
        ax,
        fig,
        plt,
        x,
    )


@app.cell(hide_code=True)
def _(Hmax_no, Hmax_w, Hmin_no, Hmin_w, mo):
    mo.md(
        f"""
        ## 数値サマリ

        | 量 | 防護なし | エアチャンバあり |
        |---|---|---|
        | 最大水頭 (Hmax) | **{Hmax_no.max():.1f} m** | **{Hmax_w.max():.1f} m** |
        | 最小水頭 (Hmin) | **{Hmin_no.min():.1f} m** | **{Hmin_w.min():.1f} m** |
        | 圧力振幅 (Hmax-Hmin) | {Hmax_no.max() - Hmin_no.min():.1f} m | {Hmax_w.max() - Hmin_w.min():.1f} m |

        ## 観察ポイント

        - エアチャンバ設置で **Hmax/Hmin の幅が縮小**することが確認できる
        - 防護なしでは Hmin が 0 m にクランプされる区間が生じる（要旨「§4 適用と限界」で述べた**柱分離発生のシグナル**）
        - 設計実務では Hmin が大気圧水頭を下回らないよう、防護工を選定する

        ## 注意

        本ノートブックの MOC ソルバは**教育用簡略実装**。実プロジェクトでは
        Python core (`packages/core-py/open_waterhammer/moc.py`) の `run_moc()` を
        使うこと。完全な BC モデル（吸気弁・サージタンク・減圧バルブ・ポンプ4象限等）と
        管路網トポロジに対応している。

        ## 実装ソース

        - [`moc.py`](https://github.com/russENG/open-waterhammer/blob/master/packages/core-py/open_waterhammer/moc.py)
        - 各 BC モデル: `ReservoirBC`, `ValveBC`, `PumpBC`, `AirChamberBC`, `SurgeTankBC`, `AirReleaseValveBC`, `PressureReducingValveBC`, `DeadEndBC`

        ## ライセンス
        AGPL-3.0-or-later
        """
    )
    return


if __name__ == "__main__":
    app.run()
