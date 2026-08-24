import json
import math
import subprocess
import sys
from pathlib import Path

import pytest

from open_waterhammer.formulas import judge_design_pressure
from open_waterhammer.protocol import (
    PROTOCOL_VERSION,
    ProtocolError,
    _canonical_input,
    execute_request,
    run_protocol_json,
)


PIPE = {
    "id": "P-1",
    "startNodeId": "R",
    "endNodeId": "D",
    "pipeType": "ductile_iron",
    "innerDiameter": 0.3,
    "wallThickness": 0.01,
    "length": 100.0,
    "roughnessCoeff": 130.0,
}
CORE_PY_ROOT = Path(__file__).resolve().parents[1]


def scenario(event_settings=None, protection_settings=None):
    return {
        "boundaryConditions": {},
        "eventSettings": event_settings or {},
        "protectionSettings": protection_settings or {},
    }


def request(kind, model, scenario_input=None):
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "kind": kind,
        "model": model,
        "scenario": scenario_input or scenario(),
    }


def transient_network_model():
    return {
        "network": {
            "pipes": [{
                "id": "segment-1",
                "pipe": PIPE,
                "nReaches": 2,
                "upstreamNodeId": "R",
                "downstreamNodeId": "D",
                "initialFlow": 0.01,
            }],
            "nodes": {
                "R": {"type": "reservoir", "head": 120.0},
                "D": {"type": "valve", "Q0": 0.01, "H0v": 119.0, "closeTime": 0.02},
            },
        },
        "options": {"tMax": 0.05, "initialFlow": 0.01},
    }


def transient_network_with_junction_model():
    """R --segment-1-- J --segment-2-- D: a junction node sits between the reservoir and
    the closing valve, so a protection device at J mitigates the valve's own transient
    instead of replacing it (Task 4b-2 fix round 1 — devices may not target event-carrying
    valve/pump nodes). Pipe lengths/closeTime/tMax are chosen (not the tiny transient_network_model
    scale) so the junction device has enough time to meaningfully decouple the reservoir side
    from the valve side — verified to produce a robust, unambiguous reduction."""
    return {
        "network": {
            "pipes": [
                {
                    "id": "segment-1",
                    "pipe": {**PIPE, "id": "segment-1", "length": 400.0},
                    "nReaches": 8,
                    "upstreamNodeId": "R",
                    "downstreamNodeId": "J",
                    "initialFlow": 0.01,
                },
                {
                    "id": "segment-2",
                    "pipe": {**PIPE, "id": "segment-2", "length": 100.0},
                    "nReaches": 2,
                    "upstreamNodeId": "J",
                    "downstreamNodeId": "D",
                    "initialFlow": 0.01,
                },
            ],
            "nodes": {
                "R": {"type": "reservoir", "head": 120.0},
                "J": {"type": "junction"},
                "D": {"type": "valve", "Q0": 0.01, "H0v": 119.0, "closeTime": 2.0},
            },
        },
        "options": {"tMax": 8.0, "initialFlow": 0.01},
    }


