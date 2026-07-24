import type {
  CanvasDocumentLifecycleSnapshot,
  CanvasDocumentService,
  CanvasReleaseResult,
} from '@hybrid-canvas/document'
import { describe, expect, it, vi } from 'vitest'

import { createCanvasWorkflow } from './canvas-workflow'

type ReleaseHandler = (
  sessionId: string,
  intent: 'normal' | 'discard',
) => Promise<CanvasReleaseResult>

function createDocumentPort(
  releaseHandler: ReleaseHandler,
  getLifecycleSnapshot: () => CanvasDocumentLifecycleSnapshot = () => ({
    savingOperations: [],
    unsavedSessionIds: [],
  }),
) {
  return {
    create: vi.fn(() => ({
      canvasId: 'canvas-1',
      sessionId: 'session-1',
      title: 'Canvas',
    })),
    open: vi.fn(),
    save: vi.fn(),
    releaseCanvas: vi.fn(releaseHandler),
    getLifecycleSnapshot: vi.fn(getLifecycleSnapshot),
    getEditorSession: vi.fn(() => null),
    getSessionSnapshot: vi.fn(() => null),
    getVersion: vi.fn(() => 0),
    subscribe: vi.fn(() => () => {}),
    dispose: vi.fn(),
  } as unknown as CanvasDocumentService
}

function createWorkspace() {
  return {
    createCanvas: vi.fn(),
    closeCanvas: vi.fn(),
  }
}

describe('CanvasWorkflow lifecycle coordinator', () => {
  it('removes a workspace tab only after native release succeeds', async () => {
    const documents = createDocumentPort(async () => ({
      kind: 'released',
    }))

    const workspace = createWorkspace()
    const workflow = createCanvasWorkflow(documents, workspace as never)

    await workflow.closeCanvas('session-a', 'normal')

    expect(workspace.closeCanvas).toHaveBeenCalledWith('session-a')
    expect(workflow.getCloseSnapshot()).toEqual({
      states: {},
    })
  })

  it('keeps different session transactions independent while one is releasing', async () => {
    let resolveReleaseA!: () => void

    const pendingReleaseA = new Promise<void>((resolve) => {
      resolveReleaseA = resolve
    })

    const documents = createDocumentPort(async (sessionId) => {
      if (sessionId === 'session-a') {
        await pendingReleaseA
        return { kind: 'released' }
      }

      return { kind: 'confirmation-required' }
    })

    const workspace = createWorkspace()
    const workflow = createCanvasWorkflow(documents, workspace as never)

    const closeA = workflow.closeCanvas('session-a', 'normal')
    await workflow.closeCanvas('session-b', 'normal')

    expect(workflow.getCloseSnapshot()).toEqual({
      states: {
        'session-a': {
          state: 'releasing',
          intent: 'normal',
        },
        'session-b': {
          state: 'confirmation-required',
        },
      },
    })

    expect(workspace.closeCanvas).not.toHaveBeenCalled()

    resolveReleaseA()
    await closeA

    expect(workspace.closeCanvas).toHaveBeenCalledWith('session-a')
    expect(workflow.getCloseSnapshot()).toEqual({
      states: {
        'session-b': {
          state: 'confirmation-required',
        },
      },
    })
  })

  it('deduplicates only repeated requests for the same session', async () => {
    let resolveRelease!: () => void

    const pendingRelease = new Promise<void>((resolve) => {
      resolveRelease = resolve
    })

    const documents = createDocumentPort(async () => {
      await pendingRelease

      return { kind: 'released' }
    })

    const workspace = createWorkspace()
    const workflow = createCanvasWorkflow(documents, workspace as never)

    const first = workflow.closeCanvas('session-a', 'normal')
    const duplicate = workflow.closeCanvas('session-a', 'discard')

    expect(duplicate).toBe(first)
    expect(documents.releaseCanvas).toHaveBeenCalledTimes(1)
    expect(documents.releaseCanvas).toHaveBeenCalledWith('session-a', 'normal')

    resolveRelease()
    await first

    expect(workspace.closeCanvas).toHaveBeenCalledWith('session-a')
  })

  it('cancels only the selected confirmation state', async () => {
    const documents = createDocumentPort(async () => ({
      kind: 'confirmation-required',
    }))

    const workspace = createWorkspace()
    const workflow = createCanvasWorkflow(documents, workspace as never)

    await workflow.closeCanvas('session-a', 'normal')
    await workflow.closeCanvas('session-b', 'normal')

    workflow.cancelCanvasClose('session-a')

    expect(workflow.getCloseSnapshot()).toEqual({
      states: {
        'session-b': {
          state: 'confirmation-required',
        },
      },
    })
  })

  it('preserves discard intent and failure classification for retry', async () => {
    let attempts = 0

    const documents = createDocumentPort(() => {
      attempts += 1

      if (attempts === 1) {
        return Promise.resolve({
          kind: 'release-failed',
          failure: {
            code: 'persistence',
            recoverable: true,
          },
        })
      }

      return Promise.resolve({ kind: 'released' })
    })

    const workspace = createWorkspace()
    const workflow = createCanvasWorkflow(documents, workspace as never)

    await workflow.closeCanvas('session-a', 'discard')

    expect(workflow.getCloseSnapshot()).toEqual({
      states: {
        'session-a': {
          state: 'release-failed',
          intent: 'discard',
          failure: {
            code: 'persistence',
            recoverable: true,
          },
        },
      },
    })

    await workflow.closeCanvas('session-a', 'discard')

    expect(documents.releaseCanvas).toHaveBeenNthCalledWith(1, 'session-a', 'discard')

    expect(documents.releaseCanvas).toHaveBeenNthCalledWith(2, 'session-a', 'discard')

    expect(workspace.closeCanvas).toHaveBeenCalledWith('session-a')
  })

  it('waits for both active saves and native releases before application termination', async () => {
    let resolveSave!: () => void
    let resolveRelease!: () => void

    const saving = new Promise<void>((resolve) => {
      resolveSave = resolve
    })

    const releasing = new Promise<void>((resolve) => {
      resolveRelease = resolve
    })

    const documents = createDocumentPort(
      async () => {
        await releasing
        return { kind: 'released' }
      },
      () => ({
        savingOperations: [saving],
        unsavedSessionIds: [],
      }),
    )

    const workspace = createWorkspace()
    const workflow = createCanvasWorkflow(documents, workspace as never)

    const closeOperation = workflow.closeCanvas('session-a', 'normal')

    expect(workflow.planApplicationClose()).toEqual({
      kind: 'wait-for-settlement',
      operations: [saving, closeOperation],
    })

    resolveSave()
    resolveRelease()

    await Promise.all([saving, closeOperation])

    expect(workspace.closeCanvas).toHaveBeenCalledWith('session-a')
  })
})
