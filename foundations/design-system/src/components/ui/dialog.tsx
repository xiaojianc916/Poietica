import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { X } from '@mynaui/icons-react'
import { type ReactNode, useRef } from 'react'
import { cn } from '../../lib/utils'
import { Button } from './button'

export interface DialogProps {
  readonly open: boolean
  readonly title: string
  readonly description?: string
  readonly children?: ReactNode
  readonly footer?: ReactNode
  readonly showHeader?: boolean
  readonly className?: string
  readonly contentClassName?: string
  readonly busy?: boolean
  readonly closeLabel?: string
  readonly closeOnOverlayClick?: boolean
  readonly onOpenChange: (open: boolean) => void
}

/**
 * Project dialog composition built on Base UI.
 *
 * Base UI owns:
 * - portal lifecycle
 * - focus trapping
 * - initial and final focus
 * - Escape handling
 * - outside-press handling
 * - modal accessibility semantics
 *
 * Poietica owns:
 * - visual tokens
 * - layout
 * - busy policy
 * - product-facing labels
 */
export function Dialog({
  open,
  title,
  description,
  children,
  footer,
  showHeader = true,
  className,
  contentClassName,
  busy = false,
  closeLabel = '关闭',
  closeOnOverlayClick = true,
  onOpenChange,
}: DialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const requestOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && busy) {
      return
    }

    onOpenChange(nextOpen)
  }

  return (
    <BaseDialog.Root
      disablePointerDismissal={busy || !closeOnOverlayClick}
      onOpenChange={(nextOpen) => {
        requestOpenChange(nextOpen)
      }}
      open={open}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          className={cn(
            'fixed inset-0',
            'z-[var(--ui-z-dialog)]',
            'bg-black/40',
            'backdrop-blur-[2px]',
            'transition-opacity',
            'duration-[var(--ui-duration-normal)]',
            'ease-[var(--ui-ease-standard)]',
            'data-[starting-style]:opacity-0',
            'data-[ending-style]:opacity-0',
          )}
        />

        <BaseDialog.Viewport
          className={cn(
            'fixed inset-0',
            'z-[var(--ui-z-dialog)]',
            'grid place-items-center',
            'overflow-y-auto p-4',
            'max-sm:p-0',
          )}
        >
          <BaseDialog.Popup
            aria-busy={busy || undefined}
            className={cn(
              'flex w-full max-w-lg',
              'max-h-[calc(100dvh-2rem)]',
              'flex-col overflow-hidden',
              'rounded-xl border',
              'border-divider',
              'bg-background',
              'text-foreground',
              'shadow-[var(--ui-shadow-xl)] outline-none',
              'transition-[transform,scale,opacity]',
              'duration-[var(--ui-duration-normal)]',
              'ease-[var(--ui-ease-standard)]',
              'data-[starting-style]:scale-95',
              'data-[starting-style]:opacity-0',
              'data-[ending-style]:scale-95',
              'data-[ending-style]:opacity-0',
              'max-sm:h-dvh',
              'max-sm:max-h-dvh',
              'max-sm:max-w-none',
              'max-sm:rounded-none',
              className,
            )}
            initialFocus={showHeader ? closeButtonRef : undefined}
          >
            {showHeader ? (
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
                  <BaseDialog.Title className="text-base font-semibold">{title}</BaseDialog.Title>

                  {description ? (
                    <BaseDialog.Description
                      className={cn('mt-1 text-sm', 'leading-5', 'text-muted-foreground')}
                    >
                      {description}
                    </BaseDialog.Description>
                  ) : null}
                </div>

                <Button
                  aria-label={closeLabel}
                  disabled={busy}
                  onClick={() => {
                    requestOpenChange(false)
                  }}
                  ref={closeButtonRef}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <X aria-hidden="true" className="size-4" />
                </Button>
              </header>
            ) : null}

            {children !== undefined && children !== null ? (
              <div className={cn('min-h-0 flex-1', 'overflow-auto', contentClassName)}>
                {children}
              </div>
            ) : null}

            {footer ? (
              <footer className={cn('shrink-0', 'border-t border-divider', 'px-5 py-3')}>
                {footer}
              </footer>
            ) : null}
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