def requests_by_kind():
    point = {
        "id": "IP.1",
        "horizontalDistance": 0.0,
        "groundLevel": 100.0,
        "pipeCenterHeight": 99.0,
        "pipeLength": 10.0,
        "flowRate": 0.01,
        "diameter": 0.3,
        "roughnessC": 130.0,
        "bendLossCoeff": 0.0,
        "valveLossCoeff": 0.0,
        "branchLossCoeff": 0.0,
    }
    steady_network = {
        "pipes": [{
            "id": "P-1",
            "upstreamNodeId": "R",
            "downstreamNodeId": "D",
            "innerDiameter": 0.3,
            "length": 100.0,
            "roughnessC": 130.0,
        }],
        "nodes": [
            {"id": "R", "elevation": 100.0, "type": "reservoir", "head": 120.0},
            {"id": "D", "elevation": 90.0, "type": "demand", "demand": 0.01},
        ],
    }
    return {
        "wave_speed": request("wave_speed", {"pipe": PIPE}, scenario({"closeTime": 2.0})),
        "joukowsky_allievi": request(
            "joukowsky_allievi",
            {"pipe": PIPE, "calculationCase": {
                "id": "case-1",
                "name": "Valve close",
                "operationType": "valve_close",
                "targetFacilityId": "V-1",
                "initialVelocity": 1.0,
                "initialHead": 50.0,
            }},
            scenario({"closeTime": 0.01}),
        ),
        "empirical_pressure": request("empirical_pressure", {
            "systemType": "gravity_open",
            "staticPressureMpa": 0.2,
            "hydraulicGradePressureMpa": 0.3,
        }),
        "steady_single_pipe": request("steady_single_pipe", {
            "method": "hazen-williams",
            "innerDiameter": 0.3,
            "length": 100.0,
            "flowRate": 0.01,
            "upstreamElevation": 100.0,
            "downstreamElevation": 90.0,
            "roughnessC": 130.0,
        }),
        "steady_network_python": request("steady_network_python", steady_network),
        "longitudinal_hydraulics": request("longitudinal_hydraulics", {
            "points": [point],
            "staticWaterLevel": 120.0,
            "waterhammerPressureMpa": 0.2,
            "caseName": "Golden",
        }),
        "transient_single_pipe": request(
            "transient_single_pipe",
            {"pipe": PIPE},
            scenario({
                "waveSpeed": 1000.0,
                "initialVelocity": 0.1,
                "initialDownstreamHead": 119.0,
                "closeTime": 0.02,
                "nReaches": 2,
                "tMax": 0.05,
            }),
        ),
        "transient_network": request("transient_network", transient_network_model()),
        "transient_pump": request(
            "transient_pump",
            {"pipe": PIPE},
            scenario({
                "mode": "trip",
                "waveSpeed": 1000.0,
                "Q0": 0.01,
                "pumpHead": 20.0,
                "shutdownTime": 0.02,
                "nReaches": 2,
                "tMax": 0.05,
            }),
        ),
        "transient_protection_device": request(
            "transient_protection_device",
            transient_network_model(),
            scenario(protection_settings={"device": "valve"}),
        ),
    }


@pytest.mark.parametrize("kind", list(requests_by_kind()))
def test_executes_each_python_run_kind_with_a_structured_result(kind):
    response = execute_request(requests_by_kind()[kind])

    assert response["protocolVersion"] == 1
    assert response["ok"] is True
    assert len(response["inputHash"]) == 64
    assert response["result"]["method"]
    assert isinstance(response["result"]["summary"], dict)
    assert response["result"]["assessment"] == {
        "status": "needs_review",
        "findings": [],
    }


def test_wave_speed_hash_and_numeric_result_are_canonical_and_hand_checkable():
    calculation_request = requests_by_kind()["wave_speed"]
    response = execute_request(calculation_request)

    assert response["inputHash"] == "10835479684f1b9eea1921ee1502c44047d700bbd683fbcd09b6b8ba30a9d342"
    assert math.isclose(response["result"]["summary"]["waveSpeed"], 1212.579306278724, rel_tol=1e-12)
    assert math.isclose(response["result"]["summary"]["vibrationPeriod"], 0.3298753309814903, rel_tol=1e-12)


def test_empirical_protocol_rejects_an_unknown_system_type_before_formula_output():
    calculation_request = request("empirical_pressure", {
        "systemType": "natural",
        "staticPressureMpa": 0.42,
    })

    with pytest.raises(ProtocolError, match="Unsupported pipeline system type") as invalid:
        execute_request(calculation_request)
    assert invalid.value.code == "INVALID_INPUT"


def test_canonical_input_uses_ecmascript_number_spelling_at_exponent_boundaries():
    canonical_input = _canonical_input(
        "wave_speed",
        {
            "smallPlain": 0.00001,
            "smallBoundary": 0.000001,
            "smallExponent": 1e-7,
            "largePlain": 1e20,
            "largeExponent": 1e21,
        },
        {},
    )

    assert canonical_input == (
        b'{"kind":"wave_speed","model":{"largeExponent":1e+21,'
        b'"largePlain":100000000000000000000,"smallBoundary":0.000001,'
        b'"smallExponent":1e-7,"smallPlain":0.00001},"scenario":{}}'
    )


