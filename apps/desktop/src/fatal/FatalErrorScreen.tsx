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
              className="fatal-icon-button fatal-icon-button-primary"
              onClick={() => {
                executePrimaryAction(primaryAction)
              }}
              title={primaryAction.label}
              type="button"
            >
              <ReloadIcon />
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
            {copyState === 'copied' ? <CheckIcon /> : <CopyIcon />}
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

function ReloadIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M20 11a8 8 0 1 0 2 5.3" />
      <path d="M20 4v7h-7" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <rect height="13" rx="2" width="10" x="9" y="8" />
      <path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="m5 12 4.2 4.2L19 6.5" />
    </svg>
  )
}
