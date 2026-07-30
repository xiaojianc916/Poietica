import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectList,
  type SelectOption,
  SelectTrigger,
} from '@poietica/foundations-design-system'

/*
 * 设置 · 模型页共用的两个字段控件。
 *
 * 它们本来是 ModelsSettings 里的私有函数。厂商卡把它们也用上了之后，留在原处只有两条
 * 路：从组件文件里 import 一个非导出的东西（做不到），或者抄第二份。所以搬到这里 ——
 * 两个调用点，一份实现。
 */

interface SubFieldProps {
  readonly label: string
  readonly placeholder: string
  readonly value: string
  readonly disabled?: boolean
  readonly secret?: boolean
  readonly onChange: (value: string) => void
}

export function SubField({
  label,
  placeholder,
  value,
  disabled = false,
  secret = false,
  onChange,
}: SubFieldProps) {
  return (
    <div className="models-row models-row--field">
      <span className="models-row__name">{label}</span>

      <div className="models-row__control">
        <input
          aria-label={label}
          autoComplete="off"
          className="models-input models-input--inline"
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          placeholder={placeholder}
          type={secret ? 'password' : 'text'}
          value={value}
        />
      </div>
    </div>
  )
}

/* 通用的枚举下拉。它只认 [value, label]，喂模型还是喂 agent 对它没区别。 */
interface OptionSelectProps {
  readonly ariaLabel: string
  readonly value: string
  readonly options: readonly (readonly [string, string])[]
  readonly onChange: (value: string) => void
}

export function OptionSelect({ ariaLabel, value, options, onChange }: OptionSelectProps) {
  const data: readonly SelectOption[] = options.map(([optionValue, label]) => ({
    value: optionValue,
    label,
  }))

  return (
    <Select data={data} onValueChange={onChange} size="sm" type={ariaLabel} value={value}>
      <SelectTrigger aria-label={ariaLabel} className="models-select-trigger" tone="plain" />

      <SelectContent>
        <SelectList>
          <SelectGroup>
            {options.map(([optionValue, label]) => (
              <SelectItem key={optionValue} value={optionValue}>
                {label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectList>
      </SelectContent>
    </Select>
  )
}
