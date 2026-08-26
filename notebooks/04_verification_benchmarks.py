# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "marimo",
#     "numpy",
#     "matplotlib",
# ]
# ///
"""検証ベンチマーク — 定常計算・非定常計算が解析解と一致することを確かめる.

土地改良設計基準 設計「パイプライン」技術書（令和3年6月改訂）第7章（定常流）・
第8章（非定常的な水理現象の解析）に基づく実装が、独立に導出できる解析解と
数値的に一致することを確認する（V&V: Verification & Validation）。

対応する自動テスト:
    packages/core/src/__tests__/verification-benchmarks.test.ts   （TypeScript コア）
    packages/core-py/tests/test_verification_benchmarks.py        （Python コア）
    packages/epanet-adapter/src/__tests__/steady-verification.test.ts（EPANET）

実装の本体:
    packages/core-py/open_waterhammer/steady_network.py（定常）
    packages/core-py/open_waterhammer/moc.py           （非定常）
このノートブックは WASM 上で単独実行できるよう、上記と同じ式を最小構成で
再実装している（境界条件はバルブ・貯水槽のみ）。
"""

import marimo

__generated_with = "0.23.5"
app = marimo.App(width="medium")


@app.cell(hide_code=True)
def _():
    import marimo as mo

    mo.md(
        r"""
        # 検証ベンチマーク 〜 実装は解析解と一致するか

        ## なぜ必要か

        「計算が落ちない」「閉そく時間を延ばすと圧力が下がる」といった挙動テストは、
        **式を間違えていても通ってしまう**。設計判断に使う数値である以上、
        独立に導出できる**解析解**と突き合わせて初めて実装の正しさが言える。

        本ノートブックでは 3 層で検証する。

        | 層 | 対象 | 参照解 |
        |---|---|---|
        | ① 閉形式 | 定常流の摩擦損失 | ヘーゼン・ウィリアムス式の閉形式 \(h_f = 10.67\,L\,Q^{1.852}/(C^{1.852}D^{4.871})\) |
        | ② 解析解 | 非定常（急閉そく） | ジューコフスキー \(\Delta H = a V_0/g\) |
        | ② 解析解 | 非定常（緩閉そく） | **アリエビ連鎖式**（摩擦なし単管路の厳密解） |
        | ③ 相互検証 | 定常網 | EPANET (epanet-js) ↔ 自前実装 |

        さらに、**解析解と一致しない領域**（＝実装の適用限界）も明示する。
        これは「どこまで信用してよいか」を設計者が判断するために必要な情報である。
        """
    )
    return (mo,)


@app.cell
def _():
    import math

    import numpy as np

    GRAVITY = 9.8  # 実装（core / core-py）と同じ重力加速度

    # ── ① 参照解: ヘーゼン・ウィリアムス式の閉形式（SI・EPANET 内部係数形）──────
    def hw_closed_form(L, Q, C, D):
        """hf = 10.67 · L · Q^1.852 / (C^1.852 · D^4.871)  [m]"""
        return 10.67 * L * Q**1.852 / (C**1.852 * D**4.871)

    # ── 実装側: V = 0.849·C·R^0.63·I^0.54 を I について解く形 ─────────────────
    def hw_implementation(L, Q, C, D):
        """steady_network.py / steady-network.ts と同じ式。"""
        A = math.pi * D * D / 4
        V = abs(Q) / A
        if V < 1e-12:
            return 0.0
        R = D / 4
        I = (V / (0.849 * C * R**0.63)) ** (1 / 0.54)
        return I * L

    return GRAVITY, hw_closed_form, hw_implementation, math, np