def test_native_python_steady_network_matches_the_reference_method_tolerance():
    response = execute_request(requests_by_kind()["steady_network_python"])
    summary = response["result"]["summary"]

    assert summary["pipeResults"][0]["flow"] == 0.01
    assert math.isclose(summary["pipeResults"][0]["velocity"], 0.1414710605261292, rel_tol=1e-12)
    assert math.isclose(summary["nodeResults"][1]["head"], 119.9909524023505, abs_tol=1e-12)


def test_native_steady_network_keeps_reference_zero_floor_for_all_negative_pressure_heads():
    network_request = requests_by_kind()["steady_network_python"]
    for node in network_request["model"]["nodes"]:
        node["elevation"] = 200.0
    network_request["model"]["nodes"][0]["head"] = 100.0

    summary = execute_request(network_request)["result"]["summary"]

    assert all(node["pressureHead"] < 0 for node in summary["nodeResults"])
    assert summary["maxPressureHead"] == 0.0


def test_transient_protocol_preserves_user_defined_pipe_and_node_ids_verbatim():
    network_request = requests_by_kind()["transient_network"]
    network = network_request["model"]["network"]
    network["pipes"][0]["id"] = "pipe_one"
    network["pipes"][0]["upstreamNodeId"] = "node_up"
    network["pipes"][0]["downstreamNodeId"] = "node_down"
    network["nodes"] = {
        "node_up": {"type": "reservoir", "head": 120.0},
        "node_down": {"type": "valve", "Q0": 0.01, "H0v": 119.0, "closeTime": 0.02},
    }

    result = execute_request(network_request)["result"]

    assert set(result["summary"]["pipes"]) == {"pipe_one"}
    assert set(result["timeSeries"]["pipes"]) == {"pipe_one"}
    assert set(result["timeSeries"]["nodes"]) == {"node_up", "node_down"}


# ─── 防護設備 baseline / protected 実行 (Task 4b-2) ───────────────────────────


def _worst_hmax(pipes_summary):
    return max(pipe["hmax"] for pipe in pipes_summary.values())


def test_transient_protection_device_runs_baseline_and_protected_networks_and_reports_reduction():
    # Device targets J, the junction between the reservoir and the closing valve D — not the
    # valve itself, per the fix-round-1 ruling: replacing D would delete the transient event
    # (valve closure) the run is meant to analyze.
    protection_request = request(
        "transient_protection_device",
        transient_network_with_junction_model(),
        scenario(protection_settings={
            "devices": [
                {"id": "J", "type": "surge_tank", "enabled": True, "tankArea": 4.0, "initialLevel": 119.5},
            ],
        }),
    )

    result = execute_request(protection_request)["result"]
    protection = result["summary"]["protection"]

    worst_baseline = _worst_hmax(protection["baseline"]["pipes"])
    worst_protected = _worst_hmax(protection["protected"]["pipes"])

    # Proves the metric measures mitigation of a real event, not "no event": the baseline
    # (plain junction, no device) must itself show a genuine transient rise above the
    # reservoir's steady head (120.0) from the valve closing at D.
    assert worst_baseline > 120.0
    assert worst_protected < worst_baseline
    assert protection["reductionRate"] > 0
    assert math.isclose(
        protection["reductionRate"],
        (worst_baseline - worst_protected) / worst_baseline,
        rel_tol=1e-12,
    )


