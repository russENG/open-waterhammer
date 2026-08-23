import type { CalculationExecutorRegistry } from '@open-waterhammer/runner'
import type { WorkspaceData } from '@open-waterhammer/workspace'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'

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
