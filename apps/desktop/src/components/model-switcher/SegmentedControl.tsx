import { useId } from 'react'
import type { SwitcherOption } from './model-catalog'

interface SegmentedControlProps<T extends string> {
  label: string
  options: ReadonlyArray<SwitcherOption<T>>
  value: T
  onChange: (next: T) => void
}

/**
 * Native radio group behind a segmented visual. The inputs are visually hidden
 * rather than replaced by role="radio" buttons, so grouping semantics and
 * arrow-key navigation come from the platform instead of hand-written handlers.
 */
export function SegmentedControl<T extends string>({
  label,
  onChange,
  options,
  value,
}: SegmentedControlProps<T>) {
  const groupName = useId()

  return (
    <fieldset className="ms-seg">
      <legend className="ms-seg__caption">{label}</legend>
      <div className="ms-seg__group">
        {options.map((option) => (
          <label
            className={option.value === value ? 'ms-seg__item ms-seg__item--on' : 'ms-seg__item'}
            key={option.value}
            title={option.hint}
          >
            <input
              checked={option.value === value}
              className="ms-seg__input"
              name={groupName}
              onChange={() => {
                onChange(option.value)
              }}
              type="radio"
              value={option.value}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
