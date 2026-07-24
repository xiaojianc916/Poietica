import { Component, type ErrorInfo, type ReactNode } from 'react'
import type { EditorSession } from '../runtime/editor-session'
import { EditorCanvas } from './EditorCanvas'

export interface EditorSessionHostEntry {
  readonly sessionId: string
  readonly session: EditorSession
}

export interface EditorSessionFailure {
  readonly sessionId: string
  readonly error: Error
  readonly componentStack?: string
}

export interface EditorSessionHostProps {
  readonly activeSessionId: string | null

  readonly sessions: readonly EditorSessionHostEntry[]

  readonly quarantinedSessionIds?: readonly string[]

  readonly onSave?: (sessionId: string) => void

  readonly onSessionFailure?: (failure: EditorSessionFailure) => void

  readonly renderSessionFailure?: (sessionId: string) => ReactNode
}

interface EditorSessionBoundaryProps {
  readonly sessionId: string
  readonly quarantined: boolean
  readonly fallback: ReactNode
  readonly children: ReactNode

  readonly onFailure?: (failure: EditorSessionFailure) => void
}

interface EditorSessionBoundaryState {
  readonly failed: boolean
}

/**
 * Isolates one editor session from the rest of the workspace.
 *
 * This boundary deliberately knows nothing about application failure severity.
 * It reports the failed session to the composition root, which owns policy.
 */
class EditorSessionBoundary extends Component<
  EditorSessionBoundaryProps,
  EditorSessionBoundaryState
> {
  override state: EditorSessionBoundaryState = {
    failed: false,
  }

  static getDerivedStateFromError(): EditorSessionBoundaryState {
    return {
      failed: true,
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const componentStack = info.componentStack ?? undefined

    this.props.onFailure?.({
      sessionId: this.props.sessionId,
      error,
      ...(componentStack === undefined
        ? {}
        : {
            componentStack,
          }),
    })
  }

  override render(): ReactNode {
    if (this.state.failed || this.props.quarantined) {
      return this.props.fallback
    }

    return this.props.children
  }
}

export function EditorSessionHost({
  activeSessionId,
  sessions,
  quarantinedSessionIds = [],
  onSave,
  onSessionFailure,
  renderSessionFailure,
}: EditorSessionHostProps) {
  if (sessions.length === 0) {
    return null
  }

  const quarantined = new Set(quarantinedSessionIds)

  return (
    <div className="relative size-full overflow-hidden">
      {sessions.map(({ sessionId, session }) => {
        const isActive = sessionId === activeSessionId

        const fallback = renderSessionFailure?.(sessionId) ?? null

        return (
          <div
            aria-hidden={!isActive}
            className={
              isActive
                ? 'absolute inset-0 z-10'
                : 'pointer-events-none absolute inset-0 invisible z-0'
            }
            data-session-id={sessionId}
            key={sessionId}
          >
            <EditorSessionBoundary
              fallback={fallback}
              quarantined={quarantined.has(sessionId)}
              sessionId={sessionId}
              {...(onSessionFailure
                ? {
                    onFailure: onSessionFailure,
                  }
                : {})}
            >
              <EditorCanvas
                isActive={isActive}
                session={session}
                {...(onSave
                  ? {
                      onSave: () => onSave(sessionId),
                    }
                  : {})}
              />
            </EditorSessionBoundary>
          </div>
        )
      })}
    </div>
  )
}
