import { type ReactNode, useId } from 'react'
import { cn } from '../../lib/utils'

export interface FieldControlIds {
  readonly inputId: string
  readonly descriptionId: string | undefined
  readonly errorId: string | undefined
  readonly describedBy: string | undefined
}

export interface FieldProps {
  readonly label: string
  readonly description?: string
  readonly error?: string
  readonly required?: boolean
  readonly className?: string
  readonly children: (ids: FieldControlIds) => ReactNode
}

export function Field({
  label,
  description,
  error,
  required = false,
  className,
  children,
}: FieldProps) {
  const inputId = useId()

  const descriptionId = description ? `${inputId}-description` : undefined

  const errorId = error ? `${inputId}-error` : undefined

  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('grid gap-2', className)}>
      <label className="text-sm font-medium" htmlFor={inputId}>
        {label}

        {required ? (
          <>
            <span aria-hidden="true" className="ml-1 text-destructive">
              *
            </span>

            <span className="sr-only">必填</span>
          </>
        ) : null}
      </label>

      {description ? (
        <p className={cn('text-xs leading-5', 'text-muted-foreground')} id={descriptionId}>
          {description}
        </p>
      ) : null}

      {children({
        inputId,
        descriptionId,
        errorId,
        describedBy,
      })}

      {error ? (
        <p
          className={cn('flex items-start gap-1', 'text-xs leading-5', 'text-destructive')}
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
