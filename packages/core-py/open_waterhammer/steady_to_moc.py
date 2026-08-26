"""定常→非定常 接続モジュール.

縦断水理計算（定常）の結果を、特性曲線法（MOC）の初期条件に変換する.
要旨 §3.2(2): 定常計算部の結果から非定常解析の初期条件を与える.
"""

from dataclasses import dataclass, field

from .formulas import calc_wave_speed
from .moc import (
    BoundaryCondition,
    MocNetwork,
    MocOptions,
    MocPipeSegment,
    PumpBC,
    ReservoirBC,
    ValveBC,
)
from .types import (
    LongitudinalHydraulicResult,
    MeasurementPoint,
    MeasurementPointResult,
    Pipe,
    PipeType,
)


# ─── 入力型 ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class PipeMaterialSpec:
    """管種・管厚の指定（全区間共通）."""

    pipe_type: PipeType
    wall_thickness: float | None = None  # 省略時は内径の 1/20 で仮定
    youngs_modulus: float | None = None  # 省略時は管種から自動参照


@dataclass
class SteadyToMocInput:
    """定常→MOC 変換の入力."""

    hydraulic_result: LongitudinalHydraulicResult
    points: list[MeasurementPoint]
    material: PipeMaterialSpec
    upstream_bc: BoundaryCondition | None = None
    downstream_bc: BoundaryCondition | None = None
    valve_close_time: float | None = None
    n_reaches: int = 10
    t_max: float | None = None


@dataclass
class SteadyToMocSummary:
    segment_count: int
    total_length: float
    initial_flow: float
    upstream_head: float
    representative_wave_speed: float
    vibration_period: float


@dataclass
class SteadyToMocOutput:
    network: MocNetwork
    options: MocOptions
    summary: SteadyToMocSummary


# ─── 内部ヘルパー ────────────────────────────────────────────────────────────


@dataclass
class _SegmentDraft:
    id: str
    pipe: Pipe
    wave_speed: float
    n_reaches: int
    # 区間の上流端・下流端の管中心高 FH [m]（issue #50: 水柱分離の判定に使う）
    upstream_elevation: float
    downstream_elevation: float
    initial_flow: float | None = None


def _group_into_segments(
    points: list[MeasurementPoint],
    results: list[MeasurementPointResult],
    material: PipeMaterialSpec,
    n_reaches: int,
) -> list[_SegmentDraft]:
    """測点列を管径の変化点でグループ化し、MOCセグメントを生成."""
    segments: list[_SegmentDraft] = []
    seg_start = 0

    for i in range(1, len(points) + 1):
        # 管径変化点またはリストの終端でセグメントを区切る
        diameter_changed = i < len(points) and abs(points[i].diameter - points[seg_start].diameter) > 0.0001
        is_end = i == len(points)

        if diameter_changed or is_end:
            end_idx = i - 1
            seg_points = points[seg_start : end_idx + 1]
            diameter = points[seg_start].diameter
            roughness_c = points[seg_start].roughness_c
            wall_thickness = (
                material.wall_thickness
                if material.wall_thickness is not None
                else diameter / 20
            )

            # 区間の管路延長 = 各測点の管長の合計（最初の測点を除く）
            seg_length = 0.0
            for j, pt in enumerate(seg_points):
                if j == 0 and seg_start == 0:
                    continue  # 最初の測点は始点
                seg_length += pt.pipe_length

            length = seg_length if seg_length > 0 else seg_points[0].pipe_length

            pipe = Pipe(
                id=f"seg_{len(segments)}",
                start_node_id="",
                end_node_id="",
                pipe_type=material.pipe_type,
                inner_diameter=diameter,
                wall_thickness=wall_thickness,
                length=length,
                roughness_coeff=roughness_c,
                youngs_modulus=material.youngs_modulus,
            )

            wave_speed = calc_wave_speed(pipe)

            segments.append(
                _SegmentDraft(
                    id=f"seg_{len(segments)}",
                    pipe=pipe,
                    wave_speed=wave_speed,
                    n_reaches=n_reaches,
                    # 測点の管中心高をそのまま渡す。これが無いと MOC 側は基準面 0 m で
                    # 水柱分離を判定してしまい、標高差のある管路で判定を誤る（issue #50）。
                    #
                    # 測点の pipe_length は「前測点からこの測点まで」なので、上の区間長と
                    # 同じく、区間の物理的な始点は 1 つ前の測点になる（先頭区間だけは自分
                    # 自身が始点）。ここを seg_points[0] にすると境目で管中心高が飛ぶ。
                    upstream_elevation=points[0 if seg_start == 0 else seg_start - 1].pipe_center_height,
                    downstream_elevation=seg_points[-1].pipe_center_height,
                    initial_flow=points[seg_start].flow_rate,
                )
            )

            if diameter_changed:
                seg_start = i

    return segments


