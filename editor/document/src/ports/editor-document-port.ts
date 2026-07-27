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
   * 在编辑器挂载时投递 ready，其后转发 tldraw 官方的 Store diff，作用域为
   * document、来源为 user。
   *
   * ready 标记干净基线。挂载是"初始文档记录已存在"这个事实的最早可观测点：
   * 新建画布不传快照，默认记录由 tldraw 的 Editor 补齐。
   */
  readonly subscribeDocumentEvents: (listener: (event: EditorDocumentEvent) => void) => () => void
}
