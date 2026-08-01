import { Button } from './button'
import { Dialog } from './dialog'

export interface ConfirmationDialogProps {
  readonly open: boolean
  readonly title: string
  readonly description: string
  readonly confirmLabel: string
  readonly cancelLabel?: string
  readonly destructive?: boolean
  readonly busy?: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * A compact, decision-focused dialog.
 *
 * Confirmation is explicit through the two footer actions, so this composition
 * intentionally has no redundant close icon. Cancellation remains available
 * through the outlined button, Escape, and (when not busy) the light backdrop.
 */
export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  return (
    <Dialog
      busy={busy}
      className={[
        '!max-w-[26rem]',
        '!border-b-2 !border-b-foreground/20',
        '!shadow-[0_14px_30px_-22px_rgb(15_23_42_/_0.35)]',
      ].join(' ')}
      closeOnOverlayClick={!busy}
      description={description}
      footer={
        <div className={cnFooter()}>
          <Button
            className="bg-accent/55 px-3 hover:bg-accent"
            disabled={busy}
            onClick={onCancel}
            type="button"
            variant="ghost"
          >
            {cancelLabel}
          </Button>

          <Button
            aria-busy={busy || undefined}
            disabled={busy}
            onClick={onConfirm}
            type="button"
            variant={destructive ? 'destructive' : 'default'}
          >
            {busy ? '处理中…' : confirmLabel}
          </Button>
        </div>
      }
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel()
        }
      }}
      open={open}
      showCloseButton={false}
      title={title}
    />
  )
}

function cnFooter(): string {
  return ['flex flex-wrap', 'justify-end gap-2.5'].join(' ')
}
