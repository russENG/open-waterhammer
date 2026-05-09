/**
 * Pyodide ブリッジ — open_waterhammer Python コアをブラウザで実行する.
 *
 * 単一の真理源は packages/core-py/。本モジュールは Pyodide をロードし、
 * .py ファイルを Pyodide の仮想 FS に書き込んで `import open_waterhammer`
 * できる状態を整える。
 *
 * Stage 2: formulas.py 全関数移植完了。types/pipe_materials/formulas/__init__ を
 * すべて取り込む。
 */

// .py ファイルを Vite の ?raw import で文字列として取り込む。
// vite.config.ts の server.fs.allow で packages/core-py/ が許可されている。
import initSrc from "@open-waterhammer-py/__init__.py?raw"
import typesSrc from "@open-waterhammer-py/types.py?raw"
import pipeMaterialsSrc from "@open-waterhammer-py/pipe_materials.py?raw"
import formulasSrc from "@open-waterhammer-py/formulas.py?raw"
import mocSrc from "@open-waterhammer-py/moc.py?raw"
import simpleCalcSrc from "@open-waterhammer-py/simple_calculation.py?raw"
import longitudinalSrc from "@open-waterhammer-py/longitudinal_hydraulic.py?raw"
import steadyFlowSrc from "@open-waterhammer-py/steady_flow.py?raw"
import steadyToMocSrc from "@open-waterhammer-py/steady_to_moc.py?raw"

// Pyodide は重い（数 MB）。型は any で受けてランタイムローダ任せにする。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PyodideRuntime = any

const PYODIDE_VERSION = "0.29.0"
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

// ─── ロード状態の管理（トースト・ボタン状態の共有用）──────────────────────

export type PyodideStatus = "idle" | "loading" | "ready" | "error"

let pyodideStatus: PyodideStatus = "idle"
const statusListeners = new Set<(s: PyodideStatus) => void>()

function setStatus(s: PyodideStatus) {
  pyodideStatus = s
  statusListeners.forEach((fn) => fn(s))
}

export function getPyodideStatus(): PyodideStatus {
  return pyodideStatus
}

export function subscribePyodideStatus(fn: (s: PyodideStatus) => void): () => void {
  statusListeners.add(fn)
  return () => {
    statusListeners.delete(fn)
  }
}

// ─── ロード本体 ──────────────────────────────────────────────────────────────

let pyodidePromise: Promise<PyodideRuntime> | null = null

export async function loadPyodideOnce(): Promise<PyodideRuntime> {
  if (pyodidePromise) return pyodidePromise
  setStatus("loading")
  pyodidePromise = (async () => {
    try {
      // Pyodide は ES module を CDN から動的 import する。
      // Vite の static 解析を避けるため、URL は文字列連結で渡す。
      const mod = await import(/* @vite-ignore */ `${PYODIDE_INDEX_URL}pyodide.mjs`)
      const py = await mod.loadPyodide({ indexURL: PYODIDE_INDEX_URL })
      // 仮想 FS に open_waterhammer パッケージを書き込み
      py.FS.mkdirTree("/home/pyodide/open_waterhammer")
      py.FS.writeFile("/home/pyodide/open_waterhammer/__init__.py", initSrc)
      py.FS.writeFile("/home/pyodide/open_waterhammer/types.py", typesSrc)
      py.FS.writeFile("/home/pyodide/open_waterhammer/pipe_materials.py", pipeMaterialsSrc)
      py.FS.writeFile("/home/pyodide/open_waterhammer/formulas.py", formulasSrc)
      py.FS.writeFile("/home/pyodide/open_waterhammer/moc.py", mocSrc)
      py.FS.writeFile("/home/pyodide/open_waterhammer/simple_calculation.py", simpleCalcSrc)
      py.FS.writeFile("/home/pyodide/open_waterhammer/longitudinal_hydraulic.py", longitudinalSrc)
      py.FS.writeFile("/home/pyodide/open_waterhammer/steady_flow.py", steadyFlowSrc)
      py.FS.writeFile("/home/pyodide/open_waterhammer/steady_to_moc.py", steadyToMocSrc)
      // /home/pyodide が cwd なので、そのまま import できる
      py.runPython("import open_waterhammer")
      setStatus("ready")
      return py
    } catch (err) {
      setStatus("error")
      throw err
    }
  })()
  return pyodidePromise
}

