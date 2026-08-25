import type { Project } from '@open-waterhammer/contracts'
import { inspectProjectBundle, type WorkspaceRepository } from '@open-waterhammer/workspace'

export interface ImportSummary {
  project: Project
  alternatives: number
  cases: number
  scenarios: number
  runs: number
  legacyArtifacts: number
}

const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|]/g

function slugifyProjectName(name: string): string {
  const slug = name
    .trim()
    .replace(UNSAFE_FILENAME_CHARS, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'project'
}

/**
 * Exports a Project as a deterministic `.owhproj` bundle, reading through the repository
 * (`WorkspaceRepository.exportBundle`) so the browser's IndexedDB state is the source of
 * truth — never a caller-held `WorkspaceData` snapshot, which may be stale.
 */
export async function exportProjectFile(
  repository: Pick<WorkspaceRepository, 'exportBundle'>,
  projectId: string,
): Promise<{ name: string; bytes: Uint8Array }> {
  const bytes = await repository.exportBundle(projectId)
  // exportBundle already validated the archive it just built (exportProjectBundle calls
  // validateProjectBundle before returning), so this inspection cannot fail here — it is only
  // how this function learns the Project's name for the filename; WorkspaceRepository's public
  // surface deliberately has no separate "read one Project" method.
  const inspection = await inspectProjectBundle(bytes)
  return { name: `${slugifyProjectName(inspection.project.name)}.owhproj`, bytes }
}

/**
 * Imports a `.owhproj` file through the repository (atomic and validating —
 * `WorkspaceRepositoryBase.importBundle` rejects corrupt bytes, a schema/checksum mismatch, or
 * any id that collides with an existing workspace entity; nothing is written on rejection).
 * Returns counts for UI feedback. Callers own refreshing their own view of workspace state
 * afterwards — this module has none to refresh.
 */
export async function importProjectFile(
  repository: Pick<WorkspaceRepository, 'importBundle'>,
  file: File,
): Promise<ImportSummary> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const project = await repository.importBundle(bytes)
  // importBundle already validated and committed the bundle; inspecting the same bytes again is
  // read-only and cannot fail at this point. It is how this function learns the per-type counts
  // to report, since importBundle's own return value is only the imported Project.
  const inspection = await inspectProjectBundle(bytes)
  return {
    project,
    alternatives: inspection.alternatives.length,
    cases: inspection.cases.length,
    scenarios: inspection.scenarios.length,
    runs: inspection.runs.length,
    legacyArtifacts: inspection.legacyArtifacts.length,
  }
}

/** Validates a Project file and atomically replaces the browser workspace with it. */
export async function replaceProjectFile(
  repository: Pick<WorkspaceRepository, 'replaceBundle'>,
  file: File,
): Promise<ImportSummary> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const inspection = await inspectProjectBundle(bytes)
  if (inspection.cases.length === 0) {
    throw new Error('比較案が含まれていないため、このプロジェクトは開けません。')
  }
  const project = await repository.replaceBundle(bytes)
  return {
    project,
    alternatives: inspection.alternatives.length,
    cases: inspection.cases.length,
    scenarios: inspection.scenarios.length,
    runs: inspection.runs.length,
    legacyArtifacts: inspection.legacyArtifacts.length,
  }
}

/** Thin, non-pure DOM trigger for a browser file download — the only side-effecting export here. */
export function downloadProjectFile(file: { name: string; bytes: Uint8Array }): void {
  // `.slice()` copies into a fresh, concretely `ArrayBuffer`-backed Uint8Array — `file.bytes`
  // itself is typed `Uint8Array<ArrayBufferLike>` (the default when a caller's own Uint8Array
  // isn't pinned to a buffer type), which BlobPart's `ArrayBufferView<ArrayBuffer>` rejects.
  // Same workaround already used by `../reports/run-exports.ts` callers in ReportsPanel.tsx.
  const url = URL.createObjectURL(new Blob([file.bytes.slice()], { type: 'application/octet-stream' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  anchor.click()
  URL.revokeObjectURL(url)
}
