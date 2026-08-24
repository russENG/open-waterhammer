import type { AssessmentFinding } from '@open-waterhammer/contracts'

export interface LinkedFocus {
  targetRef: string
  location?: string
  mapFeatureId: string
  profileCursor: string
  envelopeSeriesId: string
  timeSeriesId: string
}

export function createLinkedFocus(finding: AssessmentFinding): LinkedFocus {
  return {
    targetRef: finding.targetRef,
    ...(finding.location === undefined ? {} : { location: finding.location }),
    mapFeatureId: finding.targetRef,
    profileCursor: finding.location ?? finding.targetRef,
    envelopeSeriesId: finding.targetRef,
    timeSeriesId: finding.targetRef,
  }
}
