import {
  createEditorSessionRegistry,
  type EditorAssetStoreSessionFactory,
  PersistedSnapshotLoadError,
} from '@poietica/canvas/application'
import type { TLAssetStore, TLStoreSnapshot } from 'tldraw'
import { describe, expect, it, vi } from 'vitest'

function invalidPersistedSnapshot(): TLStoreSnapshot {
  return {
    schema: null,
    store: null,
  } as unknown as TLStoreSnapshot
}

function createAssetStoreHarness() {
  const dispose = vi.fn(async (): Promise<void> => {})
  const getPersistenceToken = vi.fn(async (): Promise<string | null> => null)

  const factory: EditorAssetStoreSessionFactory = () => ({
    assets: {
      upload: vi.fn(),
    } as unknown as TLAssetStore,
    getPersistenceToken,
    dispose,
  })

  return {
    factory,
    dispose,
  }
}

describe('EditorSessionRegistry persisted snapshot boundary', () => {
  it('does not register a session when tldraw rejects persisted data', async () => {
    const assets = createAssetStoreHarness()
    const registry = createEditorSessionRegistry(assets.factory)
    const sessionId = 'invalid-persisted-session'

    await expect(
      registry.create({
        sessionId,
        documentId: 'invalid-persisted-document',
        initialSnapshot: invalidPersistedSnapshot(),
        extensions: [],
      }),
    ).rejects.toThrow(PersistedSnapshotLoadError)

    expect(registry.get(sessionId)).toBeNull()
    expect(assets.dispose).toHaveBeenCalledTimes(1)
  })

  it('remains usable after a rejected persisted snapshot', async () => {
    const assets = createAssetStoreHarness()
    const registry = createEditorSessionRegistry(assets.factory)

    await expect(
      registry.create({
        sessionId: 'rejected-session',
        documentId: 'rejected-document',
        initialSnapshot: invalidPersistedSnapshot(),
        extensions: [],
      }),
    ).rejects.toThrow('DRAW_INVALID_SNAPSHOT')

    expect(registry.get('rejected-session')).toBeNull()

    const valid = await registry.create({
      sessionId: 'valid-session',
      documentId: 'valid-document',
      extensions: [],
    })

    expect(valid.sessionId).toBe('valid-session')
    expect(registry.get('valid-session')).toBe(valid)

    await registry.close('valid-session')

    expect(registry.get('valid-session')).toBeNull()
    expect(assets.dispose).toHaveBeenCalledTimes(2)
  })

  it('binds restored resources and persistence capture to the same session', async () => {
    const persistenceToken = 'restored-native-session'

    const getPersistenceToken = vi.fn(async (): Promise<string | null> => persistenceToken)
    const dispose = vi.fn(async (): Promise<void> => {})

    const factoryMock = vi.fn((_restore?: unknown) => ({
      assets: {
        upload: vi.fn(),
      } as unknown as TLAssetStore,
      getPersistenceToken,
      dispose,
    }))

    const factory: EditorAssetStoreSessionFactory = (restore) => factoryMock(restore)

    const registry = createEditorSessionRegistry(factory)

    const session = await registry.create({
      sessionId: 'restored-editor-session',
      documentId: 'restored-document',
      assetStoreRestore: {
        persistenceToken,
      },
      extensions: [],
    })

    expect(factoryMock).toHaveBeenCalledWith({
      persistenceToken,
    })

    await expect(session.captureAssetPersistenceToken()).resolves.toBe(persistenceToken)

    expect(getPersistenceToken).toHaveBeenCalledTimes(1)

    await registry.close(session.sessionId)
  })

  it('waits for owned asset disposal before close settles', async () => {
    let releaseAssetStore: () => void = () => {}

    const dispose = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseAssetStore = () => resolve()
        }),
    )

    const registry = createEditorSessionRegistry(() => ({
      assets: {
        upload: vi.fn(),
      } as unknown as TLAssetStore,
      getPersistenceToken: vi.fn(async (): Promise<string | null> => null),
      dispose,
    }))

    const session = await registry.create({
      sessionId: 'asset-owned-session',
      documentId: 'asset-owned-document',
      extensions: [],
    })

    const closing = registry.close(session.sessionId)
    let settled = false

    void closing.then(() => {
      settled = true
    })

    await Promise.resolve()

    expect(registry.get(session.sessionId)).toBeNull()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)

    releaseAssetStore()
    await closing

    expect(settled).toBe(true)
  })
})
