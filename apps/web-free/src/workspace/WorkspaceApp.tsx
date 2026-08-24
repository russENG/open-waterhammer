import type { CalculationExecutorRegistry } from '@open-waterhammer/runner'
import type { WorkspaceData } from '@open-waterhammer/workspace'
import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'

import { prefetchPyodide } from '../lib/pyodide-bridge'
import type { BrowserProtocolCaller } from '../runner/browser-runner'
import { WorkspaceLayout } from './WorkspaceLayout'
import { WorkspaceProvider, type WorkspaceRepositoryClient } from './workspace-context'
import { resolveWorkspaceRoute } from './workspace-state'

export function WorkspaceApp({
  repository,
  initialData,
  executors,
  callProtocol,
}: {
  repository: WorkspaceRepositoryClient
  initialData: WorkspaceData
  executors?: CalculationExecutorRegistry
  callProtocol?: BrowserProtocolCaller
}) {
  useEffect(() => {
    // Executors are only injected by tests (and any future caller that wants full control
    // over calculation execution) — the real app always mounts without them. Skipping the
    // prefetch when they're present keeps those runs fast and network-free, since nothing
    // in that path ever needs the real Pyodide runtime.
    if (executors) return
    const schedule = typeof requestIdleCallback === 'function'
      ? requestIdleCallback
      : (callback: () => void) => setTimeout(callback, 0)
    const cancel = typeof cancelIdleCallback === 'function' ? cancelIdleCallback : clearTimeout
    const handle = schedule(() => prefetchPyodide())
    return () => cancel(handle as number)
  }, [executors])

  const fallback = resolveWorkspaceRoute(initialData, {})
  const fallbackPath = `/projects/${fallback.projectId}/cases/${fallback.caseId}/${fallback.tab}`
  return <WorkspaceProvider repository={repository} initialData={initialData} executors={executors} callProtocol={callProtocol}>
    <HashRouter>
      <Routes>
        <Route path="/projects/:projectId/cases/:caseId/:tab" element={<WorkspaceLayout />} />
        <Route path="*" element={<Navigate replace to={fallbackPath} />} />
      </Routes>
    </HashRouter>
  </WorkspaceProvider>
}
