"""特性曲線法（Method of Characteristics）汎用水撃圧非定常計算エンジン.

対応シナリオ:
    - バルブ急閉・緩閉・急開・緩開（線形等価操作時間）
    - ポンプ急停止（GD²慣性方程式 または 線形近似フォールバック）
    - ポンプ起動（線形速度上昇）
    - 複数管路直列・T字/Y字分岐
    - エアチャンバ（圧力タンク・ポリトロープ気体則）
    - サージタンク（調圧水槽・水位ODE）
    - 吸気弁（負圧開放弁）
    - 減圧バルブ（設定圧維持）

摩擦モデル: ハーゼン・ウィリアムス式 → Darcy-Weisbach 等価、
    局所可変（各ノード・各ステップ）.
時間積分: 陽的差分（クーラン条件 CFL=1: Δt = Δx/a）.
    技術書 式(8.4.8) は Δt ≤ Δx/(V+a) であり、V<<a（通常 V/a≦0.001）の
    仮定下で常に安全側。run_moc は V を含めた厳密チェックも warning で報告。

出典: 土地改良設計基準パイプライン技術書 §8.4（特性曲線法）
        Wylie & Streeter "Fluid Transients in Systems" (1993)

【簡略化事項】
    ポンプ完全特性（四象限）: 放物線近似 H = α²Hs - BqQ². 通常運転域のみ.
    逆転領域は逆止め弁 or Q=0 近似. 精密解析は実機 Suter 曲線データが必要.
"""

import math
from dataclasses import dataclass, field, replace
from typing import Literal, Union

from .formulas import GRAVITY
from .types import Pipe


# 土地改良事業計画設計基準・設計「パイプライン」技術書 §8.4.2(2)
# 設計用水撃圧解析で一般に用いられる差分距離。50 m 未満は計算可能だが、
# 200 m 超は設計用途として粗すぎるため、本ソルバーでは入力エラーとする。
MOC_GRID_SPACING_RECOMMENDED_MIN = 50.0
MOC_GRID_SPACING_MAX = 200.0

# 水蒸気圧水頭（ゲージ、標高0m・常温）[m]
#
# これを下回ると水柱分離（キャビテーション）が発生する。本ソルバーは分離後の
# 挙動を追跡しないため、下回った場合は警告を返す（issue #50）。
# 標高が高い現場や水温が高い場合は MocOptions.vapor_pressure_head で調整する。
MOC_VAPOR_PRESSURE_HEAD = -10.33

# ═══════════════════════════════════════════════════════════════════════════════
# 境界条件型（Discriminated Union）
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class ReservoirBC:
    """定水頭貯水槽（上流・下流どちらにも配置可）."""

    head: float  # 水頭 H_R [m]
    type: Literal["reservoir"] = "reservoir"


@dataclass(frozen=True)
class ValveBC:
    """バルブ（末端・中間どちらでも可）.

    線形開度変化: close → 1→0、open → 0→1.
    技術書 §8.3.1(1)b 均等操作（等価閉そく時間）に対応.
    """

    Q0: float  # 初期流量 [m³/s]
    H0v: float  # バルブ端初期水頭 [m]
    close_time: float  # 操作完了時間 tν [s]（0 = 瞬時）
    operation: Literal["close", "open"] = "close"
    type: Literal["valve"] = "valve"


@dataclass(frozen=True)
class PumpBC:
    """ポンプ（上流端専用）.

    H-Q 特性: H_pump = α²·Hs - Bq·Q²（放物線近似）.

    回転速度モデル:
        GD2 + N0 を指定した場合 → 技術書式(8.4.10-11) GD²慣性方程式
        未指定の場合 → 線形近似:
            trip: α=max(0,1-t/shutdownTime)、start: α=min(1,t/startupTime)

    逆止め弁 check_valve=True のとき Q < 0 を遮断.
    """

    Q0: float  # 定格流量 [m³/s]
    H0: float  # 定格水頭（揚程）[m]
    shutdown_time: float  # 停止完了時間 [s]（GD2 未指定時の線形フォールバック）
    Hs: float | None = None  # 締切水頭（Q=0 時の揚程、デフォルト 1.2×H₀）
    GD2: float | None = None  # GD²（はずみ車効果）[N·m²]
    N0: float | None = None  # 定格回転速度 [min⁻¹]
    eta0: float | None = None  # 定格効率（デフォルト 0.80）
    mode: Literal["trip", "start"] = "trip"
    startup_time: float | None = None  # 起動完了時間 [s]
    static_head: float | None = None  # 起動前の静水頭 [m]
    check_valve: bool = True
    type: Literal["pump"] = "pump"


@dataclass(frozen=True)
class AirChamberBC:
    """エアチャンバ（圧力タンク）.

    技術書 §8.3 表-8.3.1「圧力タンク」境界条件.
    気体則: H_a · V_a^m = const（ポリトロープ）.
    """

    V_air0: float  # 初期空気容積 [m³]
    H_air0: float  # 初期水頭（システム静圧）[m]
    polytropic_index: float = 1.2  # ポリトロープ指数 m
    type: Literal["air_chamber"] = "air_chamber"


@dataclass(frozen=True)
class SurgeTankBC:
    """サージタンク（調圧水槽）.

    技術書 §8.5 剛体理論解析の主対象境界条件.
    水位 ODE: A_s·dz/dt = Q_in（陰的更新で無条件安定）.
    """

    tank_area: float  # タンク断面積 [m²]
    initial_level: float  # 初期水位 z₀ [m]（datum からの高さ）
    datum: float = 0.0  # 基準高さ [m]
    type: Literal["surge_tank"] = "surge_tank"


@dataclass(frozen=True)
class AirReleaseValveBC:
    """吸気弁（Air Release / Vacuum Breaking Valve）.

    技術書 §8.3 負圧防止対策.
    H < H_atm になると開放し大気圧を維持.
    """

    atmospheric_head: float = 10.33  # 大気圧水頭 [m]
    type: Literal["air_release_valve"] = "air_release_valve"


@dataclass(frozen=True)
class PressureReducingValveBC:
    """減圧バルブ（Pressure Reducing Valve）.

    技術書 §8.3 表-8.3.1「減圧バルブ」.
    下流側圧力を設定値 H_set に維持.
    """

    set_head: float  # 目標下流圧水頭 [m]
    Q0: float  # 初期流量 [m³/s]
    type: Literal["pressure_reducing_valve"] = "pressure_reducing_valve"


@dataclass(frozen=True)
class DeadEndBC:
    """行き止まり（Q=0 の剛体端、下流端専用）."""

    type: Literal["dead_end"] = "dead_end"


BoundaryCondition = Union[
    ReservoirBC,
    ValveBC,
    PumpBC,
    AirChamberBC,
    SurgeTankBC,
    AirReleaseValveBC,
    PressureReducingValveBC,
    DeadEndBC,
]


# ═══════════════════════════════════════════════════════════════════════════════
# 管網型
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class MocPipeSegment:
    """管路区間."""

    id: str
    pipe: Pipe
    wave_speed: float  # 波速 [m/s]
    n_reaches: int  # 分割数（Δt = Δx/a）
    upstream_node_id: str
    downstream_node_id: str
    initial_flow: float | None = None  # 初期流量 [m³/s]（分岐管路時）
    # 上流端・下流端の管中心高 [m]（issue #50: 水柱分離の判定に使う）
    #
    # 水柱分離は**動水頭**（水頭 − 管中心高）が水蒸気圧水頭を下回ったときに起きる。
    # 省略すると 0 とみなし、水頭をそのまま動水頭として判定する（＝基準面が
    # 管中心にある場合のみ正しい）。標高差のある管路では必ず指定すること。
    upstream_elevation: float | None = None
    downstream_elevation: float | None = None


