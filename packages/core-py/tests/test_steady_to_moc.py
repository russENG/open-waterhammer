"""定常→非定常 接続テスト."""

from open_waterhammer import (
    LongitudinalHydraulicInput,
    MeasurementPoint,
    PumpBC,
    ReservoirBC,
    ValveBC,
)
from open_waterhammer.longitudinal_hydraulic import calc_longitudinal_hydraulic
from open_waterhammer.moc import run_moc
from open_waterhammer.steady_to_moc import (
    PipeMaterialSpec,
    SteadyToMocInput,
    build_moc_from_steady,
    build_pump_upstream_bc,
)


# ─── テストデータ ────────────────────────────────────────────────────────────

# 3測点、直列、同一管径
POINTS_3 = [
    MeasurementPoint(
        id="P1",
        horizontal_distance=0,
        ground_level=100,
        pipe_center_height=98.5,
        pipe_length=500,
        flow_rate=0.1,
        diameter=0.3,
        roughness_c=130,
        bend_loss_coeff=0,
        valve_loss_coeff=0,
        branch_loss_coeff=0,
    ),
    MeasurementPoint(
        id="P2",
        horizontal_distance=500,
        ground_level=95,
        pipe_center_height=93.5,
        pipe_length=500,
        flow_rate=0.1,
        diameter=0.3,
        roughness_c=130,
        bend_loss_coeff=0.1,
        valve_loss_coeff=0,
        branch_loss_coeff=0,
    ),
    MeasurementPoint(
        id="P3",
        horizontal_distance=1000,
        ground_level=90,
        pipe_center_height=88.5,
        pipe_length=500,
        flow_rate=0.1,
        diameter=0.3,
        roughness_c=130,
        bend_loss_coeff=0,
        valve_loss_coeff=0.5,
        branch_loss_coeff=0,
    ),
]

# 4測点、2管径
POINTS_MULTI_D = [
    MeasurementPoint(
        id="A",
        horizontal_distance=0,
        ground_level=100,
        pipe_center_height=98.5,
        pipe_length=300,
        flow_rate=0.15,
        diameter=0.4,
        roughness_c=130,
        bend_loss_coeff=0,
        valve_loss_coeff=0,
        branch_loss_coeff=0,
    ),
    MeasurementPoint(
        id="B",
        horizontal_distance=300,
        ground_level=97,
        pipe_center_height=95.5,
        pipe_length=300,
        flow_rate=0.15,
        diameter=0.4,
        roughness_c=130,
        bend_loss_coeff=0,
        valve_loss_coeff=0,
        branch_loss_coeff=0,
    ),
    MeasurementPoint(
        id="C",
        horizontal_distance=600,
        ground_level=94,
        pipe_center_height=92.5,
        pipe_length=400,
        flow_rate=0.15,
        diameter=0.3,
        roughness_c=130,
        bend_loss_coeff=0,
        valve_loss_coeff=0,
        branch_loss_coeff=0,
    ),
    MeasurementPoint(
        id="D",
        horizontal_distance=1000,
        ground_level=90,
        pipe_center_height=88.5,
        pipe_length=400,
        flow_rate=0.15,
        diameter=0.3,
        roughness_c=130,
        bend_loss_coeff=0,
        valve_loss_coeff=0,
        branch_loss_coeff=0,
    ),
]


# ─── 基本変換 ────────────────────────────────────────────────────────────────


class TestBuildMocBasic:
    def setup_method(self):
        hy = calc_longitudinal_hydraulic(
            LongitudinalHydraulicInput(
                points=POINTS_3, static_water_level=110, case_name="テスト"
            )
        )
        self.moc_output = build_moc_from_steady(
            SteadyToMocInput(
                hydraulic_result=hy,
                points=POINTS_3,
                material=PipeMaterialSpec(pipe_type="ductile_iron"),
            )
        )

    def test_segment_count_one_for_uniform_diameter(self):
        assert self.moc_output.summary.segment_count == 1

    def test_pipe_count_one(self):
        assert len(self.moc_output.network.pipes) == 1

    def test_upstream_is_reservoir(self):
        up_bc = self.moc_output.network.nodes["node_0"]
        assert isinstance(up_bc, ReservoirBC)
        assert up_bc.head == 110

    def test_downstream_is_valve(self):
        dn_bc = self.moc_output.network.nodes["node_1"]
        assert isinstance(dn_bc, ValveBC)

    def test_initial_flow_matches_steady(self):
        assert self.moc_output.summary.initial_flow == 0.1

    def test_wave_speed_positive(self):
        assert self.moc_output.summary.representative_wave_speed > 0

    def test_vibration_period_positive(self):
        assert self.moc_output.summary.vibration_period > 0

    def test_total_length_positive(self):
        assert self.moc_output.summary.total_length > 0