/**
 * アプリ起動直後に呼んで、ユーザー操作と並行で Pyodide をロードする.
 * 計算ボタン押下時には warm 状態になっていることが期待値.
 */
export function prefetchPyodide(): void {
  void loadPyodideOnce()
}

/**
 * Python コアの関数を呼ぶ汎用ラッパ（位置引数のみ・プリミティブ向き）.
 *
 * @param funcName 関数名（open_waterhammer モジュール内のシンボル）
 * @param args 位置引数（JSON 化可能な値）
 */
export async function callPy<T>(funcName: string, ...args: unknown[]): Promise<T> {
  const py = await loadPyodideOnce()
  const argsJson = JSON.stringify(args)
  const code = `
import json
from open_waterhammer import ${funcName}
_args = json.loads(${JSON.stringify(argsJson)})
_result = ${funcName}(*_args)
_result
`
  return py.runPython(code) as T
}

/**
 * 任意の Python スクリプトを実行する（dataclass 構築など複雑な呼出し向け）.
 * `from open_waterhammer import *` 済みの環境で実行される.
 */
export async function runPyScript<T>(script: string): Promise<T> {
  const py = await loadPyodideOnce()
  const wrapped = `
from open_waterhammer import *
${script}
`
  return py.runPython(wrapped) as T
}

// ─── 個別の関数ラッパ（型安全のため）────────────────────────────────────────

/** ジューコフスキーの式: ΔH = -(a/g) × ΔV */
export async function joukowskyPy(waveSpeed: number, deltaV: number): Promise<number> {
  return callPy<number>("joukowsky", waveSpeed, deltaV)
}

/** アリエビ式 K₁ 算定 */
export async function calcAllieviK1Py(
  pipeLength: number,
  velocity: number,
  staticHead: number,
  closeTime: number,
): Promise<number> {
  return callPy<number>("calc_allievi_k1", pipeLength, velocity, staticHead, closeTime)
}

/** アリエビの近似式（閉操作時最大水撃圧）*/
export async function allieviClosePy(staticHead: number, k1: number): Promise<number> {
  return callPy<number>("allievi_close", staticHead, k1)
}

/** アリエビの近似式（開操作時最大圧力低下）*/
export async function allieviOpenPy(staticHead: number, k1: number): Promise<number> {
  return callPy<number>("allievi_open", staticHead, k1)
}

/** 圧力振動周期 T₀ = 4L/a */
export async function calcVibrationPeriodPy(
  pipeLength: number,
  waveSpeed: number,
): Promise<number> {
  return callPy<number>("calc_vibration_period", pipeLength, waveSpeed)
}

/** 水頭 [m] → 圧力 [MPa] */
export async function headToMpaPy(headM: number): Promise<number> {
  return callPy<number>("head_to_mpa", headM)
}

/** 圧力 [MPa] → 水頭 [m] */
export async function mpaToHeadPy(pressureMpa: number): Promise<number> {
  return callPy<number>("mpa_to_head", pressureMpa)
}

// ─── Pipe / CalculationCase の Python dict 表現 ──────────────────────────

export interface PipeArg {
  id: string
  startNodeId?: string
  endNodeId?: string
  pipeType: string
  innerDiameter: number
  wallThickness: number
  length: number
  roughnessCoeff: number
  name?: string
  youngsModulus?: number
  c1Coeff?: number
}

export interface CalculationCaseArg {
  id: string
  name: string
  operationType: string
  targetFacilityId: string
  initialVelocity: number
  initialHead: number
  description?: string
}

function pipeArgToPython(p: PipeArg): string {
  const parts = [
    `id=${JSON.stringify(p.id)}`,
    `start_node_id=${JSON.stringify(p.startNodeId ?? "")}`,
    `end_node_id=${JSON.stringify(p.endNodeId ?? "")}`,
    `pipe_type=${JSON.stringify(p.pipeType)}`,
    `inner_diameter=${p.innerDiameter}`,
    `wall_thickness=${p.wallThickness}`,
    `length=${p.length}`,
    `roughness_coeff=${p.roughnessCoeff}`,
  ]
  if (p.name !== undefined) parts.push(`name=${JSON.stringify(p.name)}`)
  if (p.youngsModulus !== undefined) parts.push(`youngs_modulus=${p.youngsModulus}`)
  if (p.c1Coeff !== undefined) parts.push(`c1_coeff=${p.c1Coeff}`)
  return `Pipe(${parts.join(", ")})`
}

