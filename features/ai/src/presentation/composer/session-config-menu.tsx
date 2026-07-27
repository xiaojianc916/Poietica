import { useCallback, useEffect, useId, useRef, useState } from 'react'

import type {
  SessionConfigChoice,
  SessionConfigControl,
  SessionConfigPurpose,
} from '../../contracts/session-config-contract'
import { ChevronDownIcon } from '../primitives/icons'
import { ProviderIcon } from '../primitives/provider-icon'

/*
 * One menu for everything the session lets us change.
 *
 * Nothing here is named by this file. The rows are whatever the agent
 * reported, in the order it reported them, grouped only by what each one is
 * for; a category this build has never heard of still gets a row.
 *
 * The hover rules are the whole point of the rewrite. A submenu belongs to
 * its row in the document, not merely beside it on screen, so a pointer that
 * has walked into the submenu has not left the row and nothing has to be
 * kept alive by a timer. The submenu changes when another row is entered and
 * at no other time; the menu itself closes on a choice, on Escape, on a
 * press outside, or on the trigger being pressed again. Leaving the panel is
 * not one of them, which is how every desktop menu behaves.
 */

const ORDER: readonly SessionConfigPurpose[] = ['model', 'thought', 'mode', 'other']

const NOTHING_TO_OFFER = '会话未就绪'

/** Where a purpose sits; anything unrecognised sorts last rather than away. */
function rank(purpose: SessionConfigPurpose): number {
  const found = ORDER.indexOf(purpose)

  return found < 0 ? ORDER.length : found
}

/* Sorting is stable, so the agent order survives inside each purpose. */
function laidOut(controls: readonly SessionConfigControl[]): SessionConfigControl[] {
  const held = [...controls]

  held.sort((left, right) => rank(left.purpose) - rank(right.purpose))

  return held
}

/** The name the agent gave the value in force, falling back to the value. */
function chosen(control: SessionConfigControl): string {
  const held = control.choices.find((choice) => choice.value === control.current)

  return held?.label ?? control.current
}

/* Model values are provider-qualified, and the provider is the mark shown. */
function markOf(control: SessionConfigControl | undefined): string | undefined {
  if (control === undefined || control.purpose !== 'model') {
    return undefined
  }

  const [named] = control.current.split('/')

  return named === undefined || named.length === 0 ? undefined : named
}

interface ChoiceButtonProps {
  readonly choice: SessionConfigChoice
  readonly isActive: boolean
  readonly onPick: (value: string) => void
}

function ChoiceButton({ choice, isActive, onPick }: ChoiceButtonProps) {
  return (
    <button
      aria-checked={isActive}
      className="assistant-config-option"
      data-active={isActive ? 'true' : undefined}
      onClick={() => onPick(choice.value)}
      role="menuitemradio"
      type="button"
    >
      <span className="assistant-config-option__label">{choice.label}</span>

      {choice.detail === undefined ? null : (
        <span className="assistant-config-option__detail">{choice.detail}</span>
      )}
    </button>
  )
}

interface MenuRowProps {
  readonly control: SessionConfigControl
  readonly isOpen: boolean
  readonly onOpen: (configId: string) => void
  readonly onPick: (value: string) => void
}

function MenuRow({ control, isOpen, onOpen, onPick }: MenuRowProps) {
  return (
    <div className="assistant-config-menu__row-holder" onPointerEnter={() => onOpen(control.id)}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="assistant-config-menu__row"
        data-open={isOpen ? 'true' : undefined}
        onClick={() => onOpen(control.id)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'Enter') {
            onOpen(control.id)
          }
        }}
        role="menuitem"
        type="button"
      >
        <span className="assistant-config-menu__row-label">{control.label}</span>
        <span className="assistant-config-menu__row-value">{chosen(control)}</span>
        <ChevronDownIcon aria-hidden="true" className="assistant-config-menu__row-mark" />
      </button>

      {isOpen ? (
        <div className="assistant-config-menu__submenu" role="menu">
          <p className="assistant-config-menu__caption">{control.label}</p>

          {control.choices.map((choice) => (
            <ChoiceButton
              choice={choice}
              isActive={choice.value === control.current}
              key={choice.value}
              onPick={onPick}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export interface SessionConfigMenuProps {
  readonly controls: readonly SessionConfigControl[]
  readonly onSelect?: (configId: string, value: string) => void
}

export function SessionConfigMenu({ controls, onSelect }: SessionConfigMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [openId, setOpenId] = useState<string | undefined>(undefined)
  const holder = useRef<HTMLDivElement | null>(null)
  const panelId = useId()

  const close = useCallback(() => {
    setIsOpen(false)
    setOpenId(undefined)
  }, [])

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const onPress = (event: PointerEvent) => {
      const node = event.target

      if (node instanceof Node && holder.current?.contains(node) === true) {
        return
      }

      close()
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }

    document.addEventListener('pointerdown', onPress, true)
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('pointerdown', onPress, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [close, isOpen])

  const rows = laidOut(controls)
  const model = controls.find((control) => control.purpose === 'model')
  const mark = markOf(model)
  const headline = model === undefined ? NOTHING_TO_OFFER : chosen(model)

  return (
    <div className="assistant-config-menu" ref={holder}>
      <button
        aria-controls={panelId}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="会话设置"
        className="assistant-model-select__button"
        data-empty={rows.length === 0 ? 'true' : undefined}
        onClick={() => {
          if (isOpen) {
            close()

            return
          }

          setIsOpen(true)
        }}
        type="button"
      >
        <ProviderIcon {...(mark === undefined ? {} : { provider: mark })} />

        <span className="assistant-model-select__label">{headline}</span>
      </button>

      {isOpen ? (
        <div className="assistant-config-menu__panel" id={panelId} role="menu">
          {rows.length === 0 ? (
            <p className="assistant-config-menu__empty" data-empty="true">
              {NOTHING_TO_OFFER}
            </p>
          ) : (
            rows.map((control) => (
              <MenuRow
                control={control}
                isOpen={openId === control.id}
                key={control.id}
                onOpen={setOpenId}
                onPick={(value) => {
                  onSelect?.(control.id, value)
                  close()
                }}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