@app.cell(hide_code=True)
def _(hw_closed_form, hw_implementation, mo):
    _cases = [
        (0.30, 1000, 130, 0.10),
        (0.40, 500, 110, 0.20),
        (0.20, 2000, 150, 0.03),
        (0.60, 3000, 100, 0.50),
    ]
    _rows = []
    for _D, _L, _C, _Q in _cases:
        _impl = hw_implementation(_L, _Q, _C, _D)
        _ref = hw_closed_form(_L, _Q, _C, _D)
        _err = (_impl / _ref - 1) * 100
        _rows.append(
            f"| φ{_D * 1000:.0f} | {_L} | {_C} | {_Q} | {_impl:.4f} | {_ref:.4f} | {_err:+.3f}% |"
        )

    mo.md(
        """
        ## ① 定常計算 — ヘーゼン・ウィリアムス式

        技術書 式(7.2.2) は流速式 \\(V = 0.849\\,C\\,R^{0.63}\\,I^{0.54}\\) の形で与えられる。
        実装はこれを動水勾配 \\(I\\) について解いて \\(h_f = I\\,L\\) としている。
        一方 EPANET が内部で使うのは指数 1.852 / 4.871 の閉形式である。
        両者は \\(1/0.54 = 1.85185\\ldots\\) と \\(1.852\\) の丸めだけ異なる。

        | 管径 [mm] | L [m] | C | Q [m³/s] | 実装 h_f [m] | 閉形式 h_f [m] | 差 |
        |---|---|---|---|---|---|---|
        """
        + "\n".join(_rows)
        + """

        **結論**: 差は全ケースで 0.1% 未満。指数の丸めだけが原因で、式の取り違えはない。
        局部損失 \\(\\Sigma f\\cdot v^2/2g\\)・エネルギー収支・樹枝状網の連続条件も
        自動テスト側（S2〜S4）で厳密一致を確認している。
        """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        r"""
        ## ② 非定常計算 — MOC ソルバ（最小構成）

        以下は `packages/core-py/open_waterhammer/moc.py` の単一管路
        （上流=定水頭貯水槽／下流=バルブ）部分を、そのままの式で書き下したもの。
        WASM 上で動かすために必要最小限に絞っているが、**摩擦の扱いと境界条件は
        実装と同一**にしてある（自動テストで数値一致を確認している）。

        - 特性方程式: \(C^+: H_P = C_P - B Q_P\), \(C^-: H_P = C_M + B Q_P\)
        - 特性インピーダンス \(B = a/(gA)\)
        - 摩擦は各格子点の流速からヘーゼン・ウィリアムス → ダルシー等価に換算（局所可変）
        - \(\Delta t = \Delta x / a\)（CFL = 1）
        """
    )
    return


