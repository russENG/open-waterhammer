import type { Run, RunKind } from '@open-waterhammer/contracts'

const RUN_KIND_LABELS: Record<RunKind, string> = {
  wave_speed: '波速',
  joukowsky_allievi: 'Joukowsky / Allievi',
  empirical_pressure: '経験式による水撃圧',
  steady_single_pipe: '単一管路の定常解析',
  steady_network_python: '管路網の定常解析 / Python',
  steady_network_epanet: '管路網の定常解析 / EPANET',
  longitudinal_hydraulics: '縦断水理計算',
  transient_single_pipe: '単一管路の過渡解析',
  transient_network: '管路網の過渡解析',
  transient_pump: 'ポンプ過渡解析',
  transient_protection_device: '水撃圧対策設備',
}

const RUN_STATUS_LABELS: Record<Run['status'], string> = {
  pending: '計算待ち',
  running: '計算中',
  succeeded: '計算完了',
  failed: '計算失敗',
  interrupted: '中断',
}

const ASSESSMENT_STATUS_LABELS: Record<Run['assessment']['status'], string> = {
  pass: '適合',
  warning: '注意',
  fail: '不適合',
  needs_review: '要確認',
  not_applicable: '対象外',
}

export function runKindLabel(kind: RunKind): string {
  return RUN_KIND_LABELS[kind]
}

export function runStatusLabel(status: Run['status']): string {
  return RUN_STATUS_LABELS[status]
}

export function assessmentStatusLabel(status: Run['assessment']['status']): string {
  return ASSESSMENT_STATUS_LABELS[status]
}

/**
 * 自動評価が `needs_review`（要確認）になる理由を説明する。
 *
 * 判定材料が無いときの既定値が `needs_review` なので、指摘0件と併記されると
 * 「何を確認すればよいのか分からない」状態になっていた。方式ごとに、
 * 判定できる余地があるのか（＝許容圧力を入れれば判定される）を区別して伝える。
 */
const DESIGN_PRESSURE_JUDGED_KINDS = new Set<RunKind>([
  'joukowsky_allievi', 'empirical_pressure', 'longitudinal_hydraulics',
])

export function assessmentNote(run: Run): string {
  if (run.assessment.findings.length > 0) return ''
  switch (run.assessment.status) {
    case 'pass':
      return '判定した項目はすべて基準内でした。'
    case 'needs_review':
      return DESIGN_PRESSURE_JUDGED_KINDS.has(run.kind)
        ? '許容圧力（呼び圧力）が未入力のため、設計水圧の判定を行っていません。解析タブで入力すると判定できます。'
        : 'この計算方式には自動判定がありません。結果の妥当性は設計者が確認してください。'
    case 'not_applicable':
      return 'この計算結果は自動判定の対象外です。'
    default:
      return '指摘事項はありません。'
  }
}
