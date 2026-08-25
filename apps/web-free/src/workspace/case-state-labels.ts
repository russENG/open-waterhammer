import type { CaseState } from '@open-waterhammer/contracts'

export const CASE_STATE_LABELS: Record<CaseState, string> = {
  draft: '編集中',
  locked: '計算済み・固定',
  archived: '保管済み',
}

export function caseStateLabel(state: CaseState): string {
  return CASE_STATE_LABELS[state]
}
