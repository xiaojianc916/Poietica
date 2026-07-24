import { IpcInvocationError, isIpcError } from '@hybrid-canvas/desktop-ipc'
import {
  commands,
  type AssetRemoveRequest,
  type AssetSessionCloseRequest,
  type AssetUploadRequest,
  type AssetUploadResult,
} from '@hybrid-canvas/desktop-ipc/generated/ipc-bindings'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { TLAsset, TLAssetId, TLAssetStore } from 'tldraw'

const ASSET_PROTOCOL_SCHEME = 'hybrid-canvas-asset'
const ASSET_PROTOCOL_HOST = 'asset'

interface OpenedNativeAssetSession {
  readonly sessionToken: string
}

export interface NativeAssetStoreSessionRestore {
  /**
   * Process-local capability returned by Native document restoration.
   *
   * This token is never persisted into the .draw container and must never be
   * interpreted as a filesystem path or archive entry.
   */
  readonly persistenceToken: string
}

export interface NativeTLAssetStoreSession {
  readonly assets: TLAssetStore

  /**
   * Returns the Native session capability after all queued asset operations
   * have settled. A document with no Native resources returns null without
   * opening an otherwise-unused session.
   */
  readonly getPersistenceToken: () => Promise<string | null>

  readonly dispose: () => Promise<void>
}

async function invokeAssetCommand<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (isIpcError(error)) {
      throw new IpcInvocationError(error)
    }

    throw error
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return
  }

  throw new DOMException('Asset upload was aborted.', 'AbortError')
}

function validateNativeSource(source: string, sessionToken: string, assetToken: string): void {
  let parsed: URL

  try {
    parsed = new URL(source)
  } catch {
    throw new Error('NATIVE_ASSET_SOURCE_INVALID')
  }

  if (
    parsed.protocol !== `${ASSET_PROTOCOL_SCHEME}:` ||
    parsed.hostname !== ASSET_PROTOCOL_HOST ||
    parsed.pathname !== `/${sessionToken}/${assetToken}` ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('NATIVE_ASSET_SOURCE_INVALID')
  }
}

function validatePersistenceToken(token: string): void {
  if (token.length === 0 || token.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(token)) {
    throw new Error('NATIVE_ASSET_PERSISTENCE_TOKEN_INVALID')
  }
}

function persistedAssetToken(asset: TLAsset): string | null {
  const token = asset.meta?.hybridCanvasAssetToken

  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/u.test(token)) {
    return null
  }

  const contentHash = asset.meta?.hybridCanvasContentHash

  if (typeof contentHash !== 'string' || contentHash !== token) {
    return null
  }

  return token
}

function toWebviewAssetUrl(sessionToken: string, assetToken: string): string {
  return convertFileSrc(`/asset/${sessionToken}/${assetToken}`, ASSET_PROTOCOL_SCHEME)
}

async function removeUploadedAsset(sessionToken: string, assetToken: string): Promise<void> {
  const request: AssetRemoveRequest = {
    sessionToken,
    assetToken,
  }

  await invokeAssetCommand(() => commands.assetRemove(request))
}

/**
 * Creates the official tldraw asset store synchronously.
 *
 * Native state is opened by the first upload rather than during application or
 * editor construction. This keeps createTLStore({ assets }) synchronous and
 * avoids creating unused Native sessions.
 */
