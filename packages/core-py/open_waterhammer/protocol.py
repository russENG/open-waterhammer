"""Structured JSON protocol shared by CPython and Pyodide calculation paths."""

from __future__ import annotations

import hashlib
import json
import math
import platform
import sys
from dataclasses import asdict, is_dataclass
from typing import Any, Callable

from .formulas import calc_empirical_waterhammer, calc_vibration_period, calc_wave_speed
from .longitudinal_hydraulic import calc_longitudinal_hydraulic
from .moc import (
    AirChamberBC,
    AirReleaseValveBC,
    DeadEndBC,
    MocNetwork,
    MocOptions,
    MocPipeSegment,
    PressureReducingValveBC,
    PumpBC,
    PumpStartInput,
    PumpTripInput,
    ReservoirBC,
    SinglePipeMocInput,
    SurgeTankBC,
    ValveBC,
    run_moc,
    run_moc_pump_start,
    run_moc_pump_trip,
    run_moc_single_pipe,
)
from .simple_calculation import run_simple_formula
from .steady_flow import calc_darcy_weisbach, calc_hazen_williams
from .steady_network import (
    NetworkNodeDef,
    NetworkPipeDef,
    SteadyNetworkInput,
    calc_steady_network,
)
from .types import CalculationCase, LongitudinalHydraulicInput, MeasurementPoint, Pipe

PROTOCOL_VERSION = 1
class ProtocolError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _required(mapping: dict[str, Any], key: str) -> Any:
    if key not in mapping:
        raise ProtocolError("INVALID_INPUT", f"Missing required field: {key}")
    return mapping[key]


def _pipe(value: dict[str, Any]) -> Pipe:
    return Pipe(
        id=_required(value, "id"),
        start_node_id=value.get("startNodeId", ""),
        end_node_id=value.get("endNodeId", ""),
        pipe_type=_required(value, "pipeType"),
        inner_diameter=_required(value, "innerDiameter"),
        wall_thickness=_required(value, "wallThickness"),
        length=_required(value, "length"),
        roughness_coeff=_required(value, "roughnessCoeff"),
        name=value.get("name"),
        youngs_modulus=value.get("youngsModulus"),
        c1_coeff=value.get("c1Coeff"),
    )


def _camel_key(key: str) -> str:
    special = {
        "H_steady": "H_steady",
        "Hmax": "Hmax",
        "Hmin": "Hmin",
        "Q": "Q",
        "H": "H",
        "N": "N",
        "V_air": "V_air",
    }
    if key in special:
        return special[key]
    parts = key.split("_")
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


def _json_value(value: Any) -> Any:
    if is_dataclass(value):
        value = asdict(value)
    if isinstance(value, dict):
        return {_camel_key(str(key)): _json_value(child) for key, child in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(child) for child in value]
    return value


def _result(
    method: str,
    model: dict[str, Any],
    scenario: dict[str, Any],
    summary: dict[str, Any],
    warnings: list[str] | None = None,
    time_series: dict[str, Any] | None = None,
) -> dict[str, Any]:
    output = {
        "method": method,
        "numericParameters": model,
        "boundaryParameters": scenario,
        "summary": summary,
        "assessment": {"status": "needs_review", "findings": []},
        "warnings": warnings or [],
    }
    if time_series is not None:
        output["timeSeries"] = time_series
    return output


def _wave_speed(model: dict[str, Any], scenario: dict[str, Any]) -> dict[str, Any]:
    pipe = _pipe(_required(model, "pipe"))
    wave_speed = calc_wave_speed(pipe)
    close_time = scenario["eventSettings"].get("closeTime", 0.0)
    summary = {
        "waveSpeed": wave_speed,
        "vibrationPeriod": calc_vibration_period(pipe.length, wave_speed),
        "alpha": close_time / calc_vibration_period(pipe.length, wave_speed),
    }
    return _result("wave-speed", model, scenario, summary)


