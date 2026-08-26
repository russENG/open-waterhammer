"""Native steady hydraulics for tree-shaped pipe networks.

The TypeScript implementation remains available for reference/V&V. This
module is the production implementation used by the shared Python protocol.
"""

import math
from dataclasses import dataclass, field
from typing import Literal

from .formulas import GRAVITY, head_to_mpa


@dataclass(frozen=True)
class NetworkPipeDef:
    id: str
    upstream_node_id: str
    downstream_node_id: str
    inner_diameter: float
    length: float
    roughness_c: float
    minor_loss_coeff: float = 0.0


@dataclass(frozen=True)
class NetworkNodeDef:
    id: str
    elevation: float
    type: Literal["reservoir", "demand", "junction"]
    head: float | None = None
    demand: float = 0.0


@dataclass(frozen=True)
class SteadyNetworkInput:
    pipes: list[NetworkPipeDef]
    nodes: list[NetworkNodeDef]
    case_name: str = "定常"


@dataclass(frozen=True)
class NetworkPipeResult:
    pipe_id: str
    flow: float
    velocity: float
    velocity_head: float
    friction_loss: float
    minor_loss: float
    total_loss: float
    hydraulic_gradient: float


@dataclass(frozen=True)
class NetworkNodeResult:
    node_id: str
    head: float
    hydraulic_grade_line: float
    pressure_head: float
    pressure_mpa: float


@dataclass(frozen=True)
class SteadyNetworkResult:
    case_name: str
    pipe_results: list[NetworkPipeResult]
    node_results: list[NetworkNodeResult]
    max_velocity: float
    max_pressure_head: float
    warnings: list[str] = field(default_factory=list)


def _hazen_williams_loss(
    diameter: float,
    roughness_c: float,
    flow: float,
    length: float,
) -> tuple[float, float, float, float]:
    area = math.pi * diameter * diameter / 4
    velocity = abs(flow) / area
    velocity_head = velocity * velocity / (2 * GRAVITY)
    if velocity < 1e-12:
        return (0.0, 0.0, 0.0, 0.0)
    hydraulic_radius = diameter / 4
    gradient = (
        velocity / (0.849 * roughness_c * hydraulic_radius**0.63)
    ) ** (1 / 0.54)
    return (velocity, velocity_head, gradient, gradient * length)


def _detect_out_of_scope_topology(
    pipes: list[NetworkPipeDef],
    reservoirs: list[NetworkNodeDef],
    visited: set[str],
    parent_pipe: dict[str, str],
) -> list[str]:
    """Warn when the input leaves the tree / single-reservoir assumption.

    BFS keeps only the first pipe that reaches each node. A pipe whose both ends
    are already reached but which was never adopted as a parent closes a cycle —
    either a real loop or a parallel inflow from a second reservoir. This solver
    drops such pipes, so its flow split no longer matches reality.
    """
    warnings: list[str] = []

    used_pipe_ids = set(parent_pipe.values())
    excluded = [
        pipe
        for pipe in pipes
        if pipe.id not in used_pipe_ids
        and pipe.upstream_node_id in visited
        and pipe.downstream_node_id in visited
    ]

    if excluded:
        warnings.append(
            "閉路（ループまたは複数貯水槽の並行流入）を検出しました: "
            + ", ".join(pipe.id for pipe in excluded)
            + "。本ソルバーは樹枝状管路網（ループなし・単一貯水槽）専用のため、"
            "これらの管路は計算から除外され、結果は実際の流量配分・水頭と一致しません。"
            "ループを含む管路網は EPANET 経路で計算してください。"
        )

    if len(reservoirs) > 1:
        warnings.append(
            f"reservoir ノードが {len(reservoirs)} 個あります"
            f"（{', '.join(r.id for r in reservoirs)}）。"
            "本ソルバーは各ノードへ最初に到達した経路だけを解くため、"
            "2 つ目以降の貯水槽からの流入は無視されます。"
            "複数の水源を持つ管路網は EPANET 経路で計算してください。"
        )

    return warnings