def test_transient_protection_device_rejects_a_device_targeting_an_event_carrying_valve_node():
    # D is a valve (carries the closure event) in the plain transient_network fixture — a
    # device may not replace it, per the fix-round-1 controller ruling.
    network_request = requests_by_kind()["transient_network"]
    protection_request = request(
        "transient_protection_device",
        network_request["model"],
        scenario(protection_settings={
            "devices": [
                {"id": "D", "type": "surge_tank", "enabled": True, "tankArea": 4.0, "initialLevel": 119.0},
            ],
        }),
    )

    with pytest.raises(ProtocolError, match=r"event-carrying node \(valve/pump\): D") as invalid:
        execute_request(protection_request)
    assert invalid.value.code == "INVALID_INPUT"


def test_transient_protection_device_rejects_a_device_targeting_an_unknown_node():
    network_request = requests_by_kind()["transient_network"]
    protection_request = request(
        "transient_protection_device",
        network_request["model"],
        scenario(protection_settings={
            "devices": [
                {"id": "NO-SUCH-NODE", "type": "surge_tank", "enabled": True, "tankArea": 4.0, "initialLevel": 119.0},
            ],
        }),
    )

    with pytest.raises(ProtocolError, match="NO-SUCH-NODE") as invalid:
        execute_request(protection_request)
    assert invalid.value.code == "INVALID_INPUT"


def test_transient_protection_device_with_no_enabled_devices_matches_plain_network_output_exactly():
    network_request = requests_by_kind()["transient_network"]
    plain_result = execute_request(request("transient_network", network_request["model"]))["result"]

    disabled_request = request(
        "transient_protection_device",
        network_request["model"],
        scenario(protection_settings={
            "devices": [
                {"id": "D", "type": "surge_tank", "enabled": False, "tankArea": 4.0, "initialLevel": 119.0},
            ],
        }),
    )
    disabled_result = execute_request(disabled_request)["result"]
    assert "protection" not in disabled_result["summary"]
    assert disabled_result["summary"] == plain_result["summary"]
    assert disabled_result["timeSeries"] == plain_result["timeSeries"]

    # Regression lock: the file's existing parametric fixture for this kind
    # (protectionSettings={"device": "valve"}, no "devices" list) must keep behaving
    # exactly like _transient_network, unchanged, per test_executes_each_python_run_kind_...
    legacy_result = execute_request(requests_by_kind()["transient_protection_device"])["result"]
    assert "protection" not in legacy_result["summary"]


def test_pyodide_compatible_function_and_cpython_entrypoint_have_golden_parity():
    calculation_request = requests_by_kind()["longitudinal_hydraulics"]
    pyodide_compatible = json.loads(run_protocol_json(json.dumps(calculation_request)))
    completed = subprocess.run(
        [sys.executable, "-m", "open_waterhammer.protocol"],
        input=json.dumps(calculation_request),
        text=True,
        capture_output=True,
        check=False,
        cwd=CORE_PY_ROOT,
    )
    cpython = json.loads(completed.stdout)

    assert completed.returncode == 0
    assert cpython["inputHash"] == pyodide_compatible["inputHash"]
    assert math.isclose(
        cpython["result"]["summary"]["maxDesignPressure"],
        pyodide_compatible["result"]["summary"]["maxDesignPressure"],
        abs_tol=1e-12,
    )


def test_protocol_rejects_unsupported_and_malformed_requests_explicitly():
    with pytest.raises(ProtocolError, match="Unsupported Run kind") as unsupported:
        execute_request(request("steady_network_epanet", {}))
    assert unsupported.value.code == "UNSUPPORTED_RUN_KIND"

    completed = subprocess.run(
        [sys.executable, "-m", "open_waterhammer.protocol"],
        input="{}",
        text=True,
        capture_output=True,
        check=False,
        cwd=CORE_PY_ROOT,
    )
    response = json.loads(completed.stdout)
    assert completed.returncode != 0
    assert response == {
        "protocolVersion": 1,
        "ok": False,
        "error": {
            "code": "INVALID_REQUEST",
            "message": "protocolVersion must be 1",
        },
    }


# ─── 耐圧判定アセスメント (Task 4b-1) ───────────────────────────────────────────