# ─── 管径変化でセグメント分割 ────────────────────────────────────────────────


class TestBuildMocMultiDiameter:
    def setup_method(self):
        hy = calc_longitudinal_hydraulic(
            LongitudinalHydraulicInput(
                points=POINTS_MULTI_D, static_water_level=115, case_name="多口径テスト"
            )
        )
        self.moc_output = build_moc_from_steady(
            SteadyToMocInput(
                hydraulic_result=hy,
                points=POINTS_MULTI_D,
                material=PipeMaterialSpec(pipe_type="ductile_iron"),
            )
        )

    def test_two_segments(self):
        assert self.moc_output.summary.segment_count == 2

    def test_pipe_diameters_correct(self):
        assert self.moc_output.network.pipes[0].pipe.inner_diameter == 0.4
        assert self.moc_output.network.pipes[1].pipe.inner_diameter == 0.3

    def test_internal_node_no_bc(self):
        """内部ノード(node_1)にはBCが設定されない（連続条件）."""
        assert "node_1" not in self.moc_output.network.nodes


# ─── カスタムBC ──────────────────────────────────────────────────────────────


class TestCustomBC:
    def setup_method(self):
        self.hy = calc_longitudinal_hydraulic(
            LongitudinalHydraulicInput(points=POINTS_3, static_water_level=110)
        )

    def test_valve_close_time_specified(self):
        moc_output = build_moc_from_steady(
            SteadyToMocInput(
                hydraulic_result=self.hy,
                points=POINTS_3,
                material=PipeMaterialSpec(pipe_type="ductile_iron"),
                valve_close_time=5.0,
            )
        )
        dn_bc = moc_output.network.nodes["node_1"]
        assert isinstance(dn_bc, ValveBC)
        assert dn_bc.close_time == 5.0

    def test_pump_upstream_bc(self):
        pump_bc = build_pump_upstream_bc(q0=0.1, pump_head=50, shutdown_time=0)
        moc_output = build_moc_from_steady(
            SteadyToMocInput(
                hydraulic_result=self.hy,
                points=POINTS_3,
                material=PipeMaterialSpec(pipe_type="ductile_iron"),
                upstream_bc=pump_bc,
            )
        )
        up_bc = moc_output.network.nodes["node_0"]
        assert isinstance(up_bc, PumpBC)


# ─── 一気通貫 ────────────────────────────────────────────────────────────────


class TestEndToEnd:
    def test_steady_to_moc_full_pipeline(self):
        hy = calc_longitudinal_hydraulic(
            LongitudinalHydraulicInput(
                points=POINTS_3, static_water_level=110, case_name="一気通貫テスト"
            )
        )
        output = build_moc_from_steady(
            SteadyToMocInput(
                hydraulic_result=hy,
                points=POINTS_3,
                material=PipeMaterialSpec(pipe_type="ductile_iron"),
                valve_close_time=1.0,
                t_max=10,
            )
        )
        moc_result = run_moc(output.network, output.options)

        assert moc_result is not None
        assert "seg_0" in moc_result.pipes

        # 包絡線Hmaxが初期水頭を超える（水撃発生）
        pipe_result = moc_result.pipes["seg_0"]
        h0 = hy.static_water_level
        hmax = max(pipe_result.Hmax)
        assert hmax > h0, f"Hmax={hmax} should exceed H0={h0}"

        # 下流端の水頭時系列が記録されている
        dn_node = moc_result.nodes["node_1"]
        assert len(dn_node.H) > 0
