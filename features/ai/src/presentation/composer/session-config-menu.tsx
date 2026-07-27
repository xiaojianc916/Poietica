import { useEffect, useRef, useState } from 'react'

import type {
  SessionConfigControl,
  SessionConfigPurpose,
} from '../../contracts/session-config-contract'
import { ChevronDownIcon } from '../primitives/icons'
import { ProviderIcon } from '../primitives/provider-icon'

/*
 * One control for everything the session lets us change.
 *
 * A separate switch per selector would multiply controls every time the
 * agent grows one, so the row of selectors lives inside a single menu and
 * each row opens its own values. A reasoning level appears only when the
 * model in force offers one, and leaves with it.
 */

/* The order rows are laid out in. What the agent adds beyond these trails it. */
const ORDER: readonly SessionConfigPurpose[] = ['model', 'thought', 'mode', 'other']

/* How long a pointer rests on a row before its values open. */
const OPEN_DELAY = 120

/* How long they stay open after the pointer leaves, so the gap forgives a diagonal. */
const CLOSE_DELAY = 220

/*
 * What the control says with no session behind it.
 *
 * Vanishing is the one thing it must not do: an absent control and an empty
 * list look the same once both render nothing.
 */
const NOTHING_TO_OFFER = '会话未就绪'

function rank(purpose: SessionConfigPurpose) {
  const found = ORDER.indexOf(purpose)

  return found === -1 ? ORDER.length : found
}

/* The agent order is kept within a purpose, so its own ordering survives. */
function laidOut(controls: readonly SessionConfigControl[]) {
  return [...controls].sort((left, right) => rank(left.purpose) - rank(right.purpose))
}

/* The name the agent gave the value in force, falling back to the value itself. */
function chosen(control: SessionConfigControl) {
  const held = control.choices.find((choice) => choice.value === control.current)

  return held?.label ?? control.current
}

/* A model value carries its provider ahead of a slash, and that is all we read from it. */
function provider(control: SessionConfigControl) {
  if (control.purpose !== 'model') {
    return undefined
  }

  const [named] = control.current.split('/')

  return named === undefined || named.length === 0 ? undefined : named
}

interface ConfigRowProps {
  readonly control: SessionConfigControl
  readonly isFirst: boolean
  readonly isOpen: boolean
  readonly onOpen: (wanted: boolean) => void
  readonly onPick: (value: string) => void
}

function ConfigRow({ control, isFirst, isOpen, onOpen, onPick }: ConfigRowProps) {
  const timer = useRef<number | undefined>(undefined)

  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
    },
    [],
  )

  const schedule = (wanted: boolean, delay: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      onOpen(wanted)
    }, delay)
  }

  const now = (wanted: boolean) => {
    window.clearTimeout(timer.current)
    onOpen(wanted)
  }

  return (
    <div
      className="assistant-config-menu__row-group"
      onPointerEnter={() => {
        schedule(true, OPEN_DELAY)
      }}
      onPointerLeave={() => {
        schedule(false, CLOSE_DELAY)
      }}
    >
      {isFirst ? null : <span className="assistant-config-menu__separator" role="separator" />}

      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="assistant-config-menu__row"
        onClick={() => {
          now(!isOpen)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            now(true)
          }

          if (event.key === 'ArrowLeft') {
            now(false)
          }
        }}
        role="menuitem"
        type="button"
      >
        <span className="assistant-config-menu__row-label">{control.label}</span>

        <span className="assistant-config-menu__row-value">{chosen(control)}</span>

        <ChevronDownIcon aria-hidden="true" className="assistant-config-menu__row-chevron" />
      </button>

      {isOpen ? <span aria-hidden="true" className="assistant-config-menu__bridge" /> : null}

      {isOpen ? (
        <div className="assistant-config-menu__submenu" role="menu">
          {control.choices.map((choice) => (
            <button
              aria-checked={choice.value === control.current}
              className="assistant-config-option"
              data-active={choice.value === control.current}
              key={choice.value}
              onClick={() => {
                onPick(choice.value)
              }}
              role="menuitemradio"
              type="button"
            >
              <span className="assistant-config-option__label">{choice.label}</span>

              {choice.detail === undefined ? null : (
                <span className="assistant-config-option__detail">{choice.detail}</span>
              )}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export interface SessionConfigMenuProps {
  readonly controls: readonly SessionConfigControl[]
  readonly onSelect?: ((configId: string, value: string) => void) | undefined
}

export function SessionConfigMenu({ controls, onSelect }: SessionConfigMenuProps) {
  const [isOpen, setOpen] = useState(false)
  const [openRow, setOpenRow] = useState<string | null>(null)
  const root = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const shut = () => {
      setOpen(false)
      setOpenRow(null)
    }

    const onPointerDown = (event: PointerEvent) => {
      const inside = root.current?.contains(event.target as Node) ?? true

      if (inside) {
        return
      }

      shut()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      shut()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const rows = laidOut(controls)
  const headline = rows.find((row) => row.purpose === 'model') ?? rows[0]

  if (headline === undefined) {
    return (
      <span
        aria-live="polite"
        className="assistant-model-select assistant-model-select__button"
        data-empty="true"
      >
        <ProviderIcon />

        <span className="assistant-model-select__label">{NOTHING_TO_OFFER}</span>
      </span>
    )
  }

  const badge = provider(headline)

  return (
    <div className="assistant-config-menu assistant-model-select" ref={root}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="会话设置"
        className="assistant-model-select__button"
        onClick={() => {
          setOpen((current) => !current)
          setOpenRow(null)
        }}
        type="button"
      >
        {badge === undefined ? <ProviderIcon /> : <ProviderIcon provider={badge} />}

        <span className="assistant-model-select__label">{chosen(headline)}</span>
      </button>

      {isOpen ? (
        <div className="assistant-config-menu__panel" role="menu">
          {rows.map((row, index) => (
            <ConfigRow
              control={row}
              isFirst={index === 0}
              isOpen={openRow === row.id}
              key={row.id}
              onOpen={(wanted) => {
                setOpenRow(wanted ? row.id : null)
              }}
              onPick={(value) => {
                setOpen(false)
                setOpenRow(null)

                if (value === row.current) {
                  return
                }

                onSelect?.(row.id, value)
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
