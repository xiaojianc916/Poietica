import type { KeyboardEvent } from 'react'
import { Meter } from './Meter'
import { CAPABILITY_META, formatContext, type ModelDescriptor, optionDomId } from './model-catalog'

interface ModelRowProps {
  model: ModelDescriptor
  selected: boolean
  active: boolean
  pinned: boolean
  onChoose: (id: string) => void
  onPin: (id: string) => void
  onHover: (id: string) => void
}

export function ModelRow({
  model,
  selected,
  active,
  pinned,
  onChoose,
  onPin,
  onHover,
}: ModelRowProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }
    event.preventDefault()
    onChoose(model.id)
  }

  const rowClass = ['ms-row', active ? 'ms-row--active' : '', selected ? 'ms-row--selected' : '']
    .filter((token) => token.length > 0)
    .join(' ')

  return (
    <div className={rowClass} role="presentation">
      <div
        aria-selected={selected}
        className="ms-row__hit"
        id={optionDomId(model.id)}
        onClick={() => {
          onChoose(model.id)
        }}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => {
          onHover(model.id)
        }}
        role="option"
        tabIndex={-1}
      >
        <span className="ms-row__head">
          <span className="ms-row__name">{model.label}</span>
          {model.recommended ? <span className="ms-tag ms-tag--accent">Recommended</span> : null}
          {model.deprecated ? <span className="ms-tag">Legacy</span> : null}
          {selected ? (
            <span aria-hidden="true" className="ms-row__check">
              ✓
            </span>
          ) : null}
        </span>
        <span className="ms-row__summary">{model.summary}</span>
        <span className="ms-row__meta">
          <span className="ms-row__ctx">{formatContext(model.contextTokens)}</span>
          {model.capabilities.map((capability) => (
            <span className="ms-chip" key={capability} title={CAPABILITY_META[capability].label}>
              <i aria-hidden="true">{CAPABILITY_META[capability].glyph}</i>
              {CAPABILITY_META[capability].label}
            </span>
          ))}
        </span>
        <span className="ms-row__meters">
          <Meter label="Speed" value={model.speed} />
          <Meter label="Cost" value={model.cost} />
        </span>
      </div>

      <button
        aria-label={pinned ? `Unpin ${model.label}` : `Pin ${model.label}`}
        className={
          pinned ? 'ms-row__pin ms-row__pin--on ms-focus-ring' : 'ms-row__pin ms-focus-ring'
        }
        onClick={() => {
          onPin(model.id)
        }}
        type="button"
      >
        ★
      </button>
    </div>
  )
}
