import { describe, expect, it } from 'vitest'
import { FailureRuntime } from './failure-runtime'

describe('non-terminal failure runtime', () => {
  it('deduplicates repeated failures while counting occurrences', () => {
    const runtime = new FailureRuntime()

    const input = {
      impact: 'recoverable' as const,
      code: 'DOCUMENT_SAVE_FAILED',
      userMessage: '保存失败，请重试。',
      technicalMessage: 'canvas save failed',
      scope: {
        kind: 'document' as const,
        documentId: 'document-1',
      },
      recovery: 'retry' as const,
    }

    runtime.report(input)
    runtime.report(input)

    const snapshot = runtime.getSnapshot()

    expect(snapshot.failures).toHaveLength(1)

    expect(snapshot.failures[0]?.occurrences).toBe(2)
  })

  it('tracks degraded features independently from notices', () => {
    const runtime = new FailureRuntime()

    const failure = runtime.report({
      impact: 'feature-degraded',
      code: 'SETTINGS_UNAVAILABLE',
      userMessage: '设置暂时不可用。',
      technicalMessage: 'settings load failed',
      scope: {
        kind: 'feature',
        featureId: 'settings',
      },
      recovery: 'disable-feature',
    })

    runtime.dismiss(failure.id)

    expect(runtime.getSnapshot().failures).toHaveLength(0)

    expect(runtime.getSnapshot().degradedFeatures).toContain('settings')

    runtime.resolveScope({
      kind: 'feature',
      featureId: 'settings',
    })

    expect(runtime.getSnapshot().degradedFeatures).not.toContain('settings')
  })

  it('tracks document quarantine separately from application fatal state', () => {
    const runtime = new FailureRuntime()

    runtime.report({
      impact: 'document-fatal',
      code: 'DOCUMENT_STATE_UNSAFE',
      userMessage: '当前文档无法安全继续。',
      technicalMessage: 'document invariant failed',
      scope: {
        kind: 'document',
        documentId: 'document-1',
      },
      recovery: 'close-document',
    })

    expect(runtime.getSnapshot().quarantinedDocuments).toContain('document-1')
  })
})