function caseArgToPython(c: CalculationCaseArg): string {
  const parts = [
    `id=${JSON.stringify(c.id)}`,
    `name=${JSON.stringify(c.name)}`,
    `operation_type=${JSON.stringify(c.operationType)}`,
    `target_facility_id=${JSON.stringify(c.targetFacilityId)}`,
    `initial_velocity=${c.initialVelocity}`,
    `initial_head=${c.initialHead}`,
  ]
  if (c.description !== undefined) parts.push(`description=${JSON.stringify(c.description)}`)
  return `CalculationCase(${parts.join(", ")})`
}

// ─── 簡易式計算（ジューコフスキー / アリエビ）─────────────────────────────

export interface WaveSpeedResultJs {
  waveSpeed: number
  vibrationPeriod: number
  alpha: number
}

export interface SimpleFormulaResultJs {
  caseId: string
  pipeId: string
  waveSpeed: WaveSpeedResultJs
  closureType: "rapid" | "slow" | "numerical_required"
  deltaHJoukowsky: number | null
  hmaxAllieviClose: number | null
  hmaxAllieviOpen: number | null
  k1: number | null
  allieviApplicable: boolean | null
  warnings: string[]
}

export async function runSimpleFormulaPy(
  pipe: PipeArg,
  cas: CalculationCaseArg,
  closeTime: number,
): Promise<SimpleFormulaResultJs> {
  const py = await loadPyodideOnce()
  const code = `
from open_waterhammer import Pipe, CalculationCase, run_simple_formula
import json
_pipe = ${pipeArgToPython(pipe)}
_case = ${caseArgToPython(cas)}
_r = run_simple_formula(_pipe, _case, ${closeTime})
json.dumps({
    "caseId": _r.case_id,
    "pipeId": _r.pipe_id,
    "waveSpeed": {
        "waveSpeed": _r.wave_speed.wave_speed,
        "vibrationPeriod": _r.wave_speed.vibration_period,
        "alpha": _r.wave_speed.alpha,
    },
    "closureType": _r.closure_type,
    "deltaHJoukowsky": _r.delta_h_joukowsky,
    "hmaxAllieviClose": _r.hmax_allievi_close,
    "hmaxAllieviOpen": _r.hmax_allievi_open,
    "k1": _r.k1,
    "allieviApplicable": _r.allievi_applicable,
    "warnings": list(_r.warnings),
})
`
  const jsonStr = py.runPython(code) as string
  return JSON.parse(jsonStr)
}

// ─── 耐圧判定 ──────────────────────────────────────────────────────────────

export interface JudgementResultJs {
  status: "ok" | "ng" | "warning"
  designPressureMpa: number
  allowablePressureMpa: number
  margin: number
  message: string
}

export async function judgeDesignPressurePy(
  designPressureMpa: number,
  allowablePressureMpa: number,
): Promise<JudgementResultJs> {
  const py = await loadPyodideOnce()
  const code = `
from open_waterhammer import judge_design_pressure
import json
_r = judge_design_pressure(${designPressureMpa}, ${allowablePressureMpa})
json.dumps({
    "status": _r.status,
    "designPressureMpa": _r.design_pressure_mpa,
    "allowablePressureMpa": _r.allowable_pressure_mpa,
    "margin": _r.margin,
    "message": _r.message,
})
`
  const jsonStr = py.runPython(code) as string
  return JSON.parse(jsonStr)
}

// ─── MOC（特性曲線法）結果型 ─────────────────────────────────────────────

export interface MocSnapshotJs {
  t: number
  H: number[]
  Q: number[]
}

export interface MocPipeResultJs {
  waveSpeed: number
  dx: number
  nReaches: number
  vibrationPeriod: number
  H_steady: number[]
  Hmax: number[]
  Hmin: number[]
  snapshots: MocSnapshotJs[]
}