@dataclass(frozen=True)
class MocNetwork:
    """管網定義（直列・分岐管路に対応、pipes は上流→下流の順）."""

    pipes: list[MocPipeSegment]
    nodes: dict[str, BoundaryCondition]


# ═══════════════════════════════════════════════════════════════════════════════
# 入出力型
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class MocOptions:
    t_max: float | None = None  # シミュレーション時間 [s]
    initial_flow: float | None = None  # 全管路共通の初期流量 [m³/s]
    initial_node_heads: dict[str, float] | None = None  # 定常計算由来の節点水頭 [m]
    # 水柱分離を判定する水蒸気圧水頭（ゲージ）[m]。既定 MOC_VAPOR_PRESSURE_HEAD。
    vapor_pressure_head: float | None = None


@dataclass(frozen=True)
class MocSnapshot:
    t: float
    H: list[float]
    Q: list[float]


@dataclass
class MocPipeResult:
    wave_speed: float
    dx: float
    n_reaches: int
    vibration_period: float
    H_steady: list[float]
    Hmax: list[float]
    Hmin: list[float]
    snapshots: list[MocSnapshot] = field(default_factory=list)


@dataclass
class TimeSeriesPoint:
    t: float
    value: float


@dataclass
class MocNodeResult:
    H: list[dict] = field(default_factory=list)  # [{"t": float, "H": float}, ...]
    N: list[dict] | None = None  # ポンプ節点 [{"t": ..., "N": ...}]
    V_air: list[dict] | None = None  # エアチャンバ節点
    z: list[dict] | None = None  # サージタンク節点


@dataclass
class MocResult:
    dt: float
    t_max: float
    pipes: dict[str, MocPipeResult]
    nodes: dict[str, MocNodeResult]
    warnings: list[str] = field(default_factory=list)


# ═══════════════════════════════════════════════════════════════════════════════
# 内部ヘルパー
# ═══════════════════════════════════════════════════════════════════════════════


def harmonize_time_step(segs: list[MocPipeSegment]) -> tuple[list[MocPipeSegment], float, list[str]]:
    """全管路の Δt を統一し、n_reaches を再計算する（技術書 §8.4.2(2)）.

    各管路の素の Δt_i = L_i/(a_i·N_i^init) から最小値を共通 Δt として採用し、
    各管路の N_i を round(L_i/(a_i·Δt)) で再計算する。

    再調整による Δx の相対誤差が大きい場合（>5%）は警告を返す.

    Returns:
        (調整済 segs, 共通 dt, 警告リスト).
    """
    if len(segs) == 0:
        return ([], 0.0, [])
    warnings: list[str] = []

    dt_candidates = [s.pipe.length / (s.wave_speed * max(1, s.n_reaches)) for s in segs]
    dt = min(dt_candidates)

    harmonized: list[MocPipeSegment] = []
    for s in segs:
        n_ideal = s.pipe.length / (s.wave_speed * dt)
        n_new = max(1, round(n_ideal))
        dx_new = s.pipe.length / n_new
        dx_ideal = s.wave_speed * dt
        rel_err = abs(dx_new - dx_ideal) / dx_ideal
        if rel_err > 0.05:
            warnings.append(
                f"{s.id}: dt整合化で n_reaches={s.n_reaches}→{n_new}、"
                f"Δx の理想値からの誤差 {rel_err * 100:.1f}%（CFL<1）。"
                "特性線の足を格子間で補間します。"
            )
        elif n_new != s.n_reaches:
            warnings.append(
                f"{s.id}: dt整合化で n_reaches={s.n_reaches}→{n_new}"
                f"（誤差 {rel_err * 100:.2f}%）"
            )
        # frozen dataclass を更新するには新しいインスタンスを作る。
        # replace() を使うことで、フィールドが増えても取りこぼさない。
        harmonized.append(replace(s, n_reaches=n_new))
    return (harmonized, dt, warnings)


# ─── 計算区間数の自動提案（issue #49）────────────────────────────────────────


@dataclass(frozen=True)
class ReachCandidatePipe:
    """suggest_reaches の入力（管路 1 本ぶんの最小情報）."""

    length: float  # 管路延長 L [m]
    wave_speed: float  # 波速 a [m/s]


@dataclass(frozen=True)
class SuggestReachesResult:
    reaches: list[int]  # 各管路の計算区間数（入力と同じ順）
    dt: float  # 共通タイムステップ Δt [s]
    courant_error: float  # 全管路で最大の |Δx − a·Δt| / (a·Δt)
    dx_min: float  # 実際に採用した差分距離の下限 [m]
    warnings: list[str] = field(default_factory=list)


def _search_reaches(
    pipes: list[ReachCandidatePipe],
    dx_min: float,
    dx_max: float,
    dx_target: float,
    tolerance: float,
) -> tuple[list[int], float, float] | None:
    """指定した Δx 下限のもとで最良の分割数の組を探す."""
    first = pipes[0]
    n_max = max(1, math.ceil(first.length / dx_min))
    best: tuple[list[int], float, float, tuple[int, float]] | None = None

    for n0 in range(1, n_max + 1):
        dt_seed = first.length / (first.wave_speed * n0)
        reaches = [max(1, round(p.length / (p.wave_speed * dt_seed))) for p in pipes]
        # 実際に run_moc（harmonize_time_step）が採用する Δt は各管路の素の Δt の最小値。
        # 誤差評価もそれに合わせないと提案値とソルバーの挙動がずれる。
        dt = min(p.length / (p.wave_speed * n) for p, n in zip(pipes, reaches, strict=True))
        err = 0.0
        dx_penalty = 0.0
        ok = True
        for p, n in zip(pipes, reaches, strict=True):
            dx = p.length / n
            if dx > dx_max or dx < dx_min:
                ok = False
                break
            err = max(err, abs(dx - p.wave_speed * dt) / (p.wave_speed * dt))
            dx_penalty = max(dx_penalty, abs(dx - dx_target))
        if not ok:
            continue
        # 許容内の誤差は実用上等価とみなし、Δx が目標に近い組を優先する
        rank = (0, dx_penalty) if err <= tolerance else (1, err)
        if best is None or rank < best[3]:
            best = (reaches, dt, err, rank)

    return None if best is None else (best[0], best[1], best[2])


