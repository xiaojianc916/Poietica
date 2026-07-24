import { DangerTriangle } from '@mynaui/icons-react'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { failureCoordinator } from '../../application/failures/failure-coordinator'

export interface DocumentQuarantineSurfaceProps {
  readonly sessionId: string
  readonly onClose: () => void
}

export function DocumentQuarantineSurface({ sessionId, onClose }: DocumentQuarantineSurfaceProps) {
  const snapshot = useSyncExternalStore(
    failureCoordinator.subscribe,
    failureCoordinator.getSnapshot,
    failureCoordinator.getSnapshot,
  )

  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const failureEntry = snapshot.incidents.find(
    (entry) =>
      entry.incident.impact === 'document-fatal' &&
      entry.incident.scope.kind === 'document' &&
      entry.incident.scope.documentId === sessionId,
  )

  const diagnostic = useMemo(
    () => formatDocumentDiagnostic(sessionId, failureEntry?.incident),
    [failureEntry?.incident, sessionId],
  )

  const copyDiagnostic = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(diagnostic)

      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <section
      aria-label="当前画布不可用"
      aria-live="assertive"
      className={['grid size-full', 'place-items-center', 'px-6 py-10'].join(' ')}
      role="alert"
    >
      <div className={['flex w-full', 'max-w-md', 'items-start gap-3'].join(' ')}>
        <DangerTriangle
          aria-hidden="true"
          className={['mt-0.5 size-5', 'shrink-0', 'text-destructive'].join(' ')}
        />

        <div className={['min-w-0 flex-1', 'grid gap-3'].join(' ')}>
          <div className="grid gap-1">
            <h1 className={['text-base', 'font-medium', 'tracking-tight'].join(' ')}>
              此画布暂时无法继续
            </h1>

            <p className={['text-sm leading-6', 'text-muted-foreground'].join(' ')}>
              为保护其他画布，当前画布已停止运行。 其他画布不受影响。
            </p>
          </div>

          <div className={['flex flex-wrap', 'items-center gap-x-4', 'gap-y-2'].join(' ')}>
            <button
              className={[
                'text-sm font-medium',
                'text-foreground',
                'underline-offset-4',
                'hover:underline',
                'focus-visible:outline-none',
                'focus-visible:ring-2',
                'focus-visible:ring-ring',
              ].join(' ')}
              onClick={onClose}
              type="button"
            >
              关闭画布
            </button>

            <button
              className={[
                'text-sm',
                'text-muted-foreground',
                'underline-offset-4',
                'hover:text-foreground',
                'hover:underline',
                'focus-visible:outline-none',
                'focus-visible:ring-2',
                'focus-visible:ring-ring',
              ].join(' ')}
              onClick={() => {
                void copyDiagnostic()
              }}
              type="button"
            >
              {copyState === 'copied'
                ? '已复制诊断信息'
                : copyState === 'failed'
                  ? '复制失败'
                  : '复制诊断信息'}
            </button>
          </div>

          <p className={['text-xs', 'text-muted-foreground/70'].join(' ')}>
            {failureEntry?.incident.code ?? 'DOCUMENT_EDITOR_SESSION_FATAL'}
          </p>
        </div>
      </div>
    </section>
  )
}

function formatDocumentDiagnostic(
  sessionId: string,
  failure:
    | {
        readonly id: string
        readonly code: string
        readonly occurredAt: string
        readonly technicalMessage: string
        readonly context: Readonly<Record<string, unknown>>
      }
    | undefined,
): string {
  if (!failure) {
    return [
      'Hybrid Canvas Document Failure',
      '',
      `Session ID: ${sessionId}`,
      '错误码: DOCUMENT_EDITOR_SESSION_FATAL',
      '错误信息: Document session was quarantined.',
    ].join('\n')
  }

  const stack = readContextText(failure.context, 'stack')

  const componentStack = readContextText(failure.context, 'componentStack')

  return [
    'Hybrid Canvas Document Failure',
    '',
    `Failure ID: ${failure.id}`,
    `Session ID: ${sessionId}`,
    `时间: ${failure.occurredAt}`,
    `错误码: ${failure.code}`,
    '影响范围: document-fatal',
    `错误信息: ${failure.technicalMessage}`,
    stack ? `\nJavaScript Stack:\n${stack}` : undefined,
    componentStack ? `\nReact Component Stack:\n${componentStack}` : undefined,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n')
}

function readContextText(
  context: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = context[key]

  return typeof value === 'string' && value.length > 0 ? value : undefined
}