def _joukowsky_allievi(model: dict[str, Any], scenario: dict[str, Any]) -> dict[str, Any]:
    case_value = _required(model, "calculationCase")
    calculation_case = CalculationCase(
        id=_required(case_value, "id"),
        name=_required(case_value, "name"),
        operation_type=_required(case_value, "operationType"),
        target_facility_id=_required(case_value, "targetFacilityId"),
        initial_velocity=_required(case_value, "initialVelocity"),
        initial_head=_required(case_value, "initialHead"),
        description=case_value.get("description"),
    )
    output = run_simple_formula(
        _pipe(_required(model, "pipe")),
        calculation_case,
        _required(scenario["eventSettings"], "closeTime"),
    )
    summary = _json_value(output)
    return _result("joukowsky-allievi", model, scenario, summary, output.warnings)


def _empirical_pressure(model: dict[str, Any], scenario: dict[str, Any]) -> dict[str, Any]:
    output = calc_empirical_waterhammer(
        _required(model, "systemType"),
        _required(model, "staticPressureMpa"),
        model.get("operatingPressureMpa"),
        model.get("hydraulicGradePressureMpa"),
    )
    return _result("empirical-pressure", model, scenario, _json_value(output), output.warnings)


def _steady_single_pipe(model: dict[str, Any], scenario: dict[str, Any]) -> dict[str, Any]:
    common = (
        _required(model, "innerDiameter"),
        _required(model, "length"),
        _required(model, "flowRate"),
        _required(model, "upstreamElevation"),
        _required(model, "downstreamElevation"),
    )
    method = model.get("method", "hazen-williams")
    if method == "hazen-williams":
        output = calc_hazen_williams(*common, _required(model, "roughnessC"))
    elif method == "darcy-weisbach":
        output = calc_darcy_weisbach(*common, _required(model, "frictionFactor"))
    else:
        raise ProtocolError("INVALID_INPUT", f"Unsupported steady method: {method}")
    return _result(output.method, model, scenario, _json_value(output), output.warnings)


def _steady_network(model: dict[str, Any], scenario: dict[str, Any]) -> dict[str, Any]:
    pipes = [
        NetworkPipeDef(
            id=_required(value, "id"),
            upstream_node_id=_required(value, "upstreamNodeId"),
            downstream_node_id=_required(value, "downstreamNodeId"),
            inner_diameter=_required(value, "innerDiameter"),
            length=_required(value, "length"),
            roughness_c=_required(value, "roughnessC"),
            minor_loss_coeff=value.get("minorLossCoeff", 0.0),
        )
        for value in _required(model, "pipes")
    ]
    nodes = [
        NetworkNodeDef(
            id=_required(value, "id"),
            elevation=_required(value, "elevation"),
            type=_required(value, "type"),
            head=value.get("head"),
            demand=value.get("demand", 0.0),
        )
        for value in _required(model, "nodes")
    ]
    output = calc_steady_network(
        SteadyNetworkInput(pipes=pipes, nodes=nodes, case_name=model.get("caseName", "定常"))
    )
    return _result("steady-network-python", model, scenario, _json_value(output), output.warnings)


def _longitudinal(model: dict[str, Any], scenario: dict[str, Any]) -> dict[str, Any]:
    points = [
        MeasurementPoint(
            id=_required(value, "id"),
            horizontal_distance=_required(value, "horizontalDistance"),
            ground_level=_required(value, "groundLevel"),
            pipe_center_height=_required(value, "pipeCenterHeight"),
            pipe_length=_required(value, "pipeLength"),
            flow_rate=_required(value, "flowRate"),
            diameter=_required(value, "diameter"),
            roughness_c=_required(value, "roughnessC"),
            bend_loss_coeff=_required(value, "bendLossCoeff"),
            valve_loss_coeff=_required(value, "valveLossCoeff"),
            branch_loss_coeff=_required(value, "branchLossCoeff"),
            name=value.get("name"),
            other_loss=value.get("otherLoss"),
        )
        for value in _required(model, "points")
    ]
    output = calc_longitudinal_hydraulic(
        LongitudinalHydraulicInput(
            points=points,
            static_water_level=_required(model, "staticWaterLevel"),
            waterhammer_pressure_mpa=model.get("waterhammerPressureMpa"),
            waterhammer_ratio=model.get("waterhammerRatio"),
            case_name=model.get("caseName"),
        )
    )
    return _result("longitudinal-hydraulics", model, scenario, _json_value(output), output.warnings)