def suggest_reaches(
    pipes: list[ReachCandidatePipe],
    dx_min: float | None = None,
    dx_max: float | None = None,
    dx_target: float | None = None,
    courant_tolerance: float = 0.01,
) -> SuggestReachesResult:
    """全管路で共通の Δt が成立する計算区間数の組を提案する（技術書 §8.4.2(2)）.

    MOC は全管路で共通の Δt を使うため、Δx = a·Δt が全管路で同時に成り立つ分割数を
    選ぶ必要がある。実務データでは管路長と波速の比が整数分割で揃わず、
    実務目安 Δx = 50〜200 m と Courant 誤差の許容が両立しないことがある。

    本関数はまず実務目安の範囲で探し、そこで許容誤差に収まらなければ Δx の下限を
    段階的に下げる。どこまで下げたかと理由は ``warnings`` で返す。
    """
    if not pipes:
        raise ValueError("管路が 0 本です")
    for p in pipes:
        if p.length <= 0 or p.wave_speed <= 0:
            raise ValueError("管路延長と波速は正の値で指定してください。")

    dx_max_v = dx_max if dx_max is not None else MOC_GRID_SPACING_MAX
    dx_target_v = (
        dx_target
        if dx_target is not None
        else (MOC_GRID_SPACING_RECOMMENDED_MIN + MOC_GRID_SPACING_MAX) / 2
    )
    recommended_min = MOC_GRID_SPACING_RECOMMENDED_MIN

    # 下限の候補: 実務目安から段階的に下げる（明示指定があればそれだけ）
    floors = (
        [dx_min]
        if dx_min is not None
        else [recommended_min * f for f in (1.0, 0.7, 0.4, 0.2, 0.1)]
    )

    fallback: tuple[list[int], float, float, float] | None = None

    for floor in floors:
        if floor > dx_max_v:
            continue
        found = _search_reaches(pipes, floor, dx_max_v, dx_target_v, courant_tolerance)
        if found is None:
            continue
        reaches, dt, err = found
        if fallback is None or err < fallback[2]:
            fallback = (reaches, dt, err, floor)
        if err <= courant_tolerance:
            warnings: list[str] = []
            if floor < recommended_min:
                warnings.append(
                    f"Δx を実務目安の下限 {recommended_min:.0f} m 以上にすると Courant 誤差が"
                    f"許容値 {courant_tolerance * 100:.1f}% に収まらないため、"
                    f"下限を {floor:.0f} m まで下げました。"
                    "管路長と波速の比が整数分割で揃わないことによるもので、"
                    "計算精度上の問題はありません（技術書 §8.4.2(2)）。"
                )
            return SuggestReachesResult(
                reaches=reaches, dt=dt, courant_error=err, dx_min=floor, warnings=warnings
            )

    if fallback is None:
        raise ValueError(
            f"Δx を {dx_max_v:.0f} m 以下に収める計算区間数の組が見つかりません。"
            "管路延長・波速を確認してください。"
        )
    return SuggestReachesResult(
        reaches=fallback[0],
        dt=fallback[1],
        courant_error=fallback[2],
        dx_min=fallback[3],
        warnings=[
            f"どの分割数でも Courant 誤差が許容値 {courant_tolerance * 100:.1f}% に"
            f"収まりません（最小 {fallback[2] * 100:.2f}%）。"
            "管路延長または波速の組み合わせを見直してください（技術書 §8.4.2(2)）。"
        ],
    )


def _validate_grid_spacing(segs: list[MocPipeSegment]) -> list[str]:
    """設計用水撃圧解析の差分距離を技術書 §8.4.2(2) の実務目安で検証する."""
    warnings: list[str] = []
    for seg in segs:
        if isinstance(seg.n_reaches, bool) or not isinstance(seg.n_reaches, int) or seg.n_reaches < 1:
            raise ValueError(f"{seg.id}: 計算区間数は1以上の整数で指定してください。")
        dx = seg.pipe.length / seg.n_reaches
        if dx > MOC_GRID_SPACING_MAX:
            n_min = math.ceil(seg.pipe.length / MOC_GRID_SPACING_MAX)
            raise ValueError(
                f"{seg.id}: 差分距離 Δx={dx:.1f} m は設計用水撃圧解析の上限 "
                f"{MOC_GRID_SPACING_MAX:.0f} m を超えています。"
                f"計算区間数を {n_min} 以上にしてください（技術書 §8.4.2(2)）。"
            )
        if dx < MOC_GRID_SPACING_RECOMMENDED_MIN:
            warnings.append(
                f"{seg.id}: 差分距離 Δx={dx:.1f} m は一般的な実務目安 "
                f"{MOC_GRID_SPACING_RECOMMENDED_MIN:.0f}～{MOC_GRID_SPACING_MAX:.0f} m より細かい設定です。"
                "精度上の問題はありませんが、計算負荷を確認してください（技術書 §8.4.2(2)）。"
            )
    return warnings


def _local_darcy_f(velocity: float, diameter: float, c_hw: float) -> float:
    """Hazen-Williams → Darcy-Weisbach 等価摩擦係数（局所流速版）."""
    abs_v = abs(velocity)
    if abs_v < 1e-4:
        return 0.02
    rh = diameter / 4
    # Hazen-Williams 式（技術書 式7.2.2）: V = 0.849·C·R^0.63·I^0.54
    s_grad = (abs_v / (0.849 * c_hw * rh**0.63)) ** (1 / 0.54)
    # 上限 0.15 は乱流域の妥当範囲として残す。下限は設けない（issue #51）:
    # 粗度係数 C を大きくとった検証条件で無摩擦を表現できるようにするため。
    # 極低流速は上の早期リターンで処理済みで、f は常に乗数としてしか使わないので
    # 0 に近づいても 0 除算は起きない。
    return min((2 * GRAVITY * diameter * s_grad) / (abs_v * abs_v), 0.15)


def _pipe_elevation_at(seg: "MocPipeSegment", i: int) -> float:
    """格子点 i の管中心高 [m]（上下流端の直線補間、未指定なら 0）.

    issue #50: 水柱分離は動水頭（水頭 − 管中心高）で判定するため必要。
    """
    up = seg.upstream_elevation if seg.upstream_elevation is not None else 0.0
    dn = seg.downstream_elevation if seg.downstream_elevation is not None else up
    return up + (dn - up) * (i / seg.n_reaches)


def _pipe_area(diameter: float) -> float:
    """管路断面積 [m²]."""
    return (math.pi * diameter * diameter) / 4


def _valve_opening(t: float, close_time: float, op: Literal["close", "open"]) -> float:
    """バルブ開度 τ（0=全閉, 1=全開）."""
    if op == "close":
        return 0.0 if close_time <= 0 else max(0.0, 1 - t / close_time)
    return 1.0 if close_time <= 0 else min(1.0, t / close_time)


def _pump_alpha_fallback(t: float, bc: PumpBC) -> float:
    """ポンプ速度比 α（GD2 未使用時の線形フォールバック）."""
    if bc.mode == "start":
        st = bc.startup_time if bc.startup_time is not None else 0.0
        return 1.0 if st <= 0 else min(1.0, t / st)
    return 0.0 if bc.shutdown_time <= 0 else max(0.0, 1 - t / bc.shutdown_time)


# ─── 境界条件ソルバー ──────────────────────────────────────────────────────────


def _solve_reservoir(
    char_val: float, b: float, h_r: float, is_upstream: bool
) -> tuple[float, float]:
    """貯水槽 BC. Returns (H, Q)."""
    h = h_r
    q = (h - char_val) / b if is_upstream else (char_val - h) / b
    return (h, q)


def _solve_valve(
    cp: float, b: float, tau: float, q0: float, h0v: float
) -> tuple[float, float]:
    """バルブ BC（下流端専用）: H_P = CP - B·τᵥ·√H_P の 2 次方程式.

    issue #50: 全閉時・流出不能時は水頭を 0 m で打ち切らず、C+ の値をそのまま返す。
    下降側の水撃圧を過小評価（危険側）しないため。負圧の妥当性は run_moc 側で
    水蒸気圧水頭と照合して警告する。
    """
    # 全閉 → 行き止まりと同じ（水頭は C+ そのもの、負値も許容）
    if tau < 1e-10:
        return (cp, 0.0)
    # C+ が基準面以下だと弁は流出できない（√H が定義できない）。行き止まり扱い。
    if cp <= 0:
        return (cp, 0.0)
    h0_safe = max(h0v, 0.01)
    tau_v = (tau * q0) / math.sqrt(h0_safe)
    disc = b * b * tau_v * tau_v + 4 * cp
    y = (-b * tau_v + math.sqrt(disc)) / 2
    return (y * y, tau_v * y)