export interface MocNodeHPoint {
  t: number
  H: number
}

export interface MocNodeNPoint {
  t: number
  N: number
}

export interface MocNodeVAirPoint {
  t: number
  V: number
}

export interface MocNodeZPoint {
  t: number
  z: number
}

export interface MocNodeResultJs {
  H: MocNodeHPoint[]
  N?: MocNodeNPoint[]
  V_air?: MocNodeVAirPoint[]
  z?: MocNodeZPoint[]
}

export interface MocResultJs {
  dt: number
  tMax: number
  pipes: Record<string, MocPipeResultJs>
  nodes: Record<string, MocNodeResultJs>
  warnings: string[]
}

/**
 * MocResult dataclass を JSON 化する Python 側ヘルパ.
 * 各 MOC 関数のスクリプトに inject して使う.
 */
const MOC_TO_DICT_HELPER = `
def _moc_to_dict(r):
    pipes_out = {}
    for pid, p in r.pipes.items():
        pipes_out[pid] = {
            "waveSpeed": p.wave_speed,
            "dx": p.dx,
            "nReaches": p.n_reaches,
            "vibrationPeriod": p.vibration_period,
            "H_steady": list(p.H_steady),
            "Hmax": list(p.Hmax),
            "Hmin": list(p.Hmin),
            "snapshots": [
                {"t": s.t, "H": list(s.H), "Q": list(s.Q)}
                for s in p.snapshots
            ],
        }
    nodes_out = {}
    for nid, n in r.nodes.items():
        node_dict = {"H": list(n.H)}
        if n.N is not None:
            node_dict["N"] = list(n.N)
        if n.V_air is not None:
            node_dict["V_air"] = list(n.V_air)
        if n.z is not None:
            node_dict["z"] = list(n.z)
        nodes_out[nid] = node_dict
    return {
        "dt": r.dt,
        "tMax": r.t_max,
        "warnings": list(r.warnings),
        "pipes": pipes_out,
        "nodes": nodes_out,
    }
`

// ─── MOC 汎用ネットワークラッパ ───────────────────────────────────────────

export interface NetworkPipeSpec {
  id: string
  pipe: PipeArg
  /** 未指定なら Python 側で calc_wave_speed(pipe) を呼んで計算する. */
  waveSpeed?: number
  nReaches: number
  upstreamNodeId: string
  downstreamNodeId: string
  initialFlow?: number
}

export type NetworkBcSpec =
  | { type: "reservoir"; head: number }
  | { type: "valve"; Q0: number; H0v: number; closeTime: number; operation?: "close" | "open" }
  | { type: "pump"; Q0: number; H0: number; shutdownTime: number; Hs?: number; GD2?: number; N0?: number; eta0?: number; mode?: "trip" | "start"; startupTime?: number; staticHead?: number; checkValve?: boolean }
  | { type: "air_chamber"; V_air0: number; H_air0: number; polytropicIndex?: number }
  | { type: "surge_tank"; tankArea: number; initialLevel: number; datum?: number }
  | { type: "air_release_valve"; atmosphericHead?: number }
  | { type: "pressure_reducing_valve"; setHead: number; Q0: number }
  | { type: "dead_end" }

export interface NetworkSpec {
  pipes: NetworkPipeSpec[]
  nodes: Record<string, NetworkBcSpec>
}

export interface RunMocOptions {
  tMax?: number
  initialFlow?: number
}

/**
 * NetworkSpec dict から MocNetwork dataclass を構築する Python 側ヘルパ.
 * フィールド名 camelCase → snake_case の変換を含む.
 */
