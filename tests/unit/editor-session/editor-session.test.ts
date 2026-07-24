import {
  type CreateEditorSessionOptions,
  createEditorSession,
  type EditorAssetStoreSession,
} from '@hybrid-canvas/canvas/application'
import type { Editor, TLAssetStore } from 'tldraw'
import { describe, expect, it, vi } from 'vitest'

function createTestAssetStoreSession(): EditorAssetStoreSession {
  return {
    assets: {
      upload: vi.fn(),
    } as unknown as TLAssetStore,
    getPersistenceToken: vi.fn(async (): Promise<string | null> => null),
    dispose: vi.fn(async (): Promise<void> => {}),
  }
}

function createTestSession(options: CreateEditorSessionOptions) {
  return createEditorSession(options, createTestAssetStoreSession())
}

describe('EditorSession page command contracts', () => {
  it('rejects page commands while the editor is not attached', () => {
    const session = createTestSession({
      documentId: 'document:detached',
      sessionId: 'session:detached',
    })

    try {
      expect(() => session.createPage('新页面')).toThrow('EDITOR_SESSION_NOT_ATTACHED')
      expect(() => session.activatePage('page:missing')).toThrow('EDITOR_SESSION_NOT_ATTACHED')
    } finally {
      session.dispose()
    }
  })

  it('rejects an empty page title before invoking tldraw', () => {
    const session = createTestSession({
      documentId: 'document:title',
      sessionId: 'session:title',
    })

    try {
      expect(() => session.createPage('   ')).toThrow('EDITOR_PAGE_TITLE_REQUIRED')
    } finally {
      session.dispose()
    }
  })

  it('delegates valid page commands to the attached tldraw Editor', () => {
    const session = createTestSession({
      documentId: 'document:attached',
      sessionId: 'session:attached',
    })

    const page = {
      id: 'page:existing',
      name: '现有页面',
    }

    const createPage = vi.fn()
    const setCurrentPage = vi.fn()

    const editor = {
      createPage,
      getCurrentPageId: () => page.id,
      getPages: () => [page],
      setCurrentPage,
    } as unknown as Editor

    try {
      session.attachEditor(editor)

      session.createPage('  新页面  ')

      expect(createPage).toHaveBeenCalledWith({
        name: '新页面',
      })

      session.activatePage(page.id)

      expect(setCurrentPage).toHaveBeenCalledWith(page)
    } finally {
      session.dispose()
    }
  })

  it('rejects activation of a page that does not exist', () => {
    const session = createTestSession({
      documentId: 'document:missing-page',
      sessionId: 'session:missing-page',
    })

    const editor = {
      getCurrentPageId: () => 'page:existing',
      getPages: () => [
        {
          id: 'page:existing',
          name: '现有页面',
        },
      ],
    } as unknown as Editor

    try {
      session.attachEditor(editor)

      expect(() => session.activatePage('page:missing')).toThrow('EDITOR_PAGE_NOT_FOUND')
    } finally {
      session.dispose()
    }
  })
})