def _moc_output(method: str, model: dict[str, Any], scenario: dict[str, Any], output: Any) -> dict[str, Any]:
    converted_pipes = {
        pipe_id: {
            "waveSpeed": pipe.wave_speed,
            "dx": pipe.dx,
            "nReaches": pipe.n_reaches,
            "vibrationPeriod": pipe.vibration_period,
            "H_steady": list(pipe.H_steady),
            "Hmax": list(pipe.Hmax),
            "Hmin": list(pipe.Hmin),
            "snapshots": [
                {"t": snapshot.t, "H": list(snapshot.H), "Q": list(snapshot.Q)}
                for snapshot in pipe.snapshots
            ],
        }
        for pipe_id, pipe in output.pipes.items()
    }
    converted_nodes = {}
    for node_id, node in output.nodes.items():
        converted_node = {"H": list(node.H)}
        if node.N is not None:
            converted_node["N"] = list(node.N)
        if node.V_air is not None:
            converted_node["V_air"] = list(node.V_air)
        if node.z is not None:
            converted_node["z"] = list(node.z)
        converted_nodes[node_id] = converted_node
    summary = {
        "dt": output.dt,
        "tMax": output.t_max,
        "pipes": {
            pipe_id: {key: value for key, value in pipe.items() if key != "snapshots"}
            for pipe_id, pipe in converted_pipes.items()
        },
    }
    time_series = {
        "pipes": {
            pipe_id: pipe["snapshots"] for pipe_id, pipe in converted_pipes.items()
        },
        "nodes": converted_nodes,
    }
    return _result(method, model, scenario, summary, output.warnings, time_series)


def _boundary_condition(value: dict[str, Any]) -> Any:
    kind = _required(value, "type")
    constructors = {
        "reservoir": lambda: ReservoirBC(head=_required(value, "head")),
        "valve": lambda: ValveBC(
            Q0=_required(value, "Q0"), H0v=_required(value, "H0v"),
            close_time=_required(value, "closeTime"), operation=value.get("operation", "close")
        ),
        "pump": lambda: PumpBC(
            Q0=_required(value, "Q0"), H0=_required(value, "H0"),
            shutdown_time=_required(value, "shutdownTime"), Hs=value.get("Hs"),
            GD2=value.get("GD2"), N0=value.get("N0"), eta0=value.get("eta0"),
            mode=value.get("mode", "trip"), startup_time=value.get("startupTime"),
            static_head=value.get("staticHead"), check_valve=value.get("checkValve", True),
        ),
        "air_chamber": lambda: AirChamberBC(
            V_air0=_required(value, "V_air0"), H_air0=_required(value, "H_air0"),
            polytropic_index=value.get("polytropicIndex", 1.2),
        ),
        "surge_tank": lambda: SurgeTankBC(
            tank_area=_required(value, "tankArea"), initial_level=_required(value, "initialLevel"),
            datum=value.get("datum", 0.0),
        ),
        "air_release_valve": lambda: AirReleaseValveBC(
            atmospheric_head=value.get("atmosphericHead", 10.33)
        ),
        "pressure_reducing_valve": lambda: PressureReducingValveBC(
            set_head=_required(value, "setHead"), Q0=_required(value, "Q0")
        ),
        "dead_end": DeadEndBC,
    }
    constructor = constructors.get(kind)
    if constructor is None:
        raise ProtocolError("INVALID_INPUT", f"Unsupported boundary condition: {kind}")
    return constructor()


def _network(value: dict[str, Any]) -> MocNetwork:
    pipes = []
    for spec in _required(value, "pipes"):
        pipe = _pipe(_required(spec, "pipe"))
        pipes.append(
            MocPipeSegment(
                id=_required(spec, "id"),
                pipe=pipe,
                wave_speed=spec.get("waveSpeed", calc_wave_speed(pipe)),
                n_reaches=_required(spec, "nReaches"),
                upstream_node_id=_required(spec, "upstreamNodeId"),
                downstream_node_id=_required(spec, "downstreamNodeId"),
                initial_flow=spec.get("initialFlow"),
            )
        )
    return MocNetwork(
        pipes=pipes,
        nodes={node_id: _boundary_condition(boundary) for node_id, boundary in _required(value, "nodes").items()},
    )