def _solve_pump(
    cm: float,
    b: float,
    t: float,
    bc: PumpBC,
    a: float,
    state: dict[str, float],
    dt: float,
) -> tuple[float, float]:
    """ポンプ BC（上流端専用）.

    技術書式(8.4.10-11) GD²慣性方程式 or 線形フォールバック.

    本実装は H-Q 特性を放物線 H = α²·Hs - Bq·Q² で近似し、トルクは相似則
        M_t/M₀ = (Q·H·N₀)/(Q₀·H₀·N) （定効率仮定）
    から推算する**簡易モデル**である。技術書 §8.4.2(5)c が本来要求する
    Suter 変換 4象限特性は対象外。逆流・逆転・キャビテーションには不十分.
    """
    use_gd2 = bc.GD2 is not None and bc.N0 is not None

    # 速度比 α の取得
    if use_gd2:
        alpha = state["N"] / bc.N0  # type: ignore[operator]
    else:
        alpha = _pump_alpha_fallback(t, bc)
    alpha = max(0.0, alpha)

    check_valve = bc.check_valve
    hs = bc.Hs if bc.Hs is not None else bc.H0 * 1.2
    bq = (hs - bc.H0) / (bc.Q0 * bc.Q0)

    # ポンプ停止時
    # issue #50: 停止後は逆止め弁で閉じた行き止まりと同じ。水頭は C- そのもので、
    # 0 m で打ち切らない（ポンプ直後の負圧を過小評価しないため）。
    if alpha < 1e-6:
        return (cm, 0.0)

    # H-Q 交点の解
    # H = α²·Hs - Bq·Q² かつ H = CM + B·Q → Bq·Q² + B·Q + (CM - α²·Hs) = 0
    alpha_hs = alpha * alpha * hs
    disc = b * b + 4 * bq * max(alpha_hs - cm, 0.0)

    if disc < 0 or bq < 1e-15:
        q = (alpha_hs - cm) / b
        h = cm + b * q
    else:
        q = (-b + math.sqrt(disc)) / (2 * bq)
        h = cm + b * q

    if check_valve and q < 0:
        # 逆止め弁が閉じる → 行き止まり。水頭は C- そのもの（issue #50）
        h = cm
        q = 0.0
    q = max(q, 0.0)

    # GD² による回転速度更新（技術書式 8.4.10-11）
    if use_gd2 and state["N"] > 1e-3:
        n_old = state["N"]
        n0 = bc.N0  # type: ignore[assignment]
        gd2 = bc.GD2  # type: ignore[assignment]
        eta0 = bc.eta0 if bc.eta0 is not None else 0.80

        if bc.mode == "trip":
            # 定格トルク M₀ [N·m]
            m0 = 1000 * GRAVITY * bc.Q0 * bc.H0 * 60 / (2 * math.pi * n0 * eta0)
            # 現トルク（動力 = ρgQH から推算、簡易定効率仮定）
            if q > 1e-6:
                m_t = m0 * (q * h * n0) / (bc.Q0 * bc.H0 * n_old)
            else:
                m_t = m0 * alpha * alpha * 0.1  # 残留抵抗トルク
            # dN/dt = -M_t · 4g·60 / (GD²·2π)  [min⁻¹/s]
            d_n_dt = -m_t * 4 * GRAVITY * 60 / (gd2 * 2 * math.pi)
            state["N"] = max(0.0, n_old + d_n_dt * dt)
        # startup: α は prescribed（線形上昇）→ state.N は外部で更新しない

    return (h, q)


def _solve_device_node(
    in_pipes: list[tuple[float, float]],
    out_pipes: list[tuple[float, float]],
    bc: "AirChamberBC | SurgeTankBC | AirReleaseValveBC",
    dt: float,
    state: dict,
) -> tuple[float, list[float], list[float]]:
    """装置節点（エアチャンバ・サージタンク・吸気弁）の求解.

    issue #47: これらの防護工は実務では管路の**途中**に設置する。従来は
    「流入管 1 本の末端」としてしか解いておらず、流出管の流量が 0 のまま残って
    装置が完全閉そくとして働いていた。

    ここでは装置を「節点から流量 Q_dev を出し入れする枝」として扱い、
    分岐点の連続条件と連立させる。

        流入管 k: Q_in,k  = (CP_k - H) / B_k
        流出管 k: Q_out,k = (H - CM_k) / B_k
        連続条件: sum(Q_in) - sum(Q_out) - Q_dev(H) = 0

    S = sum_in CP_k/B_k + sum_out CM_k/B_k、T = sum_all 1/B_k と置くと
    sum(Q_in) - sum(Q_out) = S - H*T なので、解くべきは
    f(H) = S - H*T - Q_dev(H) = 0。

    流出管が 0 本（管路末端）の場合はこの一般形の特殊ケースとして落ちるため、
    従来の末端配置の挙動はそのまま保たれる。

    Args:
        in_pipes: [(CP, B), ...] 流入管.
        out_pipes: [(CM, B), ...] 流出管.

    Returns:
        (H, Q_in のリスト, Q_out のリスト).
    """
    s_sum = sum(cp / b for cp, b in in_pipes) + sum(cm / b for cm, b in out_pipes)
    t_sum = sum(1 / b for _, b in in_pipes) + sum(1 / b for _, b in out_pipes)

    def finish(h: float) -> tuple[float, list[float], list[float]]:
        return (
            h,
            [(cp - h) / b for cp, b in in_pipes],
            [(h - cm) / b for cm, b in out_pipes],
        )

    if t_sum <= 0:
        return finish(0.0)

    if isinstance(bc, SurgeTankBC):
        # Q_dev = (H - datum - z)*A_s/dt は H について線形 -> 閉形式で解ける
        #   H = (S + (z + datum)*A_s/dt) / (T + A_s/dt)
        datum = bc.datum
        k = bc.tank_area / dt
        h = (s_sum + (state["z"] + datum) * k) / (t_sum + k)
        q_dev = (h - datum - state["z"]) * k
        state["z"] += q_dev * dt / bc.tank_area
        return finish(h)

    if isinstance(bc, AirReleaseValveBC):
        # まず装置なし（Q_dev = 0）で解き、大気圧水頭を下回るときだけ開放する
        h_free = s_sum / t_sum
        return finish(bc.atmospheric_head if h_free < bc.atmospheric_head else h_free)

    # エアチャンバ: ポリトロープ気体則 H*V^m = H_a0*V_a0^m
    #   V_new(H) = V_a0*(H_a0/H)^(1/m)、Q_dev(H) = (V_state - V_new(H)) / dt
    #   f(H) = S - H*T - Q_dev(H) は H について単調減少なので二分法で確実に解ける。
    m = bc.polytropic_index
    v_min = bc.V_air0 * 0.02  # 最小空気容積（チャンバ容量の 2%）
    v_state = state["V_air"]

    def volume_at(h: float) -> float:
        return bc.V_air0 * (bc.H_air0 / h) ** (1 / m)

    def f(h: float) -> float:
        return s_sum - h * t_sum - (v_state - volume_at(h)) / dt

    # 空気容積の下限に対応する水頭の上限（これ以上は圧縮できない）
    h_ceiling = bc.H_air0 * (bc.V_air0 / v_min) ** m
    lo = 1e-9
    hi = max(h_ceiling, abs(s_sum / t_sum) * 2 + 1)
    if f(hi) > 0:
        # 上限でもまだ f > 0 -> 圧縮限界。V_min に張り付く
        state["V_air"] = v_min
        return finish(h_ceiling)
    for _ in range(80):
        mid = (lo + hi) / 2
        if f(mid) > 0:
            lo = mid
        else:
            hi = mid
    h = (lo + hi) / 2
    state["V_air"] = min(max(volume_at(h), v_min), bc.V_air0 / 0.02)
    return finish(h)