@app.cell
def _(GRAVITY, math):
    def local_darcy_f(V, D, C_hw):
        """H-W → D-W 等価摩擦係数（moc.py の _local_darcy_f と同一）。

        上限 0.15 は乱流域の妥当範囲。下限は設けない（issue #51）。
        """
        absV = abs(V)
        if absV < 1e-4:
            return 0.02
        Rh = D / 4
        S = (absV / (0.849 * C_hw * Rh**0.63)) ** (1 / 0.54)
        return min(2 * GRAVITY * D * S / (absV * absV), 0.15)

    def solve_valve(CP, B, tau, Q0, H0v):
        """バルブ BC: H_P = CP − B·τ_v·√H_P（moc.py の _solve_valve と同一）。

        全閉時・流出不能時は水頭を 0 m で打ち切らない（issue #50）。
        """
        if tau < 1e-10:
            return CP, 0.0
        if CP <= 0:
            return CP, 0.0
        H0safe = max(H0v, 0.01)
        tauV = tau * Q0 / math.sqrt(H0safe)
        disc = B * B * tauV * tauV + 4 * CP
        y = (-B * tauV + math.sqrt(disc)) / 2
        return y * y, tauV * y

    def run_moc(D, L, C_hw, a, V0, H0v, close_time, N=40, t_max=None, operation="close"):
        """貯水槽 → 単一管路 → バルブ の MOC。

        戻り値: (t 配列, バルブ端 H 時系列, Hmax 配列, Hmin 配列, H_steady 配列)
        """
        A = math.pi * D * D / 4
        Q0 = V0 * A
        B = a / (GRAVITY * A)
        dx = L / N
        dt = dx / a
        # 初期条件（moc.py と同じ: 全長の摩擦損失を線形配分）
        f0 = local_darcy_f(V0, D, C_hw)
        hf_total = f0 * L * V0 * V0 / (2 * GRAVITY * D)
        HR = H0v + hf_total
        H = [HR - hf_total * i / N for i in range(N + 1)]
        Q = [Q0] * (N + 1)
        H_steady = list(H)
        Hmax, Hmin = list(H), list(H)

        if t_max is None:
            t_max = 3 * 4 * L / a
        n_steps = math.ceil(t_max / dt)

        ts, hv = [0.0], [H[N]]
        Rk = dx / (2 * GRAVITY * D * A * A)

        for step in range(1, n_steps + 1):
            t = step * dt
            Hn, Qn = [0.0] * (N + 1), [0.0] * (N + 1)
            # 内部格子点
            for i in range(1, N):
                Qa, Qb = Q[i - 1], Q[i + 1]
                Ra = local_darcy_f(Qa / A, D, C_hw) * Rk
                Rb = local_darcy_f(Qb / A, D, C_hw) * Rk
                CP = H[i - 1] + B * Qa - Ra * Qa * abs(Qa)
                CM = H[i + 1] - B * Qb + Rb * Qb * abs(Qb)
                Hn[i] = (CP + CM) / 2
                Qn[i] = (CP - CM) / (2 * B)
            # 上流端: 定水頭貯水槽
            R_up = local_darcy_f(Q[1] / A, D, C_hw) * Rk
            CM0 = H[1] - B * Q[1] + R_up * Q[1] * abs(Q[1])
            Hn[0] = HR
            Qn[0] = (HR - CM0) / B
            # 下流端: バルブ（線形開度）
            R_dn = local_darcy_f(Q[N - 1] / A, D, C_hw) * Rk
            CPN = H[N - 1] + B * Q[N - 1] - R_dn * Q[N - 1] * abs(Q[N - 1])
            if operation == "close":
                tau = 0.0 if close_time <= 0 else max(0.0, 1 - t / close_time)
            else:
                tau = 1.0 if close_time <= 0 else min(1.0, t / close_time)
            Hn[N], Qn[N] = solve_valve(CPN, B, tau, Q0, H0v)

            H, Q = Hn, Qn
            for i in range(N + 1):
                Hmax[i] = max(Hmax[i], H[i])
                Hmin[i] = min(Hmin[i], H[i])
            ts.append(t)
            hv.append(H[N])

        return ts, hv, Hmax, Hmin, H_steady

    def allievi_chain(rho, taus):
        """アリエビ連鎖式 — 摩擦なし単管路の厳密解.

        h_i + h_{i-1} = 2 + 2ρ(τ_{i-1}√h_{i-1} − τ_i√h_i),  h = H/H₀
        x = √h_i と置くと x² + 2ρτ_i·x − K = 0。
        t_i = i·(2L/a) におけるバルブ端水頭比を返す。
        """
        h = [1.0]
        for i in range(1, len(taus)):
            hp = h[i - 1]
            K = 2 + 2 * rho * (taus[i - 1] * math.sqrt(hp)) - hp
            b = 2 * rho * taus[i]
            x = (-b + math.sqrt(b * b + 4 * max(K, 0.0))) / 2
            h.append(x * x)
        return h

    return allievi_chain, local_darcy_f, run_moc, solve_valve


@app.cell
def _():
    # ── 検証用の基準系 ────────────────────────────────────────────────────────
    BENCH = dict(D=0.5, L=1200.0, a=1000.0, V0=1.0, H0=100.0)
    C_SMOOTH = 1e6  # 摩擦をほぼ無視する粗度係数（解析解と比較する場合）
    C_REAL = 130.0  # 実務的な粗度係数
    T_ROUND = 2 * BENCH["L"] / BENCH["a"]  # 圧力波往復時間 2L/a
    T_PERIOD = 2 * T_ROUND  # 振動周期 4L/a
    return BENCH, C_REAL, C_SMOOTH, T_PERIOD, T_ROUND


@app.cell(hide_code=True)
def _(BENCH, GRAVITY, T_PERIOD, T_ROUND, mo):
    mo.md(
        f"""
        ### 基準系

        | 量 | 値 |
        |---|---|
        | 管径 D | {BENCH["D"]} m |
        | 管路延長 L | {BENCH["L"]:.0f} m |
        | 波速 a | {BENCH["a"]:.0f} m/s |
        | 初期流速 V₀ | {BENCH["V0"]} m/s |
        | バルブ端初期水頭 H₀ | {BENCH["H0"]:.0f} m |
        | 圧力波往復時間 2L/a | {T_ROUND:.1f} s |
        | 振動周期 4L/a | {T_PERIOD:.1f} s |
        | ジューコフスキー ΔH = aV₀/g | {BENCH["a"] * BENCH["V0"] / GRAVITY:.2f} m |
        | 管路特性値 ρ = aV₀/(2gH₀) | {BENCH["a"] * BENCH["V0"] / (2 * GRAVITY * BENCH["H0"]):.4f} |
        """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        r"""
        ## ②-a 急閉そく — ジューコフスキーの式

        \(t_\nu \le 2L/a\) の急閉そくでは、閉そく直後のバルブ端水頭は

        $$\Delta H = \frac{a V_0}{g}$$

        だけ上昇し、\(2L/a\) ごとに符号を変える**矩形波**になる（摩擦なしの場合）。
        MOC がこの矩形波を正しく再現するかを見る。
        """
    )
    return