def _transient_single(model: dict[str, Any], scenario: dict[str, Any]) -> dict[str, Any]:
    event = scenario["eventSettings"]
    output = run_moc_single_pipe(
        SinglePipeMocInput(
            pipe=_pipe(_required(model, "pipe")),
            wave_speed=_required(event, "waveSpeed"),
            initial_velocity=_required(event, "initialVelocity"),
            initial_downstream_head=_required(event, "initialDownstreamHead"),
            close_time=_required(event, "closeTime"),
            n_reaches=event.get("nReaches", 10),
            t_max=event.get("tMax"),
            operation=event.get("operation", "close"),
        )
    )
    return _moc_output("moc-single-pipe", model, scenario, output)


def _transient_network(model: dict[str, Any], scenario: dict[str, Any]) -> dict[str, Any]:
    options = model.get("options", {})
    output = run_moc(
        _network(_required(model, "network")),
        MocOptions(t_max=options.get("tMax"), initial_flow=options.get("initialFlow")),
    )
    return _moc_output("moc-network", model, scenario, output)


def _transient_pump(model: dict[str, Any], scenario: dict[str, Any]) -> dict[str, Any]:
    event = scenario["eventSettings"]
    pipe = _pipe(_required(model, "pipe"))
    wave_speed = event.get("waveSpeed", calc_wave_speed(pipe))
    if event.get("mode", "trip") == "start":
        output = run_moc_pump_start(PumpStartInput(
            pipe=pipe, wave_speed=wave_speed, Q_rated=_required(event, "Q_rated"),
            pump_head=_required(event, "pumpHead"), startup_time=_required(event, "startupTime"),
            Hs=event.get("Hs"), static_head=event.get("staticHead", 0.0),
            n_reaches=event.get("nReaches", 10), t_max=event.get("tMax"),
        ))
    else:
        output = run_moc_pump_trip(PumpTripInput(
            pipe=pipe, wave_speed=wave_speed, Q0=_required(event, "Q0"),
            pump_head=_required(event, "pumpHead"), Hs=event.get("Hs"),
            GD2=event.get("GD2"), N0=event.get("N0"), eta0=event.get("eta0"),
            shutdown_time=event.get("shutdownTime", 0.0), check_valve=event.get("checkValve", True),
            n_reaches=event.get("nReaches", 10), t_max=event.get("tMax"),
        ))
    return _moc_output("moc-pump", model, scenario, output)


HANDLERS: dict[str, Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]]] = {
    "wave_speed": _wave_speed,
    "joukowsky_allievi": _joukowsky_allievi,
    "empirical_pressure": _empirical_pressure,
    "steady_single_pipe": _steady_single_pipe,
    "steady_network_python": _steady_network,
    "longitudinal_hydraulics": _longitudinal,
    "transient_single_pipe": _transient_single,
    "transient_network": _transient_network,
    "transient_pump": _transient_pump,
    "transient_protection_device": _transient_network,
}


def _ecmascript_number(value: int | float) -> str:
    """Return the ECMAScript NumberToString spelling used by JSON.stringify."""
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Canonical JSON cannot contain non-finite numbers")
    if number == 0:
        return "0"

    sign = "-" if number < 0 else ""
    text = repr(abs(number)).lower()
    if "e" in text:
        mantissa, exponent_text = text.split("e", 1)
        exponent = int(exponent_text)
    else:
        mantissa = text
        exponent = 0

    integer, separator, fraction = mantissa.partition(".")
    combined = integer + (fraction if separator else "")
    leading_zero_count = len(combined) - len(combined.lstrip("0"))
    digits = combined.lstrip("0").rstrip("0")
    decimal_position = len(integer) - leading_zero_count + exponent
    digit_count = len(digits)

    if digit_count <= decimal_position <= 21:
        body = digits + ("0" * (decimal_position - digit_count))
    elif 0 < decimal_position <= 21:
        body = f"{digits[:decimal_position]}.{digits[decimal_position:]}"
    elif -6 < decimal_position <= 0:
        body = f"0.{('0' * -decimal_position)}{digits}"
    else:
        exponent_value = decimal_position - 1
        coefficient = digits[0] if digit_count == 1 else f"{digits[0]}.{digits[1:]}"
        exponent_sign = "+" if exponent_value >= 0 else "-"
        body = f"{coefficient}e{exponent_sign}{abs(exponent_value)}"
    return sign + body


