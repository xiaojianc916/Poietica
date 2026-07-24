import { useMemo, useState } from 'react'
import { type FatalIncident, formatFatalDiagnostic } from './fatal-incident'

export interface FatalErrorScreenProps {
  readonly incident: FatalIncident
  readonly additionalIncidentCount?: number
}

export function FatalErrorScreen({ incident, additionalIncidentCount = 0 }: FatalErrorScreenProps) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  const diagnostic = useMemo(() => formatFatalDiagnostic(incident), [incident])

  const copyDiagnostic = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(diagnostic)
      setCopied(true)
      setCopyFailed(false)
    } catch {
      setCopied(false)
      setCopyFailed(true)
    }
  }

  return (
    <main aria-live="assertive" className="fatal-surface" role="alert">
      <section className="fatal-content">
        <div aria-hidden="true" className="fatal-icon">
          <WarningIcon />
        </div>

        <h1 className="fatal-title">{incident.title}</h1>

        <p className="fatal-description">{incident.message}</p>

        <p className="fatal-summary">
          {incident.code}
          {' · '}
          {incident.id}
        </p>

        {additionalIncidentCount > 0 ? (
          <p className="fatal-secondary">此后还捕获到 {additionalIncidentCount} 个相关异常。</p>
        ) : null}

        <div className="fatal-actions">
          <button
            className="fatal-button fatal-button-primary"
            onClick={() => window.location.reload()}
            type="button"
          >
            <ReloadIcon />
            重新加载
          </button>

          <button
            className="fatal-button"
            onClick={() => {
              void copyDiagnostic()
            }}
            type="button"
          >
            <CopyIcon />
            {copied ? '已复制' : copyFailed ? '复制失败' : '复制诊断信息'}
          </button>
        </div>

        <details className="fatal-details" open={copyFailed}>
          <summary>查看诊断信息</summary>

          <pre className="fatal-diagnostic">{diagnostic}</pre>
        </details>
      </section>
    </main>
  )
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
      className="fatal-button-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path d="M20 6v5h-5" />
      <path d="M19 11a7.5 7.5 0 1 0 .4 4" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      className="fatal-button-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <rect height="13" rx="2" width="13" x="8" y="8" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </svg>
  )
}