def _build_default_valve_bc(
    q0: float,
    h0v: float,
    close_time: float | None,
    vibration_period: float,
) -> ValveBC:
    """デフォルトのバルブBC（下流端閉鎖）を生成.

    閉鎖時間が未指定の場合は振動周期の半分（瞬時閉に近い条件）.
    """
    return ValveBC(
        Q0=q0,
        H0v=h0v,
        close_time=close_time if close_time is not None else vibration_period / 2,
        operation="close",
    )


# ─── メイン変換ロジック ──────────────────────────────────────────────────────


def build_moc_from_steady(input_data: SteadyToMocInput) -> SteadyToMocOutput:
    """縦断水理計算結果をMOCネットワークに変換.

    連続する測点を、管径が同一の区間ごとにグループ化して
    MOC管路セグメントとする。各セグメントの初期流量・初期水頭は
    定常計算の結果から設定する.
    """
    hydraulic_result = input_data.hydraulic_result
    points = input_data.points
    material = input_data.material
    n_reaches = input_data.n_reaches
    t_max = input_data.t_max

    results = hydraulic_result.point_results
    if len(points) < 2 or len(results) < 2:
        raise ValueError("MOC変換には2測点以上が必要です")
    if len(points) != len(results):
        raise ValueError("測点数と結果数が一致しません")

    # 管径が同一の連続測点をグループ化してセグメントにする
    segments = _group_into_segments(points, results, material, n_reaches)

    # 初期流量（最初の測点の流量）
    q0 = points[0].flow_rate

    # 上流端水頭 = 静水位
    upstream_head = hydraulic_result.static_water_level

    # 代表波速（最初のセグメントの値）
    representative_wave_speed = segments[0].wave_speed

    # 全管路延長
    total_length = sum(s.pipe.length for s in segments)

    # 振動周期
    vibration_period = 4 * total_length / representative_wave_speed

    # 境界条件
    upstream_node_id = "node_0"
    downstream_node_id = f"node_{len(segments)}"

    upstream_bc: BoundaryCondition = (
        input_data.upstream_bc
        if input_data.upstream_bc is not None
        else ReservoirBC(head=upstream_head)
    )

    downstream_bc: BoundaryCondition = (
        input_data.downstream_bc
        if input_data.downstream_bc is not None
        else _build_default_valve_bc(
            q0=q0,
            h0v=results[-1].hydraulic_grade_line,
            close_time=input_data.valve_close_time,
            vibration_period=vibration_period,
        )
    )

    # ノードIDを付与
    moc_pipes: list[MocPipeSegment] = []
    for i, seg in enumerate(segments):
        moc_pipes.append(
            MocPipeSegment(
                id=seg.id,
                pipe=seg.pipe,
                wave_speed=seg.wave_speed,
                n_reaches=seg.n_reaches,
                upstream_node_id=f"node_{i}",
                downstream_node_id=f"node_{i + 1}",
                initial_flow=seg.initial_flow,
                upstream_elevation=seg.upstream_elevation,
                downstream_elevation=seg.downstream_elevation,
            )
        )

    nodes: dict[str, BoundaryCondition] = {
        upstream_node_id: upstream_bc,
        downstream_node_id: downstream_bc,
    }

    network = MocNetwork(pipes=moc_pipes, nodes=nodes)

    options = MocOptions(
        t_max=t_max,
        initial_flow=q0,
    )

    return SteadyToMocOutput(
        network=network,
        options=options,
        summary=SteadyToMocSummary(
            segment_count=len(segments),
            total_length=total_length,
            initial_flow=q0,
            upstream_head=upstream_head,
            representative_wave_speed=representative_wave_speed,
            vibration_period=vibration_period,
        ),
    )


def build_pump_upstream_bc(
    *,
    q0: float,
    pump_head: float,
    Hs: float | None = None,
    GD2: float | None = None,
    N0: float | None = None,
    eta0: float | None = None,
    shutdown_time: float = 0.0,
    check_valve: bool = True,
) -> PumpBC:
    """ポンプ圧送系用: 上流BCをポンプに変更するヘルパー."""
    return PumpBC(
        Q0=q0,
        H0=pump_head,
        Hs=Hs,
        GD2=GD2,
        N0=N0,
        eta0=eta0,
        shutdown_time=shutdown_time,
        check_valve=check_valve,
        mode="trip",
    )