@app.cell(hide_code=True)
def _(BENCH, C_SMOOTH, GRAVITY, T_PERIOD, T_ROUND, np, run_moc):
    import matplotlib.pyplot as plt

    _ts, _hv, _hmax, _hmin, _hst = run_moc(
        BENCH["D"], BENCH["L"], C_SMOOTH, BENCH["a"], BENCH["V0"], BENCH["H0"],
        close_time=0, N=40, t_max=2.5 * T_PERIOD,
    )
    _dh = BENCH["a"] * BENCH["V0"] / GRAVITY
    _H0 = BENCH["H0"]

    fig1, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 3.8))

    ax1.plot(_ts, _hv, lw=1.6, label="MOC（バルブ端）")
    ax1.axhline(_H0 + _dh, ls="--", c="crimson", lw=1.1, label=f"H₀ + aV₀/g = {_H0 + _dh:.1f} m")
    ax1.axhline(_H0 - _dh, ls="--", c="steelblue", lw=1.1, label=f"H₀ − aV₀/g = {_H0 - _dh:.1f} m")
    ax1.axhline(_H0, ls=":", c="gray", lw=1.0)
    for _k in range(1, 6):
        ax1.axvline(_k * T_ROUND, ls=":", c="gray", lw=0.6)
    ax1.set_xlabel("時間 t [s]")
    ax1.set_ylabel("水頭 H [m]")
    ax1.set_title("瞬時閉そくの矩形波（点線は 2L/a ごと）")
    ax1.legend(fontsize=7.5, loc="center right")
    ax1.grid(alpha=0.25)

    _x = np.linspace(0, BENCH["L"], len(_hmax))
    ax2.plot(_x, _hmax, c="crimson", lw=1.6, label="Hmax（包絡線）")
    ax2.plot(_x, _hst, c="gray", lw=1.2, ls="--", label="定常水頭")
    ax2.plot(_x, _hmin, c="steelblue", lw=1.6, label="Hmin（包絡線）")
    ax2.axhline(0, c="k", lw=0.8)
    ax2.set_xlabel("上流端からの距離 [m]")
    ax2.set_ylabel("水頭 H [m]")
    ax2.set_title("圧力包絡線")
    ax2.legend(fontsize=7.5)
    ax2.grid(alpha=0.25)
    fig1.tight_layout()

    joukowsky_err = (_hmax[-1] - _H0) / _dh - 1
    fig1
    return ax1, ax2, fig1, joukowsky_err, plt


