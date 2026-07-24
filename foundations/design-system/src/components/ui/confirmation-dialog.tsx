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
      closeOnOverlayClick={!busy}
      description={description}
      footer={
        <div className={cnFooter()}>
          <Button disabled={busy} onClick={onCancel} type="button" variant="ghost">
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
      title={title}
    />
  )
}

function cnFooter(): string {
  return ['flex flex-wrap', 'justify-end gap-2'].join(' ')
}
