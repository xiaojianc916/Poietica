import type { TLStoreSnapshot } from 'tldraw'

export interface EditorDocumentChanges {
  readonly added: Readonly<Record<string, unknown>>
  readonly updated: Readonly<Record<string, readonly [before: unknown, after: unknown]>>
  readonly removed: Readonly<Record<string, unknown>>
}

export type EditorDocumentEvent =
  | {
      readonly kind: 'ready'
    }
  | {
      readonly kind: 'changed'
      readonly changes: EditorDocumentChanges
    }

export interface EditorDocumentPort {
  /**
   * Returns the canonical persistable tldraw document snapshot.
   *
   * Full capture is intentionally restricted to initialization and explicit
   * persistence boundaries. It must not be called for each Store transaction.
   */
  readonly captureDocument: () => TLStoreSnapshot

  /**
   * Emits ready at editor attachment and forwards tldraw's official
   * document-scoped Store diff for subsequent user transactions.
   */
  readonly subscribeDocumentEvents: (listener: (event: EditorDocumentEvent) => void) => () => void
}