def _canonical_json(value: Any, seen: set[int] | None = None) -> str:
    """Match the sorted-key workspace canonicalJson representation exactly."""
    if seen is None:
        seen = set()
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, (int, float)):
        return _ecmascript_number(value)
    if isinstance(value, (list, tuple)):
        identity = id(value)
        if identity in seen:
            raise ValueError("Canonical JSON cannot contain cycles")
        seen.add(identity)
        try:
            return "[" + ",".join(_canonical_json(item, seen) for item in value) + "]"
        finally:
            seen.remove(identity)
    if isinstance(value, dict):
        identity = id(value)
        if identity in seen:
            raise ValueError("Canonical JSON cannot contain cycles")
        if any(not isinstance(key, str) for key in value):
            raise TypeError("Canonical JSON object keys must be strings")
        seen.add(identity)
        try:
            members = (
                f"{_canonical_json(key, seen)}:{_canonical_json(value[key], seen)}"
                for key in sorted(
                    value,
                    key=lambda item: item.encode("utf-16-be", errors="surrogatepass"),
                )
            )
            return "{" + ",".join(members) + "}"
        finally:
            seen.remove(identity)
    raise TypeError(f"Canonical JSON cannot contain {type(value).__name__}")


def _canonical_input(kind: str, model: dict[str, Any], scenario: dict[str, Any]) -> bytes:
    return _canonical_json({"kind": kind, "model": model, "scenario": scenario}).encode("utf-8")


def execute_request(request: Any) -> dict[str, Any]:
    if not isinstance(request, dict):
        raise ProtocolError("INVALID_REQUEST", "Request must be a JSON object")
    if request.get("protocolVersion") != PROTOCOL_VERSION:
        raise ProtocolError("INVALID_REQUEST", "protocolVersion must be 1")
    kind = request.get("kind")
    handler = HANDLERS.get(kind)
    if handler is None:
        raise ProtocolError("UNSUPPORTED_RUN_KIND", f"Unsupported Run kind: {kind}")
    model = request.get("model")
    scenario = request.get("scenario")
    if not isinstance(model, dict) or not isinstance(scenario, dict):
        raise ProtocolError("INVALID_REQUEST", "model and scenario must be JSON objects")
    for key in ("boundaryConditions", "eventSettings", "protectionSettings"):
        if not isinstance(scenario.get(key), dict):
            raise ProtocolError("INVALID_REQUEST", f"scenario.{key} must be a JSON object")
    input_hash = hashlib.sha256(_canonical_input(kind, model, scenario)).hexdigest()
    try:
        result = handler(model, scenario)
    except ProtocolError:
        raise
    except (KeyError, TypeError, ValueError) as error:
        raise ProtocolError("INVALID_INPUT", str(error)) from error
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "ok": True,
        "pythonVersion": platform.python_version(),
        "inputHash": input_hash,
        "result": result,
    }


def run_protocol_json(serialized_request: str) -> str:
    try:
        request = json.loads(serialized_request)
    except json.JSONDecodeError as error:
        raise ProtocolError("INVALID_REQUEST", "stdin must contain one JSON request") from error
    return json.dumps(execute_request(request), ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def main() -> int:
    try:
        output = run_protocol_json(sys.stdin.read())
        sys.stdout.write(output + "\n")
        return 0
    except ProtocolError as error:
        response = {
            "protocolVersion": PROTOCOL_VERSION,
            "ok": False,
            "error": {"code": error.code, "message": str(error)},
        }
        sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n")
        return 1
    except Exception as error:  # pragma: no cover - defensive process boundary
        response = {
            "protocolVersion": PROTOCOL_VERSION,
            "ok": False,
            "error": {"code": "ENGINE_ERROR", "message": str(error)},
        }
        sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
