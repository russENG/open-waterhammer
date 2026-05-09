"""簡易式計算エンジン.

ジューコフスキー / アリエビの実行と警告生成.
"""

from .formulas import (
    allievi_close,
    allievi_open,
    calc_allievi_k1,
    calc_vibration_period,
    calc_wave_speed,
    determine_closure_type,
    joukowsky,
)
from .types import (
    CalculationCase,
    Pipe,
    SimpleFormulaResult,
    WaveSpeedResult,
)


def run_simple_formula(
    pipe: Pipe,
    case: CalculationCase,
    close_time: float,
) -> SimpleFormulaResult:
    """ジューコフスキー / アリエビ式の計算と警告生成."""
    warnings: list[str] = []

    # 1. 波速算定
    a = calc_wave_speed(pipe)
    t0 = calc_vibration_period(pipe.length, a)
    alpha = close_time / t0

    # 2. 急/緩閉そく判定
    determination = determine_closure_type(close_time, pipe.length, a)
    closure_type = determination.closure_type

    if closure_type == "numerical_required":
        warnings.append(
            f"tν ({close_time}s) ≦ L/300 ({pipe.length / 300:.3f}s) "
            "のため数値解析が必要です"
        )

    # 3. 計算実行
    delta_h_joukowsky: float | None = None
    hmax_allievi_close: float | None = None
    hmax_allievi_open: float | None = None
    k1: float | None = None
    allievi_applicable: bool | None = None

    if closure_type == "rapid":
        # ジューコフスキーの式（閉操作: ΔV = -V₀）
        delta_h_joukowsky = joukowsky(a, -case.initial_velocity)
    elif closure_type == "slow":
        # アリエビの近似式
        allievi_applicable = close_time > pipe.length / 300
        k1 = calc_allievi_k1(
            pipe.length, case.initial_velocity, case.initial_head, close_time
        )
        hmax_allievi_close = allievi_close(case.initial_head, k1)
        hmax_allievi_open = allievi_open(case.initial_head, k1)

        if not allievi_applicable:
            warnings.append(
                "アリエビ式の適用条件 (tν > L/300) を満たしません。数値解析を推奨します。"
            )

    # 4. 負圧チェック
    if hmax_allievi_open is not None and hmax_allievi_open < 0:
        min_head = case.initial_head + hmax_allievi_open
        if min_head < 0:
            warnings.append(
                f"負圧が発生する可能性があります"
                f"（最小水頭: {min_head:.2f} m）。対策施設を検討してください。"
            )

    return SimpleFormulaResult(
        case_id=case.id,
        pipe_id=pipe.id,
        wave_speed=WaveSpeedResult(wave_speed=a, vibration_period=t0, alpha=alpha),
        closure_type=closure_type,
        delta_h_joukowsky=delta_h_joukowsky,
        hmax_allievi_close=hmax_allievi_close,
        hmax_allievi_open=hmax_allievi_open,
        k1=k1,
        allievi_applicable=allievi_applicable,
        warnings=warnings,
    )
