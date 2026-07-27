import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@poietica/foundations-design-system'

import type { SessionConfigControl } from '../../contracts/session-config-contract'
import { ProviderIcon } from '../primitives/provider-icon'

/*
 * Everything the session lets us change, in one control.
 *
 * There is no second control for the model. A model is one of the purposes the
 * session reports, and before a session exists the agent config supplies the
 * same shape, so the pipeline is the same either way. Two controls swapping
 * places at the first turn was a compatibility seam, and the user watched the
 * toolbar change shape underneath them.
 *
 * The popup is the design system's menu: arrow keys, typeahead, Escape and
 * focus return are the standard's job, not this file's.
 */

const NOTHING_TO_OFFER = '会话未就绪'

const ORDER = ['model', 'thought', 'mode', 'other'] as const

/** Where a purpose sits; anything unrecognised sorts last rather than away. */
function rank(purpose: SessionConfigControl['purpose']): number {
  const found = ORDER.indexOf(purpose as (typeof ORDER)[number])

  return found < 0 ? ORDER.length : found
}

/** The name the agent gave the value in force, falling back to the value. */
function chosen(control: SessionConfigControl): string {
  return (
    control.choices.find((choice) => choice.value === control.current)?.label ?? control.current
  )
}

export interface SessionControlsProps {
  readonly controls: readonly SessionConfigControl[]
  readonly failure?: string | undefined
  readonly onSelect: (controlId: string, value: string) => void
}

export function SessionControls({ controls, failure, onSelect }: SessionControlsProps) {
  /* Sorting is stable, so the agent order survives inside each purpose. */
  const rows = [...controls].sort((left, right) => rank(left.purpose) - rank(right.purpose))
  const model = controls.find((control) => control.purpose === 'model')
  const provider = model?.current.split('/')[0]

  if (rows.length === 0) {
    return (
      <span
        aria-live="polite"
        className="assistant-model-select__button"
        data-empty="true"
        title={failure}
      >
        <ProviderIcon />

        <span className="assistant-model-select__label">{NOTHING_TO_OFFER}</span>
      </span>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="会话设置"
        className="assistant-model-select__button"
        title={failure}
      >
        <ProviderIcon {...(provider === undefined || provider === '' ? {} : { provider })} />

        <span className="assistant-model-select__label">
          {model === undefined ? chosen(rows[0]) : chosen(model)}
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="assistant-config-menu__panel assistant-menu-surface"
        data-assistant-skin
        side="top"
        sideOffset={6}
      >
        {rows.map((control, index) => (
          <div key={control.id}>
            {index === 0 ? null : (
              <DropdownMenuSeparator className="assistant-config-menu__separator" />
            )}

            <p className="assistant-config-menu__caption">{control.label}</p>

            {control.choices.map((choice) => (
              <DropdownMenuItem
                className="assistant-config-option"
                data-active={choice.value === control.current ? 'true' : undefined}
                key={choice.value}
                onSelect={() => {
                  if (choice.value === control.current) return

                  onSelect(control.id, choice.value)
                }}
              >
                <span className="assistant-config-option__label">{choice.label}</span>

                {choice.detail === undefined ? null : (
                  <span className="assistant-config-option__detail">{choice.detail}</span>
                )}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
