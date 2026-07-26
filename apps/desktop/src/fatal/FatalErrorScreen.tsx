import { CheckCircle, Copy, Refresh } from '@mynaui/icons-react'
import { useEffect, useMemo, useState } from 'react'
import type { TerminalFailureIncident } from '../application/failures/failure-coordinator'
import { createTerminalFailureViewModel } from './terminal-failure-view-model'
import errorRobotIllustration from './assets/error-robot.svg'

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
        <img
          alt=""
          aria-hidden="true"
          className="fatal-illustration"
          src={errorRobotIllustration}
        />

        <h1 className="fatal-title">{model.title}</h1>

        <p className="fatal-description">{model.description}</p>

        <p className="fatal-summary">{model.summary}</p>

        {model.additionalIncidentMessage ? (
          <p className="fatal-secondary">{model.additionalIncidentMessage}</p>
        ) : null}

        <div className="fatal-actions">
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
