import type { Case, JsonValue, Run, Scenario } from '@open-waterhammer/contracts'

export interface ComparisonRow<T> {
  path: string
  values: Array<T | undefined>
}

export function formatComparisonNumber(value: number): string {
  return String(value)
}

/** JsonValue を「パス → 末端値」の一覧に再帰的に平坦化する（配列は [i]、オブジェクトは .key で連結）。 */
export function flattenComparisonValue(value: JsonValue, prefix = ''): Array<[string, JsonValue]> {
  if (Array.isArray(value)) return value.flatMap((child, index) => flattenComparisonValue(child, `${prefix}[${index}]`))
  if (value && typeof value === 'object') return Object.keys(value).sort().flatMap((key) => flattenComparisonValue(value[key]!, prefix ? `${prefix}.${key}` : key))
  return [[prefix, value]]
}

function latestRun(caseId: string, runs: Run[]): Run | undefined {
  return runs.filter((run) => run.caseId === caseId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
}

export function buildComparisonRows(cases: Case[], scenarios: Scenario[], runs: Run[]): {
  conditionRows: Array<ComparisonRow<JsonValue>>
  resultRows: Array<ComparisonRow<number> & { deltas: Array<number | undefined> }>
} {
  const conditions = cases.map((caseRecord) => {
    const scenario = scenarios.find(({ caseId }) => caseId === caseRecord.id)
    return Object.fromEntries(flattenComparisonValue({
      model: caseRecord.modelSnapshot,
      scenario: {
        boundaryConditions: scenario?.boundaryConditions ?? null,
        eventSettings: scenario?.eventSettings ?? null,
        protectionSettings: scenario?.protectionSettings ?? null,
      },
    }))
  })
  const conditionPaths = [...new Set(conditions.flatMap(Object.keys))].sort()
  const conditionRows = conditionPaths.map((path) => ({ path, values: conditions.map((condition) => condition[path]) }))
    .filter(({ values }) => new Set(values.map((value) => JSON.stringify(value))).size > 1)

  const results = cases.map((caseRecord) => {
    const run = latestRun(caseRecord.id, runs)
    return Object.fromEntries(run ? flattenComparisonValue(run.summary).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])).map(([path, value]) => [`summary.${path}`, value]) : [])
  })
  const resultPaths = [...new Set(results.flatMap(Object.keys))].sort()
  const resultRows = resultPaths.map((path) => {
    const values = results.map((result) => result[path])
    const baseline = values[0]
    return { path, values, deltas: values.map((value) => value === undefined || baseline === undefined ? undefined : value - baseline) }
  })
  return { conditionRows, resultRows }
}
