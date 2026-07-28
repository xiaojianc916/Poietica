// poietica:proximity-fisheye@v2
import { type CSSProperties, useCallback, useRef } from 'react'
import './conversation-minimap.css'
import type { ProximityFisheyeOptions } from './proximity-fisheye/proximity-fisheye.constants'
import './proximity-fisheye/proximity-fisheye.css'
import { useProximityFisheye } from './proximity-fisheye/use-proximity-fisheye'

export type ConversationMinimapEntry = {
  id: string
  /** Accessible label, e.g. the first line of the message. */
  label: string
  role: 'user' | 'assistant'
  /** Relative message length in the 0..1 range; drives bar width. */
  length?: number
}

export type ConversationMinimapProps = {
  entries: readonly ConversationMinimapEntry[]
  activeId?: string | null
  onSelect?: (id: string) => void
  fisheye?: Partial<ProximityFisheyeOptions>
}

export function ConversationMinimap({
  activeId = null,
  entries,
  fisheye,
  onSelect,
}: ConversationMinimapProps) {
  const rootRef = useRef<HTMLElement | null>(null)
  useProximityFisheye(rootRef, fisheye)

  const handleSelect = useCallback(
    (id: string) => {
      onSelect?.(id)
    },
    [onSelect],
  )

  return (
    <nav aria-label="Conversation minimap" className="conversation-minimap" ref={rootRef}>
      <ol className="conversation-minimap__list">
        {entries.map((entry) => (
          <li className="conversation-minimap__row" key={entry.id}>
            <button
              aria-current={entry.id === activeId ? 'true' : undefined}
              className="conversation-minimap__bar"
              data-pfe-item=""
              data-role={entry.role}
              onClick={() => handleSelect(entry.id)}
              style={{ '--cm-len': entry.length ?? 0.6 } as CSSProperties}
              type="button"
            >
              <span className="conversation-minimap__label">{entry.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
