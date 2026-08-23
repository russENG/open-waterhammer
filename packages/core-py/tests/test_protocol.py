import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path

import pytest

from open_waterhammer.protocol import (
    PROTOCOL_VERSION,
    ProtocolError,
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
    canonical_input = json.dumps(
        {
            "kind": calculation_request["kind"],
            "model": calculation_request["model"],
            "scenario": calculation_request["scenario"],
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")

    assert response["inputHash"] == hashlib.sha256(canonical_input).hexdigest()
    assert math.isclose(response["result"]["summary"]["waveSpeed"], 1212.579306278724, rel_tol=1e-12)
    assert math.isclose(response["result"]["summary"]["vibrationPeriod"], 0.3298753309814903, rel_tol=1e-12)


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
