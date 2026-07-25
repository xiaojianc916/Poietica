import { CheckCircle, Copy, Refresh } from '@mynaui/icons-react'
import { useEffect, useMemo, useState } from 'react'
import type { TerminalFailureIncident } from '../application/failures/failure-coordinator'
import { createTerminalFailureViewModel } from './terminal-failure-view-model'

export interface FatalErrorScreenProps {
  readonly incident: TerminalFailureIncident

  readonly additionalIncidentCount?: number
}

export function FatalErrorScreen({ incident, additionalIncidentCount = 0 }: FatalErrorScreenProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')

  const model = useMemo(
    () => createTerminalFailureViewModel(incident, additionalIncidentCount),
    [additionalIncidentCount, incident],
  )

  const primaryAction = model.primaryAction

  useEffect(() => {
    if (copyState !== 'copied') {
      return
    }

    const resetTimer = window.setTimeout(() => {
      setCopyState('idle')
    }, 2200)

    return () => {
      window.clearTimeout(resetTimer)
    }
  }, [copyState])

  const copyDiagnostic = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(model.diagnostic)
      setCopyState('copied')
    } catch {
      // Keep the copy icon available so the user can retry immediately.
      setCopyState('idle')
    }
  }

  return (
    <main aria-live="assertive" className="fatal-surface" role="alert">
      <section className="fatal-content">
        <div aria-hidden="true" className="fatal-icon">
          <WarningIcon />
        </div>

        <h1 className="fatal-title">{model.title}</h1>

        <p className="fatal-description">{model.description}</p>

        <p className="fatal-summary">{model.summary}</p>

        {model.additionalIncidentMessage ? (
          <p className="fatal-secondary">{model.additionalIncidentMessage}</p>
        ) : null}

        <div aria-label="错误处理操作" className="fatal-actions" role="group">
          {primaryAction ? (
            <button
              aria-label={primaryAction.label}
              className="fatal-icon-button"
              onClick={() => {
                executePrimaryAction(primaryAction)
              }}
              title={primaryAction.label}
              type="button"
            >
              <Refresh aria-hidden="true" />
            </button>
          ) : null}

          <button
            aria-label={copyState === 'copied' ? model.copySuccessLabel : model.copyActionLabel}
            className="fatal-icon-button"
            onClick={() => {
              void copyDiagnostic()
            }}
            title={copyState === 'copied' ? model.copySuccessLabel : model.copyActionLabel}
            type="button"
          >
            {copyState === 'copied' ? (
              <CheckCircle aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
          </button>
        </div>

        <details className="fatal-details">
          <summary>{model.detailsLabel}</summary>

          <pre className="fatal-diagnostic">{model.diagnostic}</pre>
        </details>
      </section>
    </main>
  )
}

function executePrimaryAction(action: { readonly kind: 'reload' }): void {
  switch (action.kind) {
    case 'reload':
      window.location.reload()
  }
}

function WarningIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path d="M12 8.5v4.25" />
      <path d="M12 16.25h.01" />
      <path d="M10.28 3.86 2.82 16.8a2 2 0 0 0 1.73 3h14.9a2 2 0 0 0 1.73-3L13.72 3.86a2 2 0 0 0-3.44 0Z" />
    </svg>
  )
}
