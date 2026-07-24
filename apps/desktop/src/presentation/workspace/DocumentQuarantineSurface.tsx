import { DangerTriangle } from '@mynaui/icons-react'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { failureCoordinator } from '../../application/failures/failure-coordinator'
import { formatFailureDiagnostic } from '../../application/failures/failure-diagnostic'

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

  const failure = snapshot.quarantinedDocuments.get(sessionId)?.incident

  const diagnostic = useMemo(
    () =>
      failure
        ? formatFailureDiagnostic(failure)
        : [
            'Hybrid Canvas Document Failure',
            '',
            `Session ID: ${sessionId}`,

            '错误码: DOCUMENT_EDITOR_SESSION_FATAL',
          ].join('\n'),

    [failure, sessionId],
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
      className="grid size-full place-items-center px-6 py-10"
      role="alert"
    >
      <div className="flex w-full max-w-md items-start gap-3">
        <DangerTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-destructive" />

        <div className="grid min-w-0 flex-1 gap-3">
          <div className="grid gap-1">
            <h1 className="text-base font-medium tracking-tight">此画布暂时无法继续</h1>

            <p className="text-sm leading-6 text-muted-foreground">
              为保护其他画布，当前画布已停止运行。其他画布不受影响。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              className="text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onClose}
              type="button"
            >
              关闭画布
            </button>

            <button
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

          <p className="text-xs text-muted-foreground/70">
            {failure?.code ?? 'DOCUMENT_EDITOR_SESSION_FATAL'}
          </p>
        </div>
      </div>
    </section>
  )
}
