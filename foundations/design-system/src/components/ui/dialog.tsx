import { X } from '@mynaui/icons-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils'
import { Button } from './button'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export interface DialogProps {
  readonly open: boolean
  readonly title: string
  readonly description?: string
  readonly children: ReactNode
  readonly footer?: ReactNode
  readonly className?: string
  readonly contentClassName?: string
  readonly busy?: boolean
  readonly closeLabel?: string
  readonly closeOnOverlayClick?: boolean
  readonly onOpenChange: (open: boolean) => void
}

export function Dialog({
  open,
  title,
  description,
  children,
  footer,
  className,
  contentClassName,
  busy = false,
  closeLabel = '关闭',
  closeOnOverlayClick = true,
  onOpenChange,
}: DialogProps) {
  const titleId = useId()
  const descriptionId = useId()

  const panelRef = useRef<HTMLDivElement>(null)

  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const previouslyFocused = document.activeElement

    const animationFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus()
    })

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault()
        onOpenChange(false)
      }
    }

    document.addEventListener('keydown', handleDocumentKeyDown)

    return () => {
      window.cancelAnimationFrame(animationFrame)

      document.removeEventListener('keydown', handleDocumentKeyDown)

      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus()
      }
    }
  }, [busy, onOpenChange, open])

  if (!open) {
    return null
  }

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') {
      return
    }

    const focusableElements = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    )

    const firstElement = focusableElements[0]

    const lastElement = focusableElements[focusableElements.length - 1]

    if (!firstElement || !lastElement) {
      event.preventDefault()
      panelRef.current?.focus()
      return
    }

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault()
      lastElement.focus()
      return
    }

    if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault()
      firstElement.focus()
    }
  }

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: 对话框遮罩仅检测背景点击，不是独立交互控件
    <div
      className={cn(
        'fixed inset-0',
        'z-[var(--ui-z-dialog)]',
        'grid place-items-center',
        'bg-black/40 p-4',
        'backdrop-blur-[2px]',
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && closeOnOverlayClick && !busy) {
          onOpenChange(false)
        }
      }}
      role="presentation"
    >
      <div
        aria-busy={busy || undefined}
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={cn(
          'flex w-full max-w-lg',
          'max-h-[calc(100dvh-2rem)]',
          'flex-col overflow-hidden',
          'rounded-xl border',
          'border-divider',
          'bg-background',
          'text-foreground',
          'shadow-2xl outline-none',
          'max-sm:max-h-dvh',
          'max-sm:h-dvh',
          'max-sm:max-w-none',
          'max-sm:rounded-none',
          className,
        )}
        onKeyDown={handlePanelKeyDown}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header
          className={cn(
            'flex min-h-14',
            'shrink-0 items-start',
            'justify-between gap-4',
            'border-b border-divider',
            'px-5 py-4',
          )}
        >
          <div className="min-w-0">
            <h2 className="text-base font-semibold" id={titleId}>
              {title}
            </h2>

            {description ? (
              <p
                className={cn('mt-1 text-sm', 'leading-5', 'text-muted-foreground')}
                id={descriptionId}
              >
                {description}
              </p>
            ) : null}
          </div>

          <Button
            aria-label={closeLabel}
            disabled={busy}
            onClick={() => {
              onOpenChange(false)
            }}
            ref={closeButtonRef}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </header>

        <div className={cn('min-h-0 flex-1', 'overflow-auto', contentClassName)}>{children}</div>

        {footer ? (
          <footer className={cn('shrink-0', 'border-t border-divider', 'px-5 py-3')}>
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
