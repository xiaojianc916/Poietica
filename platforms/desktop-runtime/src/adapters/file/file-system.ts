import { IpcInvocationError, isIpcError } from '@poietica/platforms-desktop-ipc'
import {
  commands,
  type DocumentCloseRequest,
  type DocumentDescriptor,
  type DocumentOpenResponse,
  type DocumentSaveAsRequest,
  type DocumentSaveAsResult,
  type DocumentSaveRequest,
  type DocumentSaveResult,
  type DocumentId as NativeDocumentId,
} from '@poietica/platforms-desktop-ipc/generated/ipc-bindings'

export type DocumentId = NativeDocumentId

export interface OpenedDocument {
  readonly id: DocumentId
  readonly displayName: string
  readonly content: string
  readonly revision: string
  readonly assetPersistenceToken: string | null
}

export interface DocumentFileCommands {
  readonly open: () => Promise<OpenedDocument | null>

  readonly saveAs: (
    content: string,
    assetPersistenceToken: string | null,
    options?: {
      readonly documentId?: DocumentId
      readonly suggestedName?: string
    },
  ) => Promise<{
    readonly id: DocumentId
    readonly displayName: string
    readonly revision: string
  } | null>

  readonly save: (
    documentId: DocumentId,
    expectedRevision: string,
    content: string,
    assetPersistenceToken: string | null,
  ) => Promise<{ readonly revision: string }>

  readonly close: (documentId: DocumentId) => Promise<void>
}

async function invokeDocumentCommand<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (isIpcError(error)) {
      throw new IpcInvocationError(error)
    }

    throw error
  }
}

function toDocumentDescriptor(descriptor: DocumentDescriptor): {
  readonly id: DocumentId
  readonly displayName: string
  readonly revision: string
} {
  return {
    id: descriptor.documentId,
    displayName: descriptor.displayName,
    revision: descriptor.revision,
  }
}

export function createDocumentFileCommands(): DocumentFileCommands {
  return {
    async open() {
      const response: DocumentOpenResponse = await invokeDocumentCommand(() =>
        commands.documentOpen(),
      )

      if (!response.document) {
        return null
      }

      return {
        id: response.document.documentId,
        displayName: response.document.displayName,
        content: response.document.content,
        revision: response.document.revision,
        assetPersistenceToken: response.document.assetSessionToken,
      }
    },

    async saveAs(content, assetPersistenceToken, options) {
      const request: DocumentSaveAsRequest = {
        documentId: options?.documentId ?? null,
        content,
        assetSessionToken: assetPersistenceToken,
        suggestedName: options?.suggestedName ?? null,
      }

      const response: DocumentSaveAsResult = await invokeDocumentCommand(() =>
        commands.documentSaveAs(request),
      )

      return response.document ? toDocumentDescriptor(response.document) : null
    },

    async save(documentId, expectedRevision, content, assetPersistenceToken) {
      const request: DocumentSaveRequest = {
        documentId,
        expectedRevision,
        content,
        assetSessionToken: assetPersistenceToken,
      }

      const response: DocumentSaveResult = await invokeDocumentCommand(() =>
        commands.documentSave(request),
      )

      return {
        revision: response.revision,
      }
    },

    async close(documentId) {
      const request: DocumentCloseRequest = {
        documentId,
      }

      await invokeDocumentCommand(() => commands.documentClose(request))
    },
  }
}