@app.cell(hide_code=True)
def _(joukowsky_err, mo):
    mo.md(
        f"""
        **結果**: バルブ端の最大水頭上昇はジューコフスキー値に対し
        **{joukowsky_err * 100:+.2f}%**。矩形波の周期 \\(4L/a\\)・位相も一致し、
        下降側も理論値 \\(H_0 - aV_0/g = -2.04\\) m を正確に再現する。

        ここが理論どおりになるのは issue #50・#51 の修正後である。以前は
        境界条件が水頭を 0 m で打ち切り（負圧が出ない）、摩擦係数にも下限 0.005 が
        あったため、下降側が過小評価され、上昇側にも 0.6% の系統誤差が残っていた。
        """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        r"""
        ## ②-b 緩閉そく — アリエビ連鎖式（厳密解）との比較

        \(t_\nu > 2L/a\) の緩閉そくには、摩擦なし単管路の**厳密解**が存在する
        （Allievi 1903 の interlocking equations）。\(h = H/H_0\), \(\rho = aV_0/(2gH_0)\) として

        $$h_i + h_{i-1} = 2 + 2\rho\left(\tau_{i-1}\sqrt{h_{i-1}} - \tau_i\sqrt{h_i}\right)$$

        が \(t_i = i\cdot(2L/a)\) の各時刻で成り立つ。これは**近似式ではなく厳密解**であり、
        MOC の検算に使える唯一の緩閉そく参照解である。

        下のスライダーで閉そく時間 \(t_\nu\) を \(2L/a\) の整数倍で変えて比較する。
        """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    n_tau = mo.ui.slider(
        start=2, stop=12, step=1, value=4,
        label="閉そく時間 tν ＝ (この値) × 2L/a",
        show_value=True,
    )
    n_tau
    return (n_tau,)


@app.cell(hide_code=True)
def _(BENCH, C_SMOOTH, GRAVITY, T_ROUND, allievi_chain, n_tau, plt, run_moc):
    _nT = n_tau.value
    _tc = _nT * T_ROUND
    _nsteps = _nT + 4
    _rho = BENCH["a"] * BENCH["V0"] / (2 * GRAVITY * BENCH["H0"])
    _taus = [max(0.0, 1 - i * T_ROUND / _tc) for i in range(_nsteps + 1)]
    _h_exact = allievi_chain(_rho, _taus)

    _ts, _hv, _hmax, _hmin, _ = run_moc(
        BENCH["D"], BENCH["L"], C_SMOOTH, BENCH["a"], BENCH["V0"], BENCH["H0"],
        close_time=_tc, N=60, t_max=_nsteps * T_ROUND,
    )
    _H0 = BENCH["H0"]

    def _at(t):
        _k = min(range(len(_ts)), key=lambda j: abs(_ts[j] - t))
        return _hv[_k] / _H0

    _t_exact = [i * T_ROUND for i in range(len(_h_exact))]
    _h_moc_at = [_at(t) for t in _t_exact]

    fig2, ax3 = plt.subplots(figsize=(9, 4))
    ax3.plot(_ts, [v / _H0 for v in _hv], lw=1.4, c="0.35", label="MOC（連続）")
    ax3.plot(_t_exact, _h_exact, "o--", ms=7, mfc="none", c="crimson", lw=1.2,
             label="アリエビ連鎖式（厳密解）")
    ax3.plot(_t_exact, _h_moc_at, "x", ms=8, c="seagreen", label="MOC（2L/a 時点）")
    ax3.axvline(_tc, ls=":", c="k", lw=1.0)
    ax3.text(_tc, ax3.get_ylim()[1], f" tν={_tc:.1f}s", va="top", fontsize=8)
    ax3.axhline(1.0, ls=":", c="gray", lw=0.9)
    ax3.set_xlabel("時間 t [s]")
    ax3.set_ylabel("水頭比 h = H / H₀")
    ax3.set_title(f"緩閉そく tν = {_nT}×(2L/a) = {_tc:.1f} s")
    ax3.legend(fontsize=8)
    ax3.grid(alpha=0.25)
    fig2.tight_layout()

    peak_exact = max(_h_exact)
    peak_moc = max(_hmax) / _H0
    peak_err = peak_moc / peak_exact - 1
    step_errs = [abs(_h_moc_at[i] / _h_exact[i] - 1) for i in range(1, len(_h_exact))]
    fig2
    return ax3, fig2, peak_err, peak_exact, peak_moc, step_errs


@app.cell(hide_code=True)
def _(mo, peak_err, peak_exact, peak_moc, step_errs):
    mo.md(
        f"""
        | 指標 | 値 |
        |---|---|
        | 最大水頭比 h_max（アリエビ連鎖式・厳密解） | {peak_exact:.4f} |
        | 最大水頭比 h_max（MOC） | {peak_moc:.4f} |
        | 相対誤差 | **{peak_err * 100:+.3f}%** |
        | 各 2L/a 時点での最大相対誤差 | {max(step_errs) * 100:.3f}% |

        **結論**: どの閉そく時間でも最大水頭比の誤差は 0.2% 未満、各時点で見ても 1% 未満。
        MOC の緩閉そく解は厳密解と一致する。残る誤差の主因は「摩擦係数の下限」（後述）で、
        完全な無摩擦を表現できないことによる。
        """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        r"""
        ## ②-c 格子収束性

        差分距離 \(\Delta x = L/N\) を細かくしたときに解が一点に収束するか。
        収束していなければ「たまたまその分割数で合っていた」だけになる。
        """
    )
    return


@app.cell(hide_code=True)
def _(BENCH, C_SMOOTH, GRAVITY, T_PERIOD, mo, run_moc):
    _dh_theory = BENCH["a"] * BENCH["V0"] / GRAVITY
    _rows = []
    for _N in (6, 12, 24, 48, 96):
        _, _, _hmax, _, _ = run_moc(
            BENCH["D"], BENCH["L"], C_SMOOTH, BENCH["a"], BENCH["V0"], BENCH["H0"],
            close_time=0, N=_N, t_max=2 * T_PERIOD,
        )
        _dh = _hmax[-1] - BENCH["H0"]
        _rows.append(
            f"| {_N} | {BENCH['L'] / _N:.0f} | {BENCH['L'] / (_N * BENCH['a']):.4f} | "
            f"{_dh:.3f} | {(_dh / _dh_theory - 1) * 100:+.3f}% |"
        )

    mo.md(
        """
        | 分割数 N | Δx [m] | Δt [s] | MOC ΔH [m] | ジューコフスキーとの差 |
        |---|---|---|---|---|
        """
        + "\n".join(_rows)
        + """

        **結論**: N を 16 倍（Δx = 200 m → 12.5 m）にしても ΔH の変化は 0.1% 未満で、
        解は収束している。理論値からの残差 +0.6% は、閉そく後も上流から流れ込む
        分の摩擦損失が減ってバルブ端水頭が押し上げられる **line packing** による
        もので、数値誤差ではない。

        なお実装は差分距離を 50〜200 m の実務目安でチェックし、200 m 超はエラー、
        50 m 未満は注意として返す（技術書 §8.4.2(2)）。上表の N=6 が Δx=200 m の
        上限、N=48 以上が注意側にあたる。
        """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        r"""
        ## ③ 適用限界 — どこまで信用してよいか

        検証で分かるのは「合っている範囲」だけではない。
        **どこから外れるか**こそ設計判断に必要な情報である。

        以前この節には「負圧が 0 m で打ち切られる」「摩擦係数に下限がある」という
        2 つの実装上の制約を挙げていたが、いずれも issue #50 / #51 で解消し、
        上の検証はすべて誤差 0.00% になった。残るのは**物理モデルそのものの限界**である。
        """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        r"""
        ### (1) 水柱分離（キャビテーション）は計算しない

        負圧そのものは理論どおり計算される（下図: 初期水頭 \(H_0\) を変えても
        下降幅 \(H_0 - H_{\min}\) は常に \(aV_0/g\) に一致する）。
        しかし**動水頭が水蒸気圧水頭を下回ったあと**、水柱が分離して
        再び衝突するまでの挙動は本ソルバーの対象外である。

        そのため実装は、動水頭が水蒸気圧水頭（既定 −10.33 m）を下回った位置と時刻を
        warning で通知し、それ以降の結果は参考値として扱うよう促す。
        判定は**動水頭**（水頭 − 管中心高）で行うので、標高差のある管路では
        管路区間に管中心高を与える必要がある。
        """
    )
    return


@app.cell(hide_code=True)
def _(BENCH, C_SMOOTH, GRAVITY, T_PERIOD, plt, run_moc):
    _dh_theory = BENCH["a"] * BENCH["V0"] / GRAVITY
    _h0s = [60, 80, 100, 120, 150, 200, 300]
    _drops = []
    for _H0 in _h0s:
        _, _, _, _hmin, _ = run_moc(
            BENCH["D"], BENCH["L"], C_SMOOTH, BENCH["a"], BENCH["V0"], _H0,
            close_time=0, N=40, t_max=T_PERIOD,
        )
        _drops.append(_H0 - _hmin[-1])

    fig3, ax4 = plt.subplots(figsize=(8, 3.8))
    ax4.plot(_h0s, _drops, "o-", c="steelblue", label="MOC の下降幅 H₀ − Hmin")
    ax4.axhline(_dh_theory, ls="--", c="crimson", label=f"理論 aV₀/g = {_dh_theory:.1f} m")
    ax4.axvline(_dh_theory, ls=":", c="gray", lw=1.0)
    ax4.text(_dh_theory, min(_drops), " H₀ = aV₀/g\n（これ以下では H が負になる）", fontsize=8, va="bottom")
    ax4.set_xlabel("バルブ端初期水頭 H₀ [m]")
    ax4.set_ylabel("下降幅 H₀ − Hmin [m]")
    ax4.set_title("下降側は初期水頭によらず理論値と一致する")
    ax4.legend(fontsize=8)
    ax4.grid(alpha=0.25)
    fig3.tight_layout()
    fig3
    return ax4, fig3


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        r"""
        **読み方**: 下降幅はどの初期水頭でも理論値 \(aV_0/g\) に一致する。
        つまり負圧の大きさそのものは信用してよい。信用できないのは
        **水蒸気圧水頭を下回ったあとの時間発展**である。
        その場合は技術書 §8.3 の防護工（エアチャンバ・吸気弁・サージタンク）の
        検討へ進むこと。防護工は管路の途中にも設置でき、効果を計算できる（issue #47）。
        """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        r"""
        ### (2) 摩擦による減衰

        摩擦は圧力振動を減衰させる。実装の摩擦係数は上限 0.15 のみを持ち、
        下限は設けていない（issue #51 で撤廃）ので、粗度係数 C を大きくすれば
        無摩擦条件を正しく表現できる。下図で C = 1e6 の振幅がほぼ減衰しないのは
        **数値散逸が無い**ことの確認でもある。
        """
    )
    return