def _solve_prv_inline(
    in_pipe: tuple[float, float],
    out_pipe: tuple[float, float],
    bc: "PressureReducingValveBC",
) -> tuple[float, float, float, float]:
    """減圧バルブ BC — 管路の途中（流入管 1 本・流出管 1 本）.

    issue #47: 減圧弁は流量を出し入れする装置ではなく、節点の上流側と下流側で
    **異なる水頭**を持つ要素なので、他の防護工とは別扱いにする。

        下流側: H_dn = H_set（設定圧を維持）-> Q = (H_set - CM) / B_dn
        上流側: H_up = CP - B_up*Q

    動作モード:
        - 通常制御: 上式のとおり
        - 全開: 上流水頭が設定圧まで届かない場合は減圧できないので、
                単なる接合点（連続条件のみ）に退化する
        - 遮断: 逆流になる場合は Q = 0（逆止機能）

    Returns:
        (H_上流側, H_下流側, Q_in, Q_out).
    """
    cp, b_in = in_pipe
    cm, b_out = out_pipe
    q = (bc.set_head - cm) / b_out
    if q <= 0:
        # 逆流 -> 遮断。両側とも行き止まりとして解く
        return (cp, cm, 0.0, 0.0)
    h_up = cp - b_in * q
    if h_up <= bc.set_head:
        # 上流水頭が設定圧以下 -> 減圧不要。全開＝単なる接合点
        h = (cp / b_in + cm / b_out) / (1 / b_in + 1 / b_out)
        return (h, h, (cp - h) / b_in, (h - cm) / b_out)
    return (h_up, bc.set_head, q, q)


def _solve_prv(
    cp: float, b: float, bc: PressureReducingValveBC
) -> tuple[float, float]:
    """減圧バルブ BC（設定圧維持）."""
    h = bc.set_head
    q = max((cp - h) / b, 0.0)  # 逆流不可
    return (h, q)


def _solve_dead_end(cp: float) -> tuple[float, float]:
    """行き止まり BC: Q=0, H=CP.

    issue #50: 水頭を 0 m で打ち切らない。負圧の妥当性は run_moc 側で
    水蒸気圧水頭と照合して警告する。
    """
    return (cp, 0.0)


def _solve_junction(
    in_pipes: list[tuple[float, float]],  # [(CP, B), ...]
    out_pipes: list[tuple[float, float]],  # [(CM, B), ...]
) -> tuple[float, list[float], list[float]]:
    """汎用 n 管路ジャンクションソルバー.

    技術書 §8.4.2(5)d 分枝点連続条件:

    流入管路 k: C+ → H = CP_k - B_k·Q_k  ∴ Q_k = (CP_k - H) / B_k
    流出管路 k: C- → H = CM_k + B_k·Q_k  ∴ Q_k = (H - CM_k) / B_k
    連続: Σ Q_in - Σ Q_out = 0
    解: H = (Σ CP_k/B_k + Σ CM_k/B_k) / (Σ 1/B_k)

    Returns:
        (H, Q_in_list, Q_out_list).
    """
    sum_inv = sum(1 / b for _, b in in_pipes) + sum(1 / b for _, b in out_pipes)
    h = (
        sum(cp / b for cp, b in in_pipes) + sum(cm / b for cm, b in out_pipes)
    ) / sum_inv
    q_ins = [(cp - h) / b for cp, b in in_pipes]
    q_outs = [(h - cm) / b for cm, b in out_pipes]
    return (h, q_ins, q_outs)


# ═══════════════════════════════════════════════════════════════════════════════
# 管路物理量
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class _PipePhysics:
    A: float
    B: float  # 特性インピーダンス a/(gA)
    dx: float
    dt: float
    T0: float
    hf_total: float  # 初期条件用の全摩擦損失（定常）
    D: float  # 内径
    C_hw: float  # H-W 流速係数


def _compute_pipe_physics(seg: MocPipeSegment, q0: float) -> _PipePhysics:
    a = seg.wave_speed
    n = seg.n_reaches
    d = seg.pipe.inner_diameter
    length = seg.pipe.length
    c_hw = seg.pipe.roughness_coeff
    area = _pipe_area(d)
    v0 = q0 / area
    f0 = _local_darcy_f(v0, d, c_hw)
    dx = length / n
    dt = dx / a
    b = a / (GRAVITY * area)
    hf_total = (f0 * length * v0 * v0) / (2 * GRAVITY * d)
    t0 = (4 * length) / a
    return _PipePhysics(A=area, B=b, dx=dx, dt=dt, T0=t0, hf_total=hf_total, D=d, C_hw=c_hw)


def _steady_head_profile(h_upstream: float, hf_total: float, n: int) -> list[float]:
    return [h_upstream - hf_total * (i / n) for i in range(n + 1)]


def _interpolate_grid(values: list[float], position: float) -> float:
    """格子番号で表した位置の値を線形補間する（範囲端では端値を使用）."""
    position = min(max(position, 0.0), len(values) - 1)
    lower = math.floor(position)
    upper = min(lower + 1, len(values) - 1)
    fraction = position - lower
    return values[lower] + (values[upper] - values[lower]) * fraction


# ═══════════════════════════════════════════════════════════════════════════════
# メイン MOC ソルバー
# ═══════════════════════════════════════════════════════════════════════════════


