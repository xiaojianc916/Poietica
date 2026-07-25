import { createCanvasDocumentService } from '@poietica/editor-document'
import { describe, expect, it, vi } from 'vitest'

const VALID_STORE_SNAPSHOT = JSON.stringify({
  schema: {},
  store: {},
})

interface HarnessOptions {
  readonly content: string
  readonly editorOpenError?: Error
  readonly rollbackError?: Error
}

function createHarness({
  content,
  editorOpenError = new Error('DRAW_INVALID_SNAPSHOT'),
  rollbackError,
}: HarnessOptions) {
  const editorSessions = {
    create: vi.fn(() => Promise.reject(editorOpenError)),
    close: vi.fn(),
    dispose: vi.fn(),
  }

  const close = rollbackError
    ? vi.fn(() => Promise.reject(rollbackError))
    : vi.fn(() => Promise.resolve())

  const persistence = {
    open: vi.fn(async () => ({
      id: 'native-document-id',
      displayName: 'broken.draw',
      content,
      revision: 'revision-current',
      assetPersistenceToken: null,
    })),
    save: vi.fn(async () => ({
      revision: 'revision-next',
    })),
    saveAs: vi.fn(async () => null),
    close,
  }

  const service = createCanvasDocumentService({
    editorSessions,
    persistence,
    extensions: [],
  })

  return {
    service,
    editorSessions,
    persistence,
  }
}

describe('CanvasDocumentService open transaction', () => {
  it('closes the native document when outer parsing fails', async () => {
    const { service, editorSessions, persistence } = createHarness({
      content: 'not-json',
    })

    await expect(service.open()).rejects.toThrow()

    expect(editorSessions.create).not.toHaveBeenCalled()
    expect(persistence.close).toHaveBeenCalledTimes(1)
    expect(persistence.close).toHaveBeenCalledWith('native-document-id')
  })

  it('closes the native document when tldraw snapshot loading fails', async () => {
    const snapshotError = new Error('DRAW_INVALID_SNAPSHOT')
    const { service, editorSessions, persistence } = createHarness({
      content: VALID_STORE_SNAPSHOT,
      editorOpenError: snapshotError,
    })

    await expect(service.open()).rejects.toBe(snapshotError)

    expect(editorSessions.create).toHaveBeenCalledTimes(1)
    expect(persistence.close).toHaveBeenCalledTimes(1)
    expect(persistence.close).toHaveBeenCalledWith('native-document-id')
  })

  it('preserves both failures when native rollback fails', async () => {
    const snapshotError = new Error('DRAW_INVALID_SNAPSHOT')
    const rollbackError = new Error('NATIVE_DOCUMENT_CLOSE_FAILED')
    const { service, persistence } = createHarness({
      content: VALID_STORE_SNAPSHOT,
      editorOpenError: snapshotError,
      rollbackError,
    })

    let failure: unknown

    try {
      await service.open()
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(AggregateError)

    const aggregate = failure as AggregateError

    expect(aggregate.message).toBe('DOCUMENT_OPEN_ROLLBACK_FAILED')
    expect(aggregate.errors).toEqual([snapshotError, rollbackError])
    expect(persistence.close).toHaveBeenCalledTimes(1)
    expect(persistence.close).toHaveBeenCalledWith('native-document-id')
  })
})