def test_joukowsky_allievi_assessment_fails_when_design_pressure_exceeds_allowable():
    calculation_request = requests_by_kind()["joukowsky_allievi"]
    calculation_request["model"]["allowablePressureMpa"] = 0.9

    result = execute_request(calculation_request)["result"]
    assessment = result["assessment"]

    assert assessment["status"] == "fail"
    assert len(assessment["findings"]) == 1
    finding = assessment["findings"][0]
    assert set(finding.keys()) == {"targetRef", "observedValue", "threshold", "unit", "ruleId"}
    assert finding["targetRef"] == "P-1"
    assert finding["unit"] == "MPa"
    assert finding["threshold"] == 0.9
    assert math.isclose(finding["observedValue"], 1.702579306278724, rel_tol=1e-9)
    assert finding["ruleId"] == "judge_design_pressure/8.3.2"
    expected_message = judge_design_pressure(finding["observedValue"], finding["threshold"]).message
    assert expected_message in result["warnings"]


def test_joukowsky_allievi_assessment_passes_with_a_generous_allowable_pressure():
    calculation_request = requests_by_kind()["joukowsky_allievi"]
    calculation_request["model"]["allowablePressureMpa"] = 2.5

    result = execute_request(calculation_request)["result"]

    assert result["assessment"] == {"status": "pass", "findings": []}
    assert result["warnings"] == []


def test_joukowsky_allievi_assessment_flags_the_warning_band_under_ten_percent_margin():
    calculation_request = requests_by_kind()["joukowsky_allievi"]
    calculation_request["model"]["allowablePressureMpa"] = 1.8

    result = execute_request(calculation_request)["result"]
    assessment = result["assessment"]

    assert assessment["status"] == "warning"
    assert len(assessment["findings"]) == 1
    assert assessment["findings"][0]["unit"] == "MPa"
    expected_message = judge_design_pressure(
        assessment["findings"][0]["observedValue"], assessment["findings"][0]["threshold"]
    ).message
    assert expected_message in result["warnings"]


def test_joukowsky_allievi_assessment_stays_needs_review_for_numerical_required_closure():
    # tν ≦ L/300 の等価閉そく時間では急/緩いずれの近似式も使えない
    # (delta_h_joukowsky も hmax_allievi_close も None) ため、許容圧力が
    # 指定されていても判定不能 = needs_review のままとする。
    calculation_request = requests_by_kind()["joukowsky_allievi"]
    calculation_request["model"]["allowablePressureMpa"] = 5.0
    calculation_request["scenario"]["eventSettings"]["closeTime"] = 0.25

    result = execute_request(calculation_request)["result"]

    assert result["summary"]["closureType"] == "numerical_required"
    assert result["assessment"] == {"status": "needs_review", "findings": []}
    assert any("許容圧力が指定されていますが判定できませんでした" in warning for warning in result["warnings"])


def test_empirical_pressure_assessment_fails_when_design_pressure_exceeds_allowable():
    calculation_request = requests_by_kind()["empirical_pressure"]
    calculation_request["model"]["allowablePressureMpa"] = 0.2

    result = execute_request(calculation_request)["result"]
    assessment = result["assessment"]

    assert assessment["status"] == "fail"
    assert len(assessment["findings"]) == 1
    finding = assessment["findings"][0]
    assert set(finding.keys()) == {"targetRef", "observedValue", "threshold", "unit", "ruleId"}
    assert finding["targetRef"] == "gravity_open"
    assert finding["unit"] == "MPa"
    assert finding["threshold"] == 0.2
    assert math.isclose(finding["observedValue"], 0.26, rel_tol=1e-9)
    expected_message = judge_design_pressure(finding["observedValue"], finding["threshold"]).message
    assert expected_message in result["warnings"]


