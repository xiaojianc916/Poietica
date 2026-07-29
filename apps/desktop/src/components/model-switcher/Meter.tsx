interface MeterProps {
  label: string
  value: number
  max?: number
}

export function Meter({ label, value, max = 5 }: MeterProps) {
  const pips = Array.from({ length: max }, (_, index) => index + 1)
  return (
    <span className="ms-meter" title={`${label}: ${value} of ${max}`}>
      <span className="ms-meter__label">{label}</span>
      <span aria-hidden="true" className="ms-meter__track">
        {pips.map((pip) => (
          <i
            className={pip <= value ? 'ms-meter__pip ms-meter__pip--on' : 'ms-meter__pip'}
            key={pip}
          />
        ))}
      </span>
    </span>
  )
}