const NETWORK_BUILDER_HELPER = `
def _build_network_from_dict(spec):
    bc_classes = {
        "reservoir": ReservoirBC,
        "valve": ValveBC,
        "pump": PumpBC,
        "air_chamber": AirChamberBC,
        "surge_tank": SurgeTankBC,
        "air_release_valve": AirReleaseValveBC,
        "pressure_reducing_valve": PressureReducingValveBC,
        "dead_end": DeadEndBC,
    }
    field_renames = {
        "polytropicIndex": "polytropic_index",
        "tankArea": "tank_area",
        "initialLevel": "initial_level",
        "atmosphericHead": "atmospheric_head",
        "setHead": "set_head",
        "closeTime": "close_time",
        "shutdownTime": "shutdown_time",
        "startupTime": "startup_time",
        "staticHead": "static_head",
        "checkValve": "check_valve",
    }
    nodes = {}
    for nid, bc_dict in spec["nodes"].items():
        cls = bc_classes[bc_dict["type"]]
        kwargs = {}
        for k, v in bc_dict.items():
            if k == "type":
                continue
            kwargs[field_renames.get(k, k)] = v
        nodes[nid] = cls(**kwargs)
    pipes = []
    for ps in spec["pipes"]:
        p_dict = ps["pipe"]
        py_pipe = Pipe(
            id=p_dict["id"],
            start_node_id=p_dict.get("startNodeId", ""),
            end_node_id=p_dict.get("endNodeId", ""),
            pipe_type=p_dict["pipeType"],
            inner_diameter=p_dict["innerDiameter"],
            wall_thickness=p_dict["wallThickness"],
            length=p_dict["length"],
            roughness_coeff=p_dict["roughnessCoeff"],
            youngs_modulus=p_dict.get("youngsModulus"),
            c1_coeff=p_dict.get("c1Coeff"),
        )
        ws = ps.get("waveSpeed")
        if ws is None:
            from open_waterhammer import calc_wave_speed
            ws = calc_wave_speed(py_pipe)
        pipes.append(MocPipeSegment(
            id=ps["id"],
            pipe=py_pipe,
            wave_speed=ws,
            n_reaches=ps["nReaches"],
            upstream_node_id=ps["upstreamNodeId"],
            downstream_node_id=ps["downstreamNodeId"],
            initial_flow=ps.get("initialFlow"),
        ))
    return MocNetwork(pipes=pipes, nodes=nodes)
`

export async function runMocPy(
  network: NetworkSpec,
  options?: RunMocOptions,
): Promise<MocResultJs> {
  const py = await loadPyodideOnce()
  const tMaxArg = options?.tMax === undefined ? "None" : String(options.tMax)
  const initFlowArg = options?.initialFlow === undefined ? "None" : String(options.initialFlow)
  const networkJson = JSON.stringify(network)
  const code = `
from open_waterhammer import (
    Pipe, MocNetwork, MocPipeSegment, MocOptions, run_moc,
    ReservoirBC, ValveBC, PumpBC, AirChamberBC, SurgeTankBC,
    AirReleaseValveBC, PressureReducingValveBC, DeadEndBC,
)
import json
${MOC_TO_DICT_HELPER}
${NETWORK_BUILDER_HELPER}
_spec = json.loads(${JSON.stringify(networkJson)})
_network = _build_network_from_dict(_spec)
_options = MocOptions(t_max=${tMaxArg}, initial_flow=${initFlowArg})
_r = run_moc(_network, _options)
json.dumps(_moc_to_dict(_r))
`
  const jsonStr = py.runPython(code) as string
  return JSON.parse(jsonStr)
}

// ─── MOC 単管路ラッパ ─────────────────────────────────────────────────────

export interface RunMocSinglePipeArgs {
  pipe: PipeArg
  waveSpeed: number
  initialVelocity: number
  initialDownstreamHead: number
  closeTime: number
  nReaches?: number
  tMax?: number
  operation?: "close" | "open"
}

export async function runMocSinglePipePy(
  args: RunMocSinglePipeArgs,
): Promise<MocResultJs> {
  const py = await loadPyodideOnce()
  const tMaxArg = args.tMax === undefined ? "None" : String(args.tMax)
  const opArg = args.operation === undefined ? '"close"' : JSON.stringify(args.operation)
  const code = `
from open_waterhammer import (
    Pipe, run_moc_single_pipe, SinglePipeMocInput,
)
import json
${MOC_TO_DICT_HELPER}
_pipe = ${pipeArgToPython(args.pipe)}
_input = SinglePipeMocInput(
    pipe=_pipe,
    wave_speed=${args.waveSpeed},
    initial_velocity=${args.initialVelocity},
    initial_downstream_head=${args.initialDownstreamHead},
    close_time=${args.closeTime},
    n_reaches=${args.nReaches ?? 10},
    t_max=${tMaxArg},
    operation=${opArg},
)
_r = run_moc_single_pipe(_input)
json.dumps(_moc_to_dict(_r))
`
  const jsonStr = py.runPython(code) as string
  return JSON.parse(jsonStr)
}

