import { useMemo, useState } from 'react'
import type { FailureIncident } from '../application/failures/failure-coordinator'
import { formatFailureDiagnostic } from '../application/failures/failure-diagnostic'

export interface FatalErrorScreenProps {
  readonly incident: FailureIncident

  readonly additionalIncidentCount?: number
}

export function FatalErrorScreen({ incident, additionalIncidentCount = 0 }: FatalErrorScreenProps) {
  const [copied, setCopied] = useState(false)

  const [copyFailed, setCopyFailed] = useState(false)

  const diagnostic = useMemo(() => formatFailureDiagnostic(incident), [incident])

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

  const title = incident.impact === 'native-fatal' ? '应用上次异常终止' : '应用遇到严重错误'

  return (
    <main aria-live="assertive" className="fatal-surface" role="alert">
      <section className="fatal-content">
        <div aria-hidden="true" className="fatal-icon">
          <WarningIcon />
        </div>

        <h1 className="fatal-title">{title}</h1>

        <p className="fatal-description">{incident.userMessage}</p>

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
            重新加载
          </button>

          <button
            className="fatal-button"
            onClick={() => {
              void copyDiagnostic()
            }}
            type="button"
          >
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
