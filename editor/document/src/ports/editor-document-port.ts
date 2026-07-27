import type { TLStoreSnapshot } from 'tldraw'

export interface EditorDocumentChanges {
  readonly added: Readonly<Record<string, unknown>>
  readonly updated: Readonly<Record<string, readonly [before: unknown, after: unknown]>>
  readonly removed: Readonly<Record<string, unknown>>
}

export type EditorDocumentEvent =
  | {
      readonly kind: 'ready'

      /**
       * 保存点内容，取 tldraw 官方快照的 store 部分——与持久化写入的是同一份，
       * 所以"干净"精确等于"与磁盘一致"。
       */
      readonly records: Readonly<Record<string, unknown>>
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
   * 在编辑器挂载时投递携带完整记录的 ready，其后转发 tldraw 官方的 Store diff，
   * 作用域为 document、来源为 user。
   *
   * ready 交付的是保存点内容，不是"基线时刻"。diff 由 Store 节流后异步冲刷，
   * 描述初始化的批次可能在 ready 之后才到达并重报已存在的记录，脏判定因此只能
   * 依据内容比较。
   */
  readonly subscribeDocumentEvents: (listener: (event: EditorDocumentEvent) => void) => () => void
}
