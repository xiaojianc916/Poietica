import { describe, expect, it } from 'vitest'
import {
  createClassifiedFailure,
  createFailureScopeKey,
  isNonTerminalFailureImpact,
  isTerminalFailureImpact,
} from './failure-policy'

describe('application failure policy', () => {
  it('distinguishes terminal impacts', () => {
    expect(isTerminalFailureImpact('application-fatal')).toBe(true)

    expect(isTerminalFailureImpact('native-fatal')).toBe(true)

    expect(isNonTerminalFailureImpact('recoverable')).toBe(true)

    expect(isNonTerminalFailureImpact('document-fatal')).toBe(true)
  })

  it('creates stable scope keys', () => {
    expect(
      createFailureScopeKey({
        kind: 'feature',
        featureId: 'settings',
      }),
    ).toBe('feature:settings')

    expect(
      createFailureScopeKey({
        kind: 'document',
        documentId: 'document-1',
      }),
    ).toBe('document:document-1')
  })

  it('creates unique IDs and stable fingerprints', () => {
    const input = {
      impact: 'recoverable' as const,
      code: 'DOCUMENT_SAVE_FAILED',
      userMessage: '保存失败，请重试。',
      technicalMessage: 'document save failed',
      scope: {
        kind: 'document' as const,
        documentId: 'document-1',
      },
      recovery: 'retry' as const,
    }

    const first = createClassifiedFailure(input)

    const second = createClassifiedFailure(input)

    expect(first.id).not.toBe(second.id)

    expect(first.fingerprint).toBe(second.fingerprint)
  })

  it('rejects feature degradation without feature ownership', () => {
    expect(() => {
      createClassifiedFailure({
        impact: 'feature-degraded',
        code: 'SETTINGS_UNAVAILABLE',
        userMessage: '设置暂时不可用。',
        technicalMessage: 'settings unavailable',
        scope: {
          kind: 'operation',
          operation: 'load-settings',
        },
        recovery: 'disable-feature',
      })
    }).toThrow('Feature-degraded failure requires a feature scope.')
  })

  it('rejects document fatal without document ownership', () => {
    expect(() => {
      createClassifiedFailure({
        impact: 'document-fatal',
        code: 'DOCUMENT_CORRUPTED',
        userMessage: '文档无法继续使用。',
        technicalMessage: 'document invariant failed',
        scope: {
          kind: 'application',
        },
        recovery: 'close-document',
      })
    }).toThrow('Document-fatal failure requires a document scope.')
  })

  it('rejects terminal recovery on recoverable failure', () => {
    expect(() => {
      createClassifiedFailure({
        impact: 'recoverable',
        code: 'OPERATION_FAILED',
        userMessage: '操作失败。',
        technicalMessage: 'operation failed',
        scope: {
          kind: 'operation',
          operation: 'save',
        },
        recovery: 'reload',
      })
    }).toThrow('Recovery reload is invalid for impact recoverable.')
  })
})