// ─── ポンプ急停止 ──────────────────────────────────────────────────────────

export interface RunMocPumpTripArgs {
  pipe: PipeArg
  /** 未指定なら Python 側で calc_wave_speed(pipe) を呼んで計算する. */
  waveSpeed?: number
  Q0: number
  pumpHead: number
  Hs?: number
  GD2?: number
  N0?: number
  eta0?: number
  shutdownTime?: number
  checkValve?: boolean
  nReaches?: number
  tMax?: number
}

export async function runMocPumpTripPy(args: RunMocPumpTripArgs): Promise<MocResultJs> {
  const py = await loadPyodideOnce()
  const optParts: string[] = [
    `pipe=_pipe`,
    `wave_speed=${args.waveSpeed ?? "calc_wave_speed(_pipe)"}`,
    `Q0=${args.Q0}`,
    `pump_head=${args.pumpHead}`,
  ]
  if (args.Hs !== undefined) optParts.push(`Hs=${args.Hs}`)
  if (args.GD2 !== undefined) optParts.push(`GD2=${args.GD2}`)
  if (args.N0 !== undefined) optParts.push(`N0=${args.N0}`)
  if (args.eta0 !== undefined) optParts.push(`eta0=${args.eta0}`)
  if (args.shutdownTime !== undefined) optParts.push(`shutdown_time=${args.shutdownTime}`)
  if (args.checkValve !== undefined) optParts.push(`check_valve=${args.checkValve ? "True" : "False"}`)
  if (args.nReaches !== undefined) optParts.push(`n_reaches=${args.nReaches}`)
  if (args.tMax !== undefined) optParts.push(`t_max=${args.tMax}`)

  const code = `
from open_waterhammer import (
    Pipe, run_moc_pump_trip, PumpTripInput, calc_wave_speed,
)
import json
${MOC_TO_DICT_HELPER}
_pipe = ${pipeArgToPython(args.pipe)}
_input = PumpTripInput(
    ${optParts.join(",\n    ")},
)
_r = run_moc_pump_trip(_input)
json.dumps(_moc_to_dict(_r))
`
  const jsonStr = py.runPython(code) as string
  return JSON.parse(jsonStr)
}

// ─── ポンプ起動 ────────────────────────────────────────────────────────────

export interface RunMocPumpStartArgs {
  pipe: PipeArg
  waveSpeed?: number
  Q_rated: number
  pumpHead: number
  startupTime: number
  Hs?: number
  staticHead?: number
  nReaches?: number
  tMax?: number
}

export async function runMocPumpStartPy(args: RunMocPumpStartArgs): Promise<MocResultJs> {
  const py = await loadPyodideOnce()
  const optParts: string[] = [
    `pipe=_pipe`,
    `wave_speed=${args.waveSpeed ?? "calc_wave_speed(_pipe)"}`,
    `Q_rated=${args.Q_rated}`,
    `pump_head=${args.pumpHead}`,
    `startup_time=${args.startupTime}`,
  ]
  if (args.Hs !== undefined) optParts.push(`Hs=${args.Hs}`)
  if (args.staticHead !== undefined) optParts.push(`static_head=${args.staticHead}`)
  if (args.nReaches !== undefined) optParts.push(`n_reaches=${args.nReaches}`)
  if (args.tMax !== undefined) optParts.push(`t_max=${args.tMax}`)

  const code = `
from open_waterhammer import (
    Pipe, run_moc_pump_start, PumpStartInput, calc_wave_speed,
)
import json
${MOC_TO_DICT_HELPER}
_pipe = ${pipeArgToPython(args.pipe)}
_input = PumpStartInput(
    ${optParts.join(",\n    ")},
)
_r = run_moc_pump_start(_input)
json.dumps(_moc_to_dict(_r))
`
  const jsonStr = py.runPython(code) as string
  return JSON.parse(jsonStr)
}