@app.cell(hide_code=True)
def _(BENCH, C_REAL, C_SMOOTH, T_PERIOD, plt, run_moc):
    fig4, ax5 = plt.subplots(figsize=(9, 3.8))
    _cycles = 10
    for _C, _label, _color in ((C_SMOOTH, "C = 1e6（実質無摩擦）", "seagreen"),
                               (C_REAL, "C = 130（実務値）", "sienna")):
        _ts, _hv, _, _, _ = run_moc(
            BENCH["D"], BENCH["L"], _C, BENCH["a"], BENCH["V0"], BENCH["H0"],
            close_time=0, N=40, t_max=_cycles * T_PERIOD,
        )
        _amps = []
        for _c in range(_cycles):
            _win = [_hv[j] for j in range(len(_ts)) if _c * T_PERIOD <= _ts[j] < (_c + 1) * T_PERIOD]
            if len(_win) >= 4:
                _amps.append(max(_win) - min(_win))
        ax5.plot(range(1, len(_amps) + 1), [v / _amps[0] for v in _amps],
                 "o-", c=_color, label=f"{_label}（{_amps[-1] / _amps[0]:.3f} 残存）")
    ax5.set_xlabel("周期数（1 周期 = 4L/a）")
    ax5.set_ylabel("振幅比（初期周期 = 1）")
    ax5.set_title("摩擦による減衰")
    ax5.set_ylim(0, 1.05)
    ax5.legend(fontsize=8)
    ax5.grid(alpha=0.25)
    fig4.tight_layout()
    fig4
    return ax5, fig4


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        r"""
        振幅は**単調に減少**する（増幅しない＝数値的に安定）。
        C = 1e6 では 10 周期後もほぼ 100% 残り、数値散逸が無いことが確認できる。

        ### (3) 簡易式（技術書 式8.3.7）は MOC より大きく安全側に出る

        アリエビの**近似式** \(\Delta H/H_0 = K_1/2 + \sqrt{K_1^2/4 + K_1}\)
        （\(K_1 = LV_0/(gH_0 t_\nu)\)）は \(t_\nu = 2L/a\) の急閉そく境界では
        ジューコフスキー値とほぼ一致するが、\(t_\nu\) が長くなるほど厳密解より
        大きな値を返す。設計の一次スクリーニングとしては安全側だが、
        **MOC の結果が簡易式より小さいことは異常ではない**。
        """
    )
    return