export function createNativeTLAssetStoreSession(
  restore?: NativeAssetStoreSessionRestore,
): NativeTLAssetStoreSession {
  const assetTokens = new Map<TLAssetId, string>()

  const restoredSessionToken = restore?.persistenceToken ?? null

  if (restoredSessionToken) {
    validatePersistenceToken(restoredSessionToken)
  }

  let openedSessionPromise: Promise<OpenedNativeAssetSession> | null = restoredSessionToken
    ? Promise.resolve({
        sessionToken: restoredSessionToken,
      })
    : null

  let operationTail: Promise<void> = Promise.resolve()
  let disposePromise: Promise<void> | null = null
  let disposed = false

  function assertActive(): void {
    if (disposed) {
      throw new Error('NATIVE_ASSET_SESSION_DISPOSED')
    }
  }

  function requireOpenedSession(): Promise<OpenedNativeAssetSession> {
    if (openedSessionPromise) {
      return openedSessionPromise
    }

    openedSessionPromise = invokeAssetCommand(async () => {
      const opened = await commands.assetSessionOpen()

      return {
        sessionToken: opened.sessionToken,
      }
    })

    return openedSessionPromise
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationTail.then(operation)

    operationTail = result.then(
      () => undefined,
      () => undefined,
    )

    return result
  }

  const assets: TLAssetStore = {
    upload(asset: TLAsset, file: File, abortSignal?: AbortSignal) {
      assertActive()

      return enqueue(async () => {
        assertActive()
        throwIfAborted(abortSignal)

        const buffer = await file.arrayBuffer()

        throwIfAborted(abortSignal)

        if (assetTokens.has(asset.id)) {
          throw new Error('NATIVE_ASSET_ID_ALREADY_UPLOADED')
        }

        const { sessionToken } = await requireOpenedSession()

        throwIfAborted(abortSignal)

        const request: AssetUploadRequest = {
          sessionToken,
          contentType: file.type,
          bytes: Array.from(new Uint8Array(buffer)),
        }

        const uploaded: AssetUploadResult = await invokeAssetCommand(() =>
          commands.assetUpload(request),
        )

        try {
          validateNativeSource(uploaded.source, sessionToken, uploaded.assetToken)

          throwIfAborted(abortSignal)
        } catch (error) {
          await removeUploadedAsset(sessionToken, uploaded.assetToken).catch(() => {
            /*
             * Preserve the original validation or abort failure. Session
             * disposal remains the final bounded cleanup operation.
             */
          })

          throw error
        }

        assetTokens.set(asset.id, uploaded.assetToken)

        return {
          src: toWebviewAssetUrl(sessionToken, uploaded.assetToken),
          meta: {
            hybridCanvasAssetToken: uploaded.assetToken,
            hybridCanvasContentHash: uploaded.contentHash,
            hybridCanvasByteLength: uploaded.byteLength,
            hybridCanvasContentType: uploaded.contentType,
          },
        }
      })
    },

    resolve(asset) {
      assertActive()

      /*
       * Persisted protocol URLs contain a process-local session token from the
       * process that wrote the file. They are never trusted after reopening.
       *
       * A restored document resolves its content-addressed asset identity
       * against the new Native session created by document_open.
       */
      if (restoredSessionToken) {
        const assetToken = persistedAssetToken(asset)

        if (!assetToken) {
          return null
        }

        assetTokens.set(asset.id, assetToken)

        return toWebviewAssetUrl(restoredSessionToken, assetToken)
      }

      const source = asset.props.src

      return typeof source === 'string' && source.length > 0 ? source : null
    },

    remove(assetIds: TLAssetId[]) {
      assertActive()

      return enqueue(async () => {
        assertActive()

        if (assetIds.length === 0) {
          return
        }

        const removals = assetIds.flatMap((assetId) => {
          const assetToken = assetTokens.get(assetId)

          return assetToken ? [{ assetId, assetToken }] : []
        })

        if (removals.length === 0) {
          return
        }

        const { sessionToken } = await requireOpenedSession()

        for (const { assetId, assetToken } of removals) {
          await removeUploadedAsset(sessionToken, assetToken)

          assetTokens.delete(assetId)
        }
      })
    },
  }

  return {
    assets,

    async getPersistenceToken() {
      assertActive()

      /*
       * Wait for uploads and removals already accepted by this adapter. This
       * gives the document writer a stable Native resource snapshot boundary.
       */
      await operationTail

      assertActive()

      if (!openedSessionPromise) {
        return null
      }

      const { sessionToken } = await openedSessionPromise

      return sessionToken
    },

    dispose() {
      if (disposePromise) {
        return disposePromise
      }

      disposed = true

      disposePromise = enqueue(async () => {
        const sessionPromise = openedSessionPromise

        assetTokens.clear()

        if (!sessionPromise) {
          return
        }

        const { sessionToken } = await sessionPromise

        const request: AssetSessionCloseRequest = {
          sessionToken,
        }

        await invokeAssetCommand(() => commands.assetSessionClose(request))
      })

      return disposePromise
    },
  }
}