/** 波速のみ（calc_wave_speed のラッパ）.*/
export async function calcWaveSpeedPy(pipe: PipeArg): Promise<number> {
  const py = await loadPyodideOnce()
  const code = `
from open_waterhammer import Pipe, calc_wave_speed
_pipe = ${pipeArgToPython(pipe)}
calc_wave_speed(_pipe)
`
  return py.runPython(code) as number
}

// ─── 定常流計算（単管路）─────────────────────────────────────────────────

export interface SteadyFlowResultJs {
  area: number
  velocity: number
  frictionLoss: number
  hydraulicGradient: number
  elevationDiff: number
  totalHead: number
  velocityHead: number
  method: "darcy-weisbach" | "hazen-williams"
  warnings: string[]
}

function buildSteadyFlowJsonExpr(varName: string): string {
  return `json.dumps({
    "area": ${varName}.area,
    "velocity": ${varName}.velocity,
    "frictionLoss": ${varName}.friction_loss,
    "hydraulicGradient": ${varName}.hydraulic_gradient,
    "elevationDiff": ${varName}.elevation_diff,
    "totalHead": ${varName}.total_head,
    "velocityHead": ${varName}.velocity_head,
    "method": ${varName}.method,
    "warnings": list(${varName}.warnings),
})`
}

export async function calcDarcyWeisbachPy(input: {
  innerDiameter: number
  length: number
  flowRate: number
  upstreamElevation: number
  downstreamElevation: number
  frictionFactor: number
}): Promise<SteadyFlowResultJs> {
  const py = await loadPyodideOnce()
  const code = `
from open_waterhammer import calc_darcy_weisbach
import json
_r = calc_darcy_weisbach(
    inner_diameter=${input.innerDiameter},
    length=${input.length},
    flow_rate=${input.flowRate},
    upstream_elevation=${input.upstreamElevation},
    downstream_elevation=${input.downstreamElevation},
    friction_factor=${input.frictionFactor},
)
${buildSteadyFlowJsonExpr("_r")}
`
  const jsonStr = py.runPython(code) as string
  return JSON.parse(jsonStr)
}

export async function calcHazenWilliamsPy(input: {
  innerDiameter: number
  length: number
  flowRate: number
  upstreamElevation: number
  downstreamElevation: number
  roughnessC: number
}): Promise<SteadyFlowResultJs> {
  const py = await loadPyodideOnce()
  const code = `
from open_waterhammer import calc_hazen_williams
import json
_r = calc_hazen_williams(
    inner_diameter=${input.innerDiameter},
    length=${input.length},
    flow_rate=${input.flowRate},
    upstream_elevation=${input.upstreamElevation},
    downstream_elevation=${input.downstreamElevation},
    roughness_c=${input.roughnessC},
)
${buildSteadyFlowJsonExpr("_r")}
`
  const jsonStr = py.runPython(code) as string
  return JSON.parse(jsonStr)
}

// ─── 縦断水理計算 ──────────────────────────────────────────────────────────

export interface MeasurementPointArg {
  id: string
  horizontalDistance: number
  groundLevel: number
  pipeCenterHeight: number
  pipeLength: number
  flowRate: number
  diameter: number
  roughnessC: number
  bendLossCoeff: number
  valveLossCoeff: number
  branchLossCoeff: number
  name?: string
  otherLoss?: number
}

export interface MeasurementPointResultJs {
  pointId: string
  hydraulicGradient: number
  velocity: number
  velocityHead: number
  frictionLoss: number
  totalLossCoeff: number
  minorLoss: number
  totalLoss: number
  energyLevel: number
  hydraulicGradeLine: number
  pressureHead: number
  staticPressure: number
  waterhammerPressure: number
  designPressure: number
}

export interface LongitudinalHydraulicResultJs {
  caseName: string
  staticWaterLevel: number
  pointResults: MeasurementPointResultJs[]
  maxVelocity: number
  maxDesignPressure: number
  warnings: string[]
}