def test_longitudinal_hydraulics_assessment_locates_the_failing_measurement_point():
    point_1 = {
        "id": "IP.1", "horizontalDistance": 0.0, "groundLevel": 100.0, "pipeCenterHeight": 99.0,
        "pipeLength": 10.0, "flowRate": 0.01, "diameter": 0.3, "roughnessC": 130.0,
        "bendLossCoeff": 0.0, "valveLossCoeff": 0.0, "branchLossCoeff": 0.0,
    }
    point_2 = {
        "id": "IP.2", "horizontalDistance": 100.0, "groundLevel": 40.0, "pipeCenterHeight": 39.0,
        "pipeLength": 10.0, "flowRate": 0.01, "diameter": 0.3, "roughnessC": 130.0,
        "bendLossCoeff": 0.0, "valveLossCoeff": 0.0, "branchLossCoeff": 0.0,
    }
    calculation_request = request("longitudinal_hydraulics", {
        "points": [point_1, point_2],
        "staticWaterLevel": 120.0,
        "waterhammerPressureMpa": 0.2,
        "caseName": "Golden",
        "allowablePressureMpa": 0.75,
    })

    result = execute_request(calculation_request)["result"]
    assessment = result["assessment"]
    point_results = result["summary"]["pointResults"]

    assert assessment["status"] == "fail"
    assert len(assessment["findings"]) == 1
    finding = assessment["findings"][0]
    assert set(finding.keys()) == {"targetRef", "observedValue", "threshold", "unit", "ruleId", "location"}
    assert finding["targetRef"] == "IP.2"
    assert finding["location"] == "IP.2"
    assert finding["location"] == point_results[1]["pointId"]
    assert math.isclose(finding["observedValue"], point_results[1]["designPressure"], rel_tol=1e-12)

    expected_message = judge_design_pressure(point_results[1]["designPressure"], 0.75).message
    assert expected_message in result["warnings"]


def test_longitudinal_hydraulics_assessment_passes_when_every_point_stays_under_the_allowable():
    calculation_request = requests_by_kind()["longitudinal_hydraulics"]
    calculation_request["model"]["allowablePressureMpa"] = 10.0

    result = execute_request(calculation_request)["result"]

    assert result["assessment"] == {"status": "pass", "findings": []}


def test_design_pressure_assessment_kinds_stay_needs_review_when_allowable_pressure_is_absent():
    for kind in ("joukowsky_allievi", "empirical_pressure", "longitudinal_hydraulics"):
        result = execute_request(requests_by_kind()[kind])["result"]
        assert result["assessment"] == {"status": "needs_review", "findings": []}, kind
        # No allowablePressureMpa was supplied at all, so this is the silent default —
        # distinct from "supplied but unusable", which must surface a warning (below).
        assert not any("許容圧力が指定されていますが判定できませんでした" in warning for warning in result["warnings"]), kind


def test_joukowsky_allievi_assessment_surfaces_a_warning_when_the_allowable_pressure_is_negative():
    calculation_request = requests_by_kind()["joukowsky_allievi"]
    calculation_request["model"]["allowablePressureMpa"] = -1.0

    result = execute_request(calculation_request)["result"]

    assert result["assessment"] == {"status": "needs_review", "findings": []}
    assert any("許容圧力が指定されていますが判定できませんでした" in warning for warning in result["warnings"])


def test_empirical_pressure_assessment_surfaces_a_warning_when_the_allowable_pressure_is_not_a_number():
    calculation_request = requests_by_kind()["empirical_pressure"]
    calculation_request["model"]["allowablePressureMpa"] = "not-a-number"

    result = execute_request(calculation_request)["result"]

    assert result["assessment"] == {"status": "needs_review", "findings": []}
    assert any("許容圧力が指定されていますが判定できませんでした" in warning for warning in result["warnings"])


def test_longitudinal_hydraulics_assessment_surfaces_a_warning_when_the_allowable_pressure_is_zero():
    calculation_request = requests_by_kind()["longitudinal_hydraulics"]
    calculation_request["model"]["allowablePressureMpa"] = 0

    result = execute_request(calculation_request)["result"]

    assert result["assessment"] == {"status": "needs_review", "findings": []}
    assert any("許容圧力が指定されていますが判定できませんでした" in warning for warning in result["warnings"])