@app.cell(hide_code=True)
def _(BENCH, C_SMOOTH, GRAVITY, T_ROUND, allievi_chain, mo, run_moc):
    _rho = BENCH["a"] * BENCH["V0"] / (2 * GRAVITY * BENCH["H0"])
    _H0, _L, _V0 = BENCH["H0"], BENCH["L"], BENCH["V0"]
    _rows = []
    for _nT in (1, 2, 4, 6, 10):
        _tc = _nT * T_ROUND
        _k1 = _L * _V0 / (GRAVITY * _H0 * _tc)
        _dh_simple = _H0 * (_k1 / 2 + (_k1 * _k1 / 4 + _k1) ** 0.5)
        if _nT == 1:
            _dh_exact = BENCH["a"] * _V0 / GRAVITY  # 急閉そく境界＝ジューコフスキー
            _label = "（ジューコフスキー）"
        else:
            _nsteps = _nT + 4
            _taus = [max(0.0, 1 - i * T_ROUND / _tc) for i in range(_nsteps + 1)]
            _dh_exact = (max(allievi_chain(_rho, _taus)) - 1) * _H0
            _label = "（アリエビ連鎖式）"
        _, _, _hmax, _, _ = run_moc(
            BENCH["D"], _L, C_SMOOTH, BENCH["a"], _V0, _H0,
            close_time=_tc, N=60, t_max=(_nT + 4) * T_ROUND,
        )
        _dh_moc = _hmax[-1] - _H0
        _rows.append(
            f"| {_nT}×(2L/a) = {_tc:.1f} | {_dh_moc:.2f} | {_dh_exact:.2f} {_label} | "
            f"{_dh_simple:.2f} | {_dh_simple / _dh_exact:.2f} 倍 |"
        )

    mo.md(
        """
        | 閉そく時間 tν [s] | MOC ΔH [m] | 厳密解 ΔH [m] | 簡易式 式(8.3.7) ΔH [m] | 簡易式／厳密解 |
        |---|---|---|---|---|
        """
        + "\n".join(_rows)
        + """

        **結論**: MOC は厳密解と一致し、簡易式は tν が長いほど保守的になる。
        両者を比べるときは「どちらが正しいか」ではなく
        「簡易式は安全側の envelope、MOC は実挙動」と読むのが正しい。
        """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        r"""
        ## まとめ

        | 検証項目 | 参照解 | 結果 |
        |---|---|---|
        | 定常 摩擦損失 | H-W 閉形式 | 誤差 < 0.1%（指数の丸めのみ） |
        | 定常 局部損失・エネルギー収支・連続条件 | 閉形式 | 丸め誤差以内で一致 |
        | 非定常 急閉そく | ジューコフスキー | **誤差 0.00%** |
        | 非定常 緩閉そく | アリエビ連鎖式（厳密解） | **誤差 0.00%** |
        | 非定常 下降側の負圧 | \(H_0 - aV_0/g\) | **誤差 0.00%** |
        | 非定常 波の周期・位相 | 4L/a | 一致 |
        | 非定常 格子収束性 | — | N を 16 倍で変化 0.00% |
        | 非定常 分岐点の連続条件 | ΣQ_in = ΣQ_out | 1e-12 以内 |
        | 非定常 断面変化点の透過係数 | 2B₁/(B₁+B₂) | 誤差 < 2% |
        | 非定常 防護工の節点連続条件 | ΣQ_in − ΣQ_out = Q_dev | 1e-9 以内 |

        ### 残る適用限界

        - **水柱分離**: 動水頭が水蒸気圧水頭を下回ったあとの挙動は計算しない。
          下回った位置・時刻は warning で通知する（判定には管中心高の指定が必要）
        - **ポンプの4象限特性**: H-Q 放物線＋相似則トルクの簡易モデル。
          逆流・逆転を含む長時間過渡は精度が劣化する
        - **定常網の自前実装**: 樹枝状・単一貯水槽が前提。
          ループ網・複数貯水槽は計算から除外される管路を warning で通知する
          → 該当する系では EPANET（`epanet-js`）経路を使うこと

        ### 対応する自動テスト

        - [`packages/core/src/__tests__/verification-benchmarks.test.ts`](https://github.com/russENG/open-waterhammer/blob/master/packages/core/src/__tests__/verification-benchmarks.test.ts)
        - [`packages/core-py/tests/test_verification_benchmarks.py`](https://github.com/russENG/open-waterhammer/blob/master/packages/core-py/tests/test_verification_benchmarks.py)
        - [`packages/epanet-adapter/src/__tests__/steady-verification.test.ts`](https://github.com/russENG/open-waterhammer/blob/master/packages/epanet-adapter/src/__tests__/steady-verification.test.ts)
        - [`packages/core/src/__tests__/protection-devices.test.ts`](https://github.com/russENG/open-waterhammer/blob/master/packages/core/src/__tests__/protection-devices.test.ts) — 防護工の設置位置
        - [`packages/core/src/__tests__/suggest-reaches.test.ts`](https://github.com/russENG/open-waterhammer/blob/master/packages/core/src/__tests__/suggest-reaches.test.ts) — 計算区間数の自動提案

        ### 実装の本体

        - [`steady_network.py`](https://github.com/russENG/open-waterhammer/blob/master/packages/core-py/open_waterhammer/steady_network.py) — 定常管路網
        - [`moc.py`](https://github.com/russENG/open-waterhammer/blob/master/packages/core-py/open_waterhammer/moc.py) — 特性曲線法
        - [`epanet-adapter/src/index.ts`](https://github.com/russENG/open-waterhammer/blob/master/packages/epanet-adapter/src/index.ts) — EPANET アダプタ
        """
    )
    return


if __name__ == "__main__":
    app.run()