function pointToPython(p: MeasurementPointArg): string {
  const parts = [
    `id=${JSON.stringify(p.id)}`,
    `horizontal_distance=${p.horizontalDistance}`,
    `ground_level=${p.groundLevel}`,
    `pipe_center_height=${p.pipeCenterHeight}`,
    `pipe_length=${p.pipeLength}`,
    `flow_rate=${p.flowRate}`,
    `diameter=${p.diameter}`,
    `roughness_c=${p.roughnessC}`,
    `bend_loss_coeff=${p.bendLossCoeff}`,
    `valve_loss_coeff=${p.valveLossCoeff}`,
    `branch_loss_coeff=${p.branchLossCoeff}`,
  ]
  if (p.name !== undefined) parts.push(`name=${JSON.stringify(p.name)}`)
  if (p.otherLoss !== undefined) parts.push(`other_loss=${p.otherLoss}`)
  return `MeasurementPoint(${parts.join(", ")})`
}

export async function calcLongitudinalHydraulicPy(input: {
  points: MeasurementPointArg[]
  staticWaterLevel: number
  waterhammerPressureMpa?: number
  waterhammerRatio?: number
  caseName?: string
}): Promise<LongitudinalHydraulicResultJs> {
  const py = await loadPyodideOnce()
  const pointsList = input.points.map(pointToPython).join(",\n    ")
  const whpArg = input.waterhammerPressureMpa === undefined
    ? "None" : String(input.waterhammerPressureMpa)
  const wrArg = input.waterhammerRatio === undefined
    ? "None" : String(input.waterhammerRatio)
  const caseArg = input.caseName === undefined
    ? "None" : JSON.stringify(input.caseName)
  const code = `
from open_waterhammer import (
    calc_longitudinal_hydraulic,
    LongitudinalHydraulicInput,
    MeasurementPoint,
)
import json
_pts = [
    ${pointsList}
]
_input = LongitudinalHydraulicInput(
    points=_pts,
    static_water_level=${input.staticWaterLevel},
    waterhammer_pressure_mpa=${whpArg},
    waterhammer_ratio=${wrArg},
    case_name=${caseArg},
)
_r = calc_longitudinal_hydraulic(_input)
json.dumps({
    "caseName": _r.case_name,
    "staticWaterLevel": _r.static_water_level,
    "maxVelocity": _r.max_velocity,
    "maxDesignPressure": _r.max_design_pressure,
    "warnings": list(_r.warnings),
    "pointResults": [
        {
            "pointId": p.point_id,
            "hydraulicGradient": p.hydraulic_gradient,
            "velocity": p.velocity,
            "velocityHead": p.velocity_head,
            "frictionLoss": p.friction_loss,
            "totalLossCoeff": p.total_loss_coeff,
            "minorLoss": p.minor_loss,
            "totalLoss": p.total_loss,
            "energyLevel": p.energy_level,
            "hydraulicGradeLine": p.hydraulic_grade_line,
            "pressureHead": p.pressure_head,
            "staticPressure": p.static_pressure,
            "waterhammerPressure": p.waterhammer_pressure,
            "designPressure": p.design_pressure,
        }
        for p in _r.point_results
    ],
})
`
  const jsonStr = py.runPython(code) as string
  return JSON.parse(jsonStr)
}

// ─── 経験則による水撃圧 ─────────────────────────────────────────────────────

export interface EmpiricalWaterhammerResultJs {
  waterhammerMpa: number
  rule: string
  warnings: string[]
}

/** 経験則による水撃圧計算 (技術書 §8.3.5) */
export async function calcEmpiricalWaterhammerPy(
  systemType: string,
  staticPressureMpa: number,
  operatingPressureMpa?: number,
  hydraulicGradePressureMpa?: number,
): Promise<EmpiricalWaterhammerResultJs> {
  const py = await loadPyodideOnce()
  const opArg = operatingPressureMpa === undefined ? "None" : String(operatingPressureMpa)
  const hgArg = hydraulicGradePressureMpa === undefined ? "None" : String(hydraulicGradePressureMpa)
  const code = `
from open_waterhammer import calc_empirical_waterhammer
import json
_r = calc_empirical_waterhammer(${JSON.stringify(systemType)}, ${staticPressureMpa}, ${opArg}, ${hgArg})
json.dumps({"waterhammerMpa": _r.waterhammer_mpa, "rule": _r.rule, "warnings": list(_r.warnings)})
`
  const jsonStr = py.runPython(code) as string
  return JSON.parse(jsonStr)
}