def calc_steady_network(input_data: SteadyNetworkInput) -> SteadyNetworkResult:
    """Calculate known-demand steady hydraulics for a tree network.

    前提を外れた入力（ループ・複数貯水槽）は例外にせず ``warnings`` で報告する。
    本ソルバーは閉路を構成する管路を計算から除外するため、その場合の結果は
    実際の流量配分と一致しない。EPANET 経路を使うこと。
    """
    pipes = input_data.pipes
    nodes = input_data.nodes
    warnings: list[str] = []
    reservoirs = [node for node in nodes if node.type == "reservoir"]
    if not reservoirs:
        return SteadyNetworkResult(
            case_name=input_data.case_name,
            pipe_results=[],
            node_results=[],
            max_velocity=0.0,
            max_pressure_head=0.0,
            warnings=["reservoir ノードがありません"],
        )

    node_map = {node.id: node for node in nodes}
    pipe_map = {pipe.id: pipe for pipe in pipes}
    adjacency: dict[str, list[tuple[str, str, bool]]] = {}
    for pipe in pipes:
        adjacency.setdefault(pipe.upstream_node_id, []).append(
            (pipe.id, pipe.downstream_node_id, True)
        )
        adjacency.setdefault(pipe.downstream_node_id, []).append(
            (pipe.id, pipe.upstream_node_id, False)
        )

    visited = {reservoir.id for reservoir in reservoirs}
    queue = [reservoir.id for reservoir in reservoirs]
    topo_order: list[str] = []
    parent_pipe: dict[str, str] = {}
    node_heads = {
        reservoir.id: reservoir.head if reservoir.head is not None else 0.0
        for reservoir in reservoirs
    }
    while queue:
        current = queue.pop(0)
        topo_order.append(current)
        for pipe_id, neighbor_id, _is_downstream in adjacency.get(current, []):
            if neighbor_id in visited:
                continue
            visited.add(neighbor_id)
            parent_pipe[neighbor_id] = pipe_id
            queue.append(neighbor_id)

    for node in nodes:
        if node.id not in visited:
            warnings.append(f"{node.id}: reservoir から到達できません")

    warnings.extend(
        _detect_out_of_scope_topology(pipes, reservoirs, visited, parent_pipe)
    )

    # 需要は reservoir 以外の全ノードから集計する（技術書 §7 の節点需要）。
    # reservoir は無限水源なので EPANET 同様 demand を無視する。
    # 集計対象は EPANET アダプタの buildInp() が [JUNCTIONS] に書き出す範囲と一致させる。
    subtree_demand = {
        node.id: 0.0 if node.type == "reservoir" else node.demand for node in nodes
    }
    pipe_flows: dict[str, float] = {}
    for current in reversed(topo_order):
        for pipe_id, neighbor_id, is_downstream in adjacency.get(current, []):
            if is_downstream and parent_pipe.get(neighbor_id) == pipe_id:
                child_demand = subtree_demand.get(neighbor_id, 0.0)
                subtree_demand[current] = subtree_demand.get(current, 0.0) + child_demand
                pipe_flows[pipe_id] = child_demand

    pipe_results: list[NetworkPipeResult] = []
    for current in topo_order:
        for pipe_id, neighbor_id, is_downstream in adjacency.get(current, []):
            if not is_downstream or parent_pipe.get(neighbor_id) != pipe_id:
                continue
            pipe = pipe_map[pipe_id]
            flow = pipe_flows.get(pipe_id, 0.0)
            velocity, velocity_head, gradient, friction_loss = _hazen_williams_loss(
                pipe.inner_diameter, pipe.roughness_c, flow, pipe.length
            )
            minor_loss = pipe.minor_loss_coeff * velocity_head
            total_loss = friction_loss + minor_loss
            node_heads[neighbor_id] = node_heads.get(current, 0.0) - total_loss
            pipe_results.append(
                NetworkPipeResult(
                    pipe_id=pipe.id,
                    flow=flow,
                    velocity=velocity,
                    velocity_head=velocity_head,
                    friction_loss=friction_loss,
                    minor_loss=minor_loss,
                    total_loss=total_loss,
                    hydraulic_gradient=gradient,
                )
            )
            if 0 < velocity < 0.3:
                warnings.append(f"{pipe.id}: 流速 {velocity:.2f} m/s が低い")
            if velocity > 3.0:
                warnings.append(
                    f"{pipe.id}: 流速 {velocity:.2f} m/s が許容流速 3.0 m/s を超過"
                )

    node_results: list[NetworkNodeResult] = []
    for node in nodes:
        if node.id not in node_heads:
            continue
        head = node_heads[node.id]
        pressure_head = head - node.elevation
        node_results.append(
            NetworkNodeResult(
                node_id=node.id,
                head=head,
                hydraulic_grade_line=head,
                pressure_head=pressure_head,
                pressure_mpa=head_to_mpa(pressure_head),
            )
        )
        if pressure_head < 0 and node.type != "reservoir":
            warnings.append(
                f"{node.id}: 動水頭 {pressure_head:.2f} m が負圧（動水位が標高を下回る）"
            )

    return SteadyNetworkResult(
        case_name=input_data.case_name,
        pipe_results=pipe_results,
        node_results=node_results,
        max_velocity=max((result.velocity for result in pipe_results), default=0.0),
        max_pressure_head=max([0.0, *(result.pressure_head for result in node_results)]),
        warnings=warnings,
    )
