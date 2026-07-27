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
   * 订阅时同步投递一次 ready，其后转发 tldraw 官方的 Store diff，作用域为
   * document、来源为 user。',
   *
   * ready 标记干净基线。它绑定的是文档内容就绪，与编辑器是否挂载无关：
   * 挂载是渲染时序，不是文档语义。
   */
  readonly subscribeDocumentEvents: (listener: (event: EditorDocumentEvent) => void) => () => void
}
