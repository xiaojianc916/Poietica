import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from 'tldraw'

import type { ExtensionRegistration } from '../contracts/public-api'
import { CanvasInspectorPortalProvider } from './canvas-inspector-portal'

export type { ExtensionRegistration } from '../contracts/public-api'

interface EditorContextValue {
  readonly editor: Editor | null
  readonly registration: ExtensionRegistration | null
  readonly licenseKey: string
}

interface EditorBindingContextValue extends EditorContextValue {
  readonly bindSession: (
    owner: symbol,
    editor: Editor | null,
    registration: ExtensionRegistration | null,
  ) => void
  readonly unbindSession: (owner: symbol) => void
}

const EditorCtx = createContext<EditorBindingContextValue | null>(null)

export interface EditorProviderProps {
  readonly children: ReactNode
  readonly licenseKey: string
}

export function EditorProvider({ children, licenseKey }: EditorProviderProps) {
  const [session, setSession] = useState<{
    readonly editor: Editor | null
    readonly registration: ExtensionRegistration | null
  }>({ editor: null, registration: null })
  const activeOwner = useRef<symbol | null>(null)
  const bindSession = useCallback(
    (nextOwner: symbol, editor: Editor | null, registration: ExtensionRegistration | null) => {
      activeOwner.current = nextOwner

      /*
       * Rebinding the same pair is a no-op. Allocating a fresh state object
       * unconditionally published a new context value and re-rendered every
       * consumer of the editor context for a session that did not change.
       */
      setSession((previous) =>
        previous.editor === editor && previous.registration === registration
          ? previous
          : { editor, registration },
      )
    },
    [],
  )
  const unbindSession = useCallback((releasingOwner: symbol) => {
    if (activeOwner.current !== releasingOwner) {
      return
    }
    activeOwner.current = null
    setSession((previous) =>
      previous.editor === null && previous.registration === null
        ? previous
        : { editor: null, registration: null },
    )
  }, [])
  const value = useMemo<EditorBindingContextValue>(
    () => ({
      ...session,
      licenseKey,
      bindSession,
      unbindSession,
    }),
    [session, licenseKey, bindSession, unbindSession],
  )

  return (
    <EditorCtx.Provider value={value}>
      <CanvasInspectorPortalProvider>{children}</CanvasInspectorPortalProvider>
    </EditorCtx.Provider>
  )
}

export function useEditor(): Editor | null {
  return useContext(EditorCtx)?.editor ?? null
}

export function useTldrawLicenseKey(): string {
  const licenseKey = useContext(EditorCtx)?.licenseKey

  if (!licenseKey) {
    throw new Error('TLDRAW_LICENSE_KEY_NOT_CONFIGURED')
  }

  return licenseKey
}

export function useExtensionRegistration(): ExtensionRegistration | null {
  return useContext(EditorCtx)?.registration ?? null
}

export function useBindEditorSession(
  editor: Editor | null,
  registration: ExtensionRegistration | null,
): void {
  const ctx = useContext(EditorCtx)
  const bindSession = ctx?.bindSession
  const unbindSession = ctx?.unbindSession
  /*
   * useRef evaluates its argument on every render and keeps only the first
   * result, so passing Symbol(...) directly allocated a symbol and its
   * description string on every render of every canvas, to no effect.
   */
  const owner = useRef<symbol | null>(null)

  if (owner.current === null) {
    owner.current = Symbol('editor-session-owner')
  }

  useEffect(() => {
    const currentOwner = owner.current

    if (!bindSession || !unbindSession || !editor || !registration || !currentOwner) {
      return
    }

    bindSession(currentOwner, editor, registration)

    return () => unbindSession(currentOwner)
  }, [editor, registration, bindSession, unbindSession])
}