def run_moc(
    network: MocNetwork, options: MocOptions | None = None
) -> MocResult:
    """汎用特性曲線法（MOC）ソルバー.

    直列・分岐管路、全境界条件タイプに対応.
    """
    if options is None:
        options = MocOptions()
    raw_segs = network.pipes
    nodes = network.nodes
    if len(raw_segs) == 0:
        raise ValueError("管路が 0 本です")

    # 整合化処理へ渡す前に、計算区間数が格子として成立することを保証する。
    _validate_grid_spacing(raw_segs)

    # dt 整合化（技術書 §8.4.2(2)）
    segs, _dt_unused, harmonize_warnings = harmonize_time_step(raw_segs)
    warnings: list[str] = list(harmonize_warnings)
    # 管路網では整合化により分割数が変わるため、実際に使用する差分距離を再検証する。
    warnings.extend(_validate_grid_spacing(segs))

    # ノード接続グラフ構築
    # node_flow_in[node_id]  = 管路インデックス（この node が下流端である管路）
    # node_flow_out[node_id] = 管路インデックス（この node が上流端である管路）
    node_flow_in: dict[str, list[int]] = {}
    node_flow_out: dict[str, list[int]] = {}
    for pi, seg in enumerate(segs):
        node_flow_in.setdefault(seg.downstream_node_id, []).append(pi)
        node_flow_out.setdefault(seg.upstream_node_id, []).append(pi)
    all_node_ids = list({nid for s in segs for nid in (s.upstream_node_id, s.downstream_node_id)})

    # 各管路の初期流量推算
    def infer_q0(pi: int) -> float:
        if options.initial_flow is not None:
            return options.initial_flow
        seg = segs[pi]
        if seg.initial_flow is not None:
            return seg.initial_flow
        # 上流 BC から
        up_bc = nodes.get(seg.upstream_node_id)
        if isinstance(up_bc, PumpBC):
            return up_bc.Q0
        # 下流 BC から
        dn_bc = nodes.get(seg.downstream_node_id)
        if isinstance(dn_bc, ValveBC):
            return dn_bc.Q0
        if isinstance(dn_bc, PressureReducingValveBC):
            return dn_bc.Q0
        return 0.0

    q0_arr = [infer_q0(pi) for pi in range(len(segs))]

    # 各管路の物理量
    physics = [_compute_pipe_physics(seg, q0_arr[pi]) for pi, seg in enumerate(segs)]

    # 全管路の dt の最小値（統一タイムステップ）
    dt_global = min(p.dt for p in physics)

    # クーラン条件 Δt ≤ Δx/(V+a) の検証（技術書 式8.4.8）
    for pi, seg in enumerate(segs):
        ph = physics[pi]
        v0 = abs(q0_arr[pi]) / ph.A
        ratio = v0 / seg.wave_speed
        if ratio > 0.01:
            warnings.append(
                f"{seg.id}: V/a={ratio:.4f} > 0.01。技術書式(8.4.8) Δt≤Δx/(V+a) に対し"
                f"本ソルバの Δt=Δx/a は {ratio * 100:.2f}% 超過しています。"
                "n_reaches を増やすか、初期流速を見直してください。"
            )

    vapor_head = (
        options.vapor_pressure_head
        if options.vapor_pressure_head is not None
        else MOC_VAPOR_PRESSURE_HEAD
    )
    # 最初に水蒸気圧水頭を下回った位置・時刻（issue #50）
    cavitation: dict | None = None

    t0_max = max(p.T0 for p in physics)
    t_max = options.t_max if options.t_max is not None else 3 * t0_max
    n_steps = math.ceil(t_max / dt_global)

    # 初期水頭プロファイル（BFS で各管路上流端 H を伝播）
    node_h0: dict[str, float] = dict(options.initial_node_heads or {})
    for node_id, bc in nodes.items():
        if isinstance(bc, ReservoirBC):
            node_h0[node_id] = bc.head
        elif isinstance(bc, ValveBC):
            node_h0[node_id] = bc.H0v
        elif isinstance(bc, PumpBC):
            node_h0[node_id] = (bc.static_head if bc.static_head is not None else 0.0) if bc.mode == "start" else bc.H0
        elif isinstance(bc, SurgeTankBC):
            node_h0[node_id] = bc.initial_level + bc.datum
        elif isinstance(bc, AirChamberBC):
            node_h0[node_id] = bc.H_air0
        elif isinstance(bc, PressureReducingValveBC):
            node_h0[node_id] = bc.set_head

    # BFS 伝播（上流 → 下流）
    bfs_visited = set(node_h0.keys())
    bfs_queue = list(bfs_visited)
    while bfs_queue:
        node_id = bfs_queue.pop(0)
        h_here = node_h0[node_id]
        for pi, seg in enumerate(segs):
            if seg.upstream_node_id == node_id and seg.downstream_node_id not in bfs_visited:
                node_h0[seg.downstream_node_id] = h_here - physics[pi].hf_total
                bfs_visited.add(seg.downstream_node_id)
                bfs_queue.append(seg.downstream_node_id)

    # 未解決ノード（分岐の末端など）は 0
    for nid in all_node_ids:
        if nid not in node_h0:
            node_h0[nid] = 0.0

    # 状態配列の初期化
    h_state: list[list[float]] = []
    q_state: list[list[float]] = []
    for pi, seg in enumerate(segs):
        h_up = node_h0.get(seg.upstream_node_id, 0.0)
        h_down = node_h0.get(seg.downstream_node_id)
        if h_down is None:
            h_state.append(_steady_head_profile(h_up, physics[pi].hf_total, seg.n_reaches))
        else:
            h_state.append([
                h_up + (h_down - h_up) * (i / seg.n_reaches)
                for i in range(seg.n_reaches + 1)
            ])
        q_state.append([q0_arr[pi]] * (seg.n_reaches + 1))

    h_maxes = [list(h) for h in h_state]
    h_mines = [list(h) for h in h_state]
    h_steady_arr = [list(h) for h in h_state]

    save_every = max(1, n_steps // 200)
    snapshots_arr: list[list[MocSnapshot]] = [[] for _ in segs]

    # 節点時系列
    node_series_h: dict[str, list[dict]] = {nid: [] for nid in all_node_ids}
    node_series_n: dict[str, list[dict]] = {}
    node_series_v: dict[str, list[dict]] = {}
    node_series_z: dict[str, list[dict]] = {}

    # 状態変数（ポンプ速度・エアチャンバ・サージタンク）
    pump_state: dict[str, dict[str, float]] = {}
    air_chamber_state: dict[str, dict[str, float]] = {}
    surge_tank_state: dict[str, dict[str, float]] = {}

    for node_id, bc in nodes.items():
        if isinstance(bc, PumpBC):
            use_gd2 = bc.GD2 is not None and bc.N0 is not None
            if use_gd2:
                n_init = 0.0 if bc.mode == "start" else bc.N0  # type: ignore[assignment]
            else:
                n_init = bc.N0 if bc.N0 is not None else 1450.0
            pump_state[node_id] = {"N": float(n_init)}
            node_series_n[node_id] = []
        if isinstance(bc, AirChamberBC):
            air_chamber_state[node_id] = {"V_air": bc.V_air0}
            node_series_v[node_id] = []
        if isinstance(bc, SurgeTankBC):
            surge_tank_state[node_id] = {"z": bc.initial_level}
            node_series_z[node_id] = []

    # t=0 記録
    for pi, seg in enumerate(segs):
        n = seg.n_reaches
        node_series_h[seg.upstream_node_id].append({"t": 0.0, "H": h_state[pi][0]})
        node_series_h[seg.downstream_node_id].append({"t": 0.0, "H": h_state[pi][n]})
        snapshots_arr[pi].append(MocSnapshot(t=0.0, H=list(h_state[pi]), Q=list(q_state[pi])))
    for nid, st in pump_state.items():
        node_series_n[nid].append({"t": 0.0, "N": st["N"]})
    for nid, st in air_chamber_state.items():
        node_series_v[nid].append({"t": 0.0, "V": st["V_air"]})
    for nid, st in surge_tank_state.items():
        node_series_z[nid].append({"t": 0.0, "z": st["z"]})

    # 時間積分
    h_news: list[list[float]] = [[0.0] * (s.n_reaches + 1) for s in segs]
    q_news: list[list[float]] = [[0.0] * (s.n_reaches + 1) for s in segs]

    for step in range(1, n_steps + 1):
        t = step * dt_global

        # 1. 各管路の内部節点 (i=1..N-1)
        for pi, seg in enumerate(segs):
            n = seg.n_reaches
            h = h_state[pi]
            q = q_state[pi]
            ph = physics[pi]
            h_new = h_news[pi]
            q_new = q_news[pi]
            courant = seg.wave_speed * dt_global / ph.dx
            travel_dx = seg.wave_speed * dt_global

            for i in range(1, n):
                qa = _interpolate_grid(q, i - courant)
                qb = _interpolate_grid(q, i + courant)
                ha = _interpolate_grid(h, i - courant)
                hb = _interpolate_grid(h, i + courant)
                # 局所可変摩擦係数
                ra = _local_darcy_f(qa / ph.A, ph.D, ph.C_hw) * travel_dx / (2 * GRAVITY * ph.D * ph.A * ph.A)
                rb = _local_darcy_f(qb / ph.A, ph.D, ph.C_hw) * travel_dx / (2 * GRAVITY * ph.D * ph.A * ph.A)
                cp = ha + ph.B * qa - ra * qa * abs(qa)
                cm = hb - ph.B * qb + rb * qb * abs(qb)
                h_new[i] = (cp + cm) / 2
                q_new[i] = (cp - cm) / (2 * ph.B)

        # 2. 管路端の C+/C- を計算
        cp_arr: list[float] = [0.0] * len(segs)
        cm_arr: list[float] = [0.0] * len(segs)
        for pi, seg in enumerate(segs):
            n = seg.n_reaches
            h = h_state[pi]
            q = q_state[pi]
            ph = physics[pi]
            courant = seg.wave_speed * dt_global / ph.dx
            travel_dx = seg.wave_speed * dt_global

            q_n1 = _interpolate_grid(q, n - courant)
            h_n1 = _interpolate_grid(h, n - courant)
            r_dn = _local_darcy_f(q_n1 / ph.A, ph.D, ph.C_hw) * travel_dx / (2 * GRAVITY * ph.D * ph.A * ph.A)
            cp_arr[pi] = h_n1 + ph.B * q_n1 - r_dn * q_n1 * abs(q_n1)

            q_1 = _interpolate_grid(q, courant)
            h_1 = _interpolate_grid(h, courant)
            r_up = _local_darcy_f(q_1 / ph.A, ph.D, ph.C_hw) * travel_dx / (2 * GRAVITY * ph.D * ph.A * ph.A)
            cm_arr[pi] = h_1 - ph.B * q_1 + r_up * q_1 * abs(q_1)

        # 3. 全ノードを一括処理
        node_h_new: dict[str, float] = {}
        # 上流側と下流側で水頭が異なる節点（減圧弁）の下流側水頭
        node_h_new_out: dict[str, float] = {}
        node_q_in: dict[str, list[float]] = {}
        node_q_out: dict[str, list[float]] = {}

        for node_id in all_node_ids:
            bc = nodes.get(node_id)
            in_pipes = node_flow_in.get(node_id, [])
            out_pipes = node_flow_out.get(node_id, [])

            h_node: float
            q_ins: list[float] = [0.0] * len(in_pipes)
            q_outs: list[float] = [0.0] * len(out_pipes)

            if bc is None:
                # 内部ジャンクション（分枝点・直列接続）
                in_data = [(cp_arr[pi], physics[pi].B) for pi in in_pipes]
                out_data = [(cm_arr[pi], physics[pi].B) for pi in out_pipes]
                h_node, q_ins, q_outs = _solve_junction(in_data, out_data)

            elif isinstance(bc, ReservoirBC):
                h_node = bc.head
                q_ins = [(cp_arr[pi] - h_node) / physics[pi].B for pi in in_pipes]
                q_outs = [(h_node - cm_arr[pi]) / physics[pi].B for pi in out_pipes]

            elif isinstance(bc, ValveBC):
                if not in_pipes:
                    h_node = 0.0
                else:
                    pi = in_pipes[0]
                    tau = _valve_opening(t, bc.close_time, bc.operation)
                    h_node, q_v = _solve_valve(cp_arr[pi], physics[pi].B, tau, bc.Q0, bc.H0v)
                    q_ins = [q_v]

            elif isinstance(bc, PumpBC):
                if not out_pipes:
                    h_node = 0.0
                else:
                    pi = out_pipes[0]
                    st = pump_state.get(node_id, {"N": float(bc.N0) if bc.N0 is not None else 0.0})
                    h_node, q_p = _solve_pump(
                        cm_arr[pi], physics[pi].B, t, bc, physics[pi].A, st, dt_global
                    )
                    q_outs = [q_p]

            elif isinstance(bc, (AirChamberBC, SurgeTankBC, AirReleaseValveBC)):
                # 防護工（issue #47）:
                # 装置を「節点から流量 Q_dev を出し入れする枝」として扱い、
                # 分岐点の連続条件と連立させる。管路末端・途中のどちらでも解ける。
                in_data = [(cp_arr[pi], physics[pi].B) for pi in in_pipes]
                out_data = [(cm_arr[pi], physics[pi].B) for pi in out_pipes]
                if isinstance(bc, AirChamberBC):
                    dev_state = air_chamber_state[node_id]
                elif isinstance(bc, SurgeTankBC):
                    dev_state = surge_tank_state[node_id]
                else:
                    dev_state = {}
                h_node, q_ins, q_outs = _solve_device_node(
                    in_data, out_data, bc, dt_global, dev_state
                )

            elif isinstance(bc, PressureReducingValveBC):
                # 減圧バルブ（issue #47）:
                # 上流側と下流側で水頭が異なるため、装置枝ではなく専用の扱いにする。
                if len(in_pipes) == 1 and len(out_pipes) == 1:
                    p_in, p_out = in_pipes[0], out_pipes[0]
                    h_node, h_out_v, q_in_v, q_out_v = _solve_prv_inline(
                        (cp_arr[p_in], physics[p_in].B),
                        (cm_arr[p_out], physics[p_out].B),
                        bc,
                    )
                    node_h_new_out[node_id] = h_out_v
                    q_ins = [q_in_v]
                    q_outs = [q_out_v]
                elif not out_pipes and in_pipes:
                    # 管路末端の減圧弁（従来どおり）
                    pi = in_pipes[0]
                    h_node, q_prv = _solve_prv(cp_arr[pi], physics[pi].B, bc)
                    q_ins = [q_prv]
                else:
                    # 未対応構成（流入・流出が複数）。接合点として解く
                    in_data = [(cp_arr[pi], physics[pi].B) for pi in in_pipes]
                    out_data = [(cm_arr[pi], physics[pi].B) for pi in out_pipes]
                    h_node, q_ins, q_outs = _solve_junction(in_data, out_data)

            else:  # DeadEndBC
                if not in_pipes:
                    h_node = 0.0
                else:
                    pi = in_pipes[0]
                    h_node, _ = _solve_dead_end(cp_arr[pi])
                    q_ins = [0.0]

            node_h_new[node_id] = h_node
            node_q_in[node_id] = q_ins
            node_q_out[node_id] = q_outs
            node_series_h[node_id].append({"t": t, "H": h_node})

        # 4. 管路端点への反映
        for node_id in all_node_ids:
            h_node = node_h_new[node_id]
            in_pipes = node_flow_in.get(node_id, [])
            out_pipes = node_flow_out.get(node_id, [])
            q_ins = node_q_in.get(node_id, [])
            q_outs = node_q_out.get(node_id, [])

            for k, pi in enumerate(in_pipes):
                h_news[pi][segs[pi].n_reaches] = h_node
                q_news[pi][segs[pi].n_reaches] = q_ins[k] if k < len(q_ins) else 0.0
            h_out = node_h_new_out.get(node_id, h_node)
            for k, pi in enumerate(out_pipes):
                h_news[pi][0] = h_out
                q_news[pi][0] = q_outs[k] if k < len(q_outs) else 0.0

        # 5. 状態時系列記録
        if step % save_every == 0:
            for nid, st in pump_state.items():
                node_series_n[nid].append({"t": t, "N": st["N"]})
            for nid, st in air_chamber_state.items():
                node_series_v[nid].append({"t": t, "V": st["V_air"]})
            for nid, st in surge_tank_state.items():
                node_series_z[nid].append({"t": t, "z": st["z"]})

        # 6. バッファ更新・包絡線更新
        for pi, seg in enumerate(segs):
            n = seg.n_reaches
            for i in range(n + 1):
                h = h_news[pi][i]
                q = q_news[pi][i]
                h_state[pi][i] = h
                q_state[pi][i] = q
                if h > h_maxes[pi][i]:
                    h_maxes[pi][i] = h
                if h < h_mines[pi][i]:
                    h_mines[pi][i] = h
                # 水柱分離の判定（issue #50）: 動水頭が水蒸気圧水頭を下回った位置・時刻
                if cavitation is None:
                    gauge = h - _pipe_elevation_at(seg, i)
                    if gauge < vapor_head:
                        cavitation = {
                            "pipe_id": seg.id, "index": i, "t": t, "H": h, "gauge": gauge,
                        }
            if step % save_every == 0:
                snapshots_arr[pi].append(
                    MocSnapshot(t=t, H=list(h_state[pi]), Q=list(q_state[pi]))
                )

    # 水柱分離の警告（issue #50）
    if cavitation is not None:
        _pi = next(
            (k for k, s2 in enumerate(segs) if s2.id == cavitation["pipe_id"]), -1
        )
        _dist = cavitation["index"] * physics[_pi].dx if _pi >= 0 else 0.0
        _seg = segs[_pi] if _pi >= 0 else None
        _has_elev = _seg is not None and (
            _seg.upstream_elevation is not None or _seg.downstream_elevation is not None
        )
        warnings.append(
            f"{cavitation['pipe_id']}: 上流端から {_dist:.0f} m の地点"
            f"（格子点 {cavitation['index']}）で t={cavitation['t']:.2f} s に"
            f"動水頭が {cavitation['gauge']:.2f} m"
            f"（動水位 {cavitation['H']:.2f} m）となり、"
            f"水蒸気圧水頭 {vapor_head:.2f} m を"
            "下回りました。この位置で水柱分離（キャビテーション）が発生する可能性が"
            "ありますが、本ソルバーは分離・再結合の挙動を追跡しません。"
            "これ以降の計算結果は参考値として扱い、技術書 §8.3 の防護工検討に"
            "進んでください。"
            + (
                ""
                if _has_elev
                else "（管中心高が未指定のため基準面 0 m で判定しています。"
                "標高差のある管路では upstream_elevation / downstream_elevation を"
                "指定してください。）"
            )
        )

    # 結果整形
    pipes_result: dict[str, MocPipeResult] = {}
    for pi, seg in enumerate(segs):
        ph = physics[pi]
        pipes_result[seg.id] = MocPipeResult(
            wave_speed=seg.wave_speed,
            dx=ph.dx,
            n_reaches=seg.n_reaches,
            vibration_period=ph.T0,
            H_steady=h_steady_arr[pi],
            Hmax=h_maxes[pi],
            Hmin=h_mines[pi],
            snapshots=snapshots_arr[pi],
        )

    nodes_result: dict[str, MocNodeResult] = {}
    for nid in all_node_ids:
        result = MocNodeResult(H=node_series_h[nid])
        if node_series_n.get(nid):
            result.N = node_series_n[nid]
        if node_series_v.get(nid):
            result.V_air = node_series_v[nid]
        if node_series_z.get(nid):
            result.z = node_series_z[nid]
        nodes_result[nid] = result

    return MocResult(
        dt=dt_global,
        t_max=t_max,
        pipes=pipes_result,
        nodes=nodes_result,
        warnings=warnings,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# 便利 API
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class SinglePipeMocInput:
    """単一管路シナリオの簡易入力."""

    pipe: Pipe
    wave_speed: float
    initial_velocity: float
    initial_downstream_head: float
    close_time: float
    n_reaches: int = 10
    t_max: float | None = None
    operation: Literal["close", "open"] = "close"


def run_moc_single_pipe(input: SinglePipeMocInput) -> MocResult:
    """単一管路（貯水槽 → バルブ）便利関数."""
    area = _pipe_area(input.pipe.inner_diameter)
    q0 = input.initial_velocity * area
    f = _local_darcy_f(input.initial_velocity, input.pipe.inner_diameter, input.pipe.roughness_coeff)
    hf_total = (
        f * input.pipe.length * input.initial_velocity * input.initial_velocity
    ) / (2 * GRAVITY * input.pipe.inner_diameter)
    h_r = input.initial_downstream_head + hf_total

    network = MocNetwork(
        pipes=[
            MocPipeSegment(
                id="pipe_0",
                pipe=input.pipe,
                wave_speed=input.wave_speed,
                n_reaches=input.n_reaches,
                upstream_node_id="upstream",
                downstream_node_id="downstream",
            )
        ],
        nodes={
            "upstream": ReservoirBC(head=h_r),
            "downstream": ValveBC(
                Q0=q0,
                H0v=input.initial_downstream_head,
                close_time=input.close_time,
                operation=input.operation,
            ),
        },
    )
    return run_moc(
        network,
        MocOptions(t_max=input.t_max, initial_flow=q0),
    )


# ── ポンプ急停止 ──────────────────────────────────────────────────────────────


@dataclass
class PumpTripInput:
    pipe: Pipe
    wave_speed: float
    Q0: float
    pump_head: float
    Hs: float | None = None
    GD2: float | None = None
    N0: float | None = None
    eta0: float | None = None
    shutdown_time: float = 0.0
    check_valve: bool = True
    n_reaches: int = 10
    t_max: float | None = None


def run_moc_pump_trip(input: PumpTripInput) -> MocResult:
    """ポンプ急停止."""
    pump_bc = PumpBC(
        Q0=input.Q0,
        H0=input.pump_head,
        Hs=input.Hs,
        GD2=input.GD2,
        N0=input.N0,
        eta0=input.eta0,
        shutdown_time=input.shutdown_time,
        check_valve=input.check_valve,
        mode="trip",
    )
    network = MocNetwork(
        pipes=[
            MocPipeSegment(
                id="pipe_0",
                pipe=input.pipe,
                wave_speed=input.wave_speed,
                n_reaches=input.n_reaches,
                upstream_node_id="pump_node",
                downstream_node_id="dead_end_node",
            )
        ],
        nodes={"pump_node": pump_bc, "dead_end_node": DeadEndBC()},
    )
    return run_moc(
        network,
        MocOptions(t_max=input.t_max, initial_flow=input.Q0),
    )


# ── ポンプ起動 ────────────────────────────────────────────────────────────────


@dataclass
class PumpStartInput:
    pipe: Pipe
    wave_speed: float
    Q_rated: float
    pump_head: float
    startup_time: float
    Hs: float | None = None
    static_head: float = 0.0
    n_reaches: int = 10
    t_max: float | None = None


def run_moc_pump_start(input: PumpStartInput) -> MocResult:
    """ポンプ起動."""
    network = MocNetwork(
        pipes=[
            MocPipeSegment(
                id="pipe_0",
                pipe=input.pipe,
                wave_speed=input.wave_speed,
                n_reaches=input.n_reaches,
                upstream_node_id="pump_node",
                downstream_node_id="dead_end_node",
            )
        ],
        nodes={
            "pump_node": PumpBC(
                Q0=input.Q_rated,
                H0=input.pump_head,
                Hs=input.Hs,
                shutdown_time=0.0,
                mode="start",
                startup_time=input.startup_time,
                static_head=input.static_head,
            ),
            "dead_end_node": DeadEndBC(),
        },
    )
    return run_moc(
        network,
        MocOptions(t_max=input.t_max, initial_flow=0.0),
    )
