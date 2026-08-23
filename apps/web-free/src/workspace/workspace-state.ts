import type { WorkspaceData } from '@open-waterhammer/workspace'

export const WORKSPACE_TABS = [
  'overview',
  'model-gis',
  'scenario',
  'analysis',
  'results',
  'compare',
  'reports',
] as const

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number]

export interface WorkspaceRouteSelection {
  projectId: string
  caseId: string
  tab: WorkspaceTab
}

interface RouteCandidate {
  projectId?: string
  caseId?: string
  tab?: string
}

function isWorkspaceTab(value: unknown): value is WorkspaceTab {
  return typeof value === 'string' && (WORKSPACE_TABS as readonly string[]).includes(value)
}

function caseBelongsToProject(data: WorkspaceData, caseId: string, projectId: string): boolean {
  const record = data.cases.find(({ id }) => id === caseId)
  if (!record) return false
  const alternative = data.alternatives.find(({ id }) => id === record.alternativeId)
  return alternative?.projectId === projectId
}

function newestByUpdatedAt<T extends { updatedAt: string }>(records: T[]): T | undefined {
  return [...records].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
}

export function resolveWorkspaceRoute(
  data: WorkspaceData,
  candidate: RouteCandidate,
  recent?: RouteCandidate,
): WorkspaceRouteSelection {
  const candidateProject = data.projects.find(({ id }) => id === candidate.projectId)
  const recentProject = data.projects.find(({ id }) => id === recent?.projectId)
  const project = candidateProject ?? recentProject ?? newestByUpdatedAt(data.projects)
  if (!project) throw new Error('Workspace has no Project')

  const projectAlternatives = new Set(
    data.alternatives.filter(({ projectId }) => projectId === project.id).map(({ id }) => id),
  )
  const projectCases = data.cases.filter(({ alternativeId }) => projectAlternatives.has(alternativeId))
  const candidateCase = candidate.caseId && caseBelongsToProject(data, candidate.caseId, project.id)
    ? data.cases.find(({ id }) => id === candidate.caseId)
    : undefined
  const recentCase = recent?.caseId && caseBelongsToProject(data, recent.caseId, project.id)
    ? data.cases.find(({ id }) => id === recent.caseId)
    : undefined
  const caseRecord = candidateCase ?? recentCase ?? newestByUpdatedAt(projectCases)
  if (!caseRecord) throw new Error('Project has no Case')

  return {
    projectId: project.id,
    caseId: caseRecord.id,
    tab: isWorkspaceTab(candidate.tab)
      ? candidate.tab
      : isWorkspaceTab(recent?.tab) ? recent.tab : 'overview',
  }
}

export function canCompareCases(selection: readonly string[]): boolean {
  const count = new Set(selection).size
  return count >= 2 && count <= 4
}

export function toggleComparisonCase(
  selection: readonly string[],
  caseId: string,
): { selection: string[]; error?: string } {
  const unique = [...new Set(selection)]
  if (unique.includes(caseId)) return { selection: unique.filter((id) => id !== caseId) }
  if (unique.length >= 4) return { selection: unique, error: '比較できる Case は最大4件です。' }
  return { selection: [...unique, caseId] }
}
