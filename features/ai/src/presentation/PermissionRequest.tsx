import './permission-request.css'

import { useCallback, useState } from 'react'

import type { PermissionOption } from '../contracts/run-contract'
import type { PermissionItem } from '../contracts/timeline-contract'

/**
 * A permission request, answered in place.
 *
 * The agent is blocked until one option is chosen, so the question is rendered
 * inside the run it interrupts rather than in a dialog that could be dismissed,
 * lost behind a window, or answered out of context.
 *
 * Nothing is resolved optimistically. The click is sent to the port; the run
 * only moves on when permission_resolved comes back through the event log, so
 * what is on screen always matches what the agent was actually told.
 */

export interface PermissionRequestProps {
  readonly item: PermissionItem
  readonly onResolve: (requestId: string, optionId: string) => void
}

export function PermissionRequest({ item, onResolve }: PermissionRequestProps) {
  const [submittedOptionId, setSubmittedOptionId] = useState<string | undefined>(undefined)

  const resolution = item.resolution

  const handleSelect = useCallback(
    (optionId: string) => {
      setSubmittedOptionId(optionId)
      onResolve(item.requestId, optionId)
    },
    [item.requestId, onResolve],
  )

  if (resolution !== undefined) {
    return (
      <div className="assistant-permission" data-resolved="true">
        <p className="assistant-permission__title">{item.title}</p>

        <p className="assistant-permission__outcome">
          {resolution.outcome === 'cancelled'
            ? '请求已取消'
            : `已选择：${labelOf(item.options, resolution.optionId)}`}
        </p>
      </div>
    )
  }

  const isSubmitting = submittedOptionId !== undefined

  return (
    <div aria-busy={isSubmitting} className="assistant-permission" role="group">
      <p className="assistant-permission__title">{item.title}</p>

      <div className="assistant-permission__options">
        {item.options.map((option) => (
          <button
            className="assistant-permission__option"
            data-kind={option.kind}
            data-pending={option.optionId === submittedOptionId ? 'true' : undefined}
            disabled={isSubmitting}
            key={option.optionId}
            onClick={() => {
              handleSelect(option.optionId)
            }}
            type="button"
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  )
}

function labelOf(options: readonly PermissionOption[], optionId: string): string {
  return options.find((option) => option.optionId === optionId)?.name ?? optionId
}
