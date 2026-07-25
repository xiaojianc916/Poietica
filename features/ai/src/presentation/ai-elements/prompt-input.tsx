import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ComponentProps, FormEvent, KeyboardEvent, ReactNode } from 'react'

import { ArrowUpIcon, CloseIcon, FileIcon, SpinnerIcon, StopIcon } from '../primitives/icons'

/*
 * Vendored AI Elements "prompt-input".
 *
 * Contract kept identical to elements.ai-sdk.dev so the surface can be
 * replaced by the upstream file without touching consumers or the skin:
 *   - same exported component names,
 *   - same data-slot attributes (the stylesheet keys off these),
 *   - same submit payload shape { text, files }.
 */

export type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

export interface PromptInputAttachmentData {
  readonly id: string
  readonly file: File
  readonly filename: string
  readonly mediaType: string
}

export interface PromptInputMessage {
  readonly text: string
  readonly files: readonly File[]
}

interface PromptInputContextValue {
  readonly attachments: readonly PromptInputAttachmentData[]
  readonly accept?: string
  readonly multiple: boolean
  readonly openFilePicker: () => void
  readonly addFiles: (files: FileList | readonly File[]) => void
  readonly removeAttachment: (id: string) => void
  readonly registerTextarea: (element: HTMLTextAreaElement | null) => void
  readonly requestSubmit: () => void
}

const PromptInputContext = createContext<PromptInputContextValue | null>(null)

function usePromptInputContext(): PromptInputContextValue {
  const context = useContext(PromptInputContext)

  if (!context) {
    throw new Error('PromptInput sub-components must be rendered inside <PromptInput>.')
  }

  return context
}

export function usePromptInputAttachments(): readonly PromptInputAttachmentData[] {
  return usePromptInputContext().attachments
}

const cx = (...values: readonly (string | false | undefined)[]) => values.filter(Boolean).join(' ')

export interface PromptInputProps extends Omit<ComponentProps<'form'>, 'onSubmit'> {
  readonly accept?: string
  readonly multiple?: boolean
  readonly globalDrop?: boolean
  readonly maxFiles?: number
  readonly onSubmit: (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => void
}

export function PromptInput({
  accept,
  children,
  className,
  globalDrop = false,
  maxFiles,
  multiple = false,
  onSubmit,
  ...props
}: PromptInputProps) {
  const [attachments, setAttachments] = useState<readonly PromptInputAttachmentData[]>([])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const idPrefix = useId()

  const addFiles = useCallback(
    (incoming: FileList | readonly File[]) => {
      const list = Array.from(incoming)

      setAttachments((current) => {
        const next = multiple ? [...current] : []

        for (const file of list) {
          if (maxFiles !== undefined && next.length >= maxFiles) {
            break
          }

          next.push({
            id: `${idPrefix}-${String(next.length)}-${file.name}`,
            file,
            filename: file.name,
            mediaType: file.type,
          })

          if (!multiple) {
            break
          }
        }

        return next
      })
    },
    [idPrefix, maxFiles, multiple],
  )

  useEffect(() => {
    if (!globalDrop) {
      return
    }

    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) {
        return
      }

      event.preventDefault()
      addFiles(event.dataTransfer.files)
    }

    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault()
      }
    }

    window.addEventListener('drop', onDrop)
    window.addEventListener('dragover', onDragOver)

    return () => {
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', onDragOver)
    }
  }, [addFiles, globalDrop])

  const contextValue = useMemo<PromptInputContextValue>(
    () => ({
      attachments,
      accept,
      multiple,
      openFilePicker: () => fileInputRef.current?.click(),
      addFiles,
      removeAttachment: (id) => {
        setAttachments((current) => current.filter((attachment) => attachment.id !== id))
      },
      registerTextarea: (element) => {
        textareaRef.current = element
      },
      requestSubmit: () => formRef.current?.requestSubmit(),
    }),
    [accept, addFiles, attachments, multiple],
  )

  return (
    <PromptInputContext.Provider value={contextValue}>
      <form
        className={cx('assistant-prompt-input', className)}
        data-slot="prompt-input"
        onSubmit={(event) => {
          event.preventDefault()

          onSubmit(
            {
              text: textareaRef.current?.value ?? '',
              files: attachments.map((attachment) => attachment.file),
            },
            event,
          )

          setAttachments([])
        }}
        ref={formRef}
        {...props}
      >
        <input
          accept={accept}
          className="assistant-visually-hidden"
          multiple={multiple}
          onChange={(event) => {
            if (event.currentTarget.files) {
              addFiles(event.currentTarget.files)
            }

            event.currentTarget.value = ''
          }}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />

        {children}
      </form>
    </PromptInputContext.Provider>
  )
}

export function PromptInputBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={className} data-slot="prompt-input-body" {...props} />
}

export function PromptInputAttachments({
  children,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  readonly children: (attachment: PromptInputAttachmentData) => ReactNode
}) {
  const { attachments } = usePromptInputContext()

  if (attachments.length === 0) {
    return null
  }

  return (
    <div className={className} data-slot="prompt-input-attachments" {...props}>
      {attachments.map((attachment) => (
        <span key={attachment.id}>{children(attachment)}</span>
      ))}
    </div>
  )
}

export function PromptInputAttachment({
  className,
  data,
  ...props
}: ComponentProps<'div'> & { readonly data: PromptInputAttachmentData }) {
  const { removeAttachment } = usePromptInputContext()

  return (
    <div className={className} data-slot="prompt-input-attachment" {...props}>
      <FileIcon aria-hidden="true" className="assistant-attachment__icon" />

      <span className="assistant-attachment__meta">
        <span className="assistant-attachment__name">{data.filename}</span>

        <span className="assistant-attachment__type">
          {data.mediaType === '' ? '文件' : data.mediaType}
        </span>
      </span>

      <button
        aria-label={`移除 ${data.filename}`}
        className="assistant-attachment__remove"
        onClick={() => {
          removeAttachment(data.id)
        }}
        type="button"
      >
        <CloseIcon aria-hidden="true" />
      </button>
    </div>
  )
}

export function PromptInputTextarea({
  className,
  onKeyDown,
  ...props
}: ComponentProps<'textarea'>) {
  const { registerTextarea, requestSubmit } = usePromptInputContext()

  return (
    <textarea
      className={className}
      data-slot="prompt-input-textarea"
      onInput={(event) => {
        const element = event.currentTarget

        element.style.height = 'auto'
        element.style.height = `${String(element.scrollHeight)}px`
      }}
      onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
        onKeyDown?.(event)

        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          requestSubmit()
        }
      }}
      ref={registerTextarea}
      rows={1}
      {...props}
    />
  )
}

export function PromptInputToolbar({ className, ...props }: ComponentProps<'div'>) {
  return <div className={className} data-slot="prompt-input-toolbar" {...props} />
}

export function PromptInputTools({ className, ...props }: ComponentProps<'div'>) {
  return <div className={className} data-slot="prompt-input-tools" {...props} />
}

export function PromptInputButton({ className, type, ...props }: ComponentProps<'button'>) {
  return (
    <button
      className={className}
      data-slot="prompt-input-button"
      type={type ?? 'button'}
      {...props}
    />
  )
}

/* ── action menu ──────────────────────────────────────────── */

const ActionMenuContext = createContext<{
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
} | null>(null)

function useActionMenu() {
  const context = useContext(ActionMenuContext)

  if (!context) {
    throw new Error('PromptInputActionMenu sub-components require <PromptInputActionMenu>.')
  }

  return context
}

export function PromptInputActionMenu({ className, ...props }: ComponentProps<'div'>) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const value = useMemo(() => ({ open, setOpen }), [open])

  return (
    <ActionMenuContext.Provider value={value}>
      <div
        className={cx('assistant-action-menu', className)}
        data-slot="prompt-input-action-menu"
        ref={containerRef}
        {...props}
      />
    </ActionMenuContext.Provider>
  )
}

export function PromptInputActionMenuTrigger({ className, ...props }: ComponentProps<'button'>) {
  const { open, setOpen } = useActionMenu()

  return (
    <button
      aria-expanded={open}
      aria-haspopup="menu"
      className={className}
      data-slot="prompt-input-action-menu-trigger"
      onClick={() => {
        setOpen(!open)
      }}
      type="button"
      {...props}
    />
  )
}

export function PromptInputActionMenuContent({ className, ...props }: ComponentProps<'div'>) {
  const { open } = useActionMenu()

  if (!open) {
    return null
  }

  return (
    <div
      className={cx('assistant-action-menu__content', className)}
      data-slot="prompt-input-action-menu-content"
      role="menu"
      {...props}
    />
  )
}

export function PromptInputActionMenuItem({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      className={cx('assistant-action-menu__item', className)}
      data-slot="prompt-input-action-menu-item"
      role="menuitem"
      type="button"
      {...props}
    />
  )
}

export function PromptInputActionAddAttachments({
  label = '添加文件',
}: {
  readonly label?: string
}) {
  const { openFilePicker } = usePromptInputContext()
  const { setOpen } = useActionMenu()

  return (
    <PromptInputActionMenuItem
      onClick={() => {
        setOpen(false)
        openFilePicker()
      }}
    >
      {label}
    </PromptInputActionMenuItem>
  )
}

/* ── submit ───────────────────────────────────────────────── */

export function PromptInputSubmit({
  className,
  status = 'ready',
  ...props
}: ComponentProps<'button'> & { readonly status?: ChatStatus }) {
  const Icon =
    status === 'streaming' ? StopIcon : status === 'submitted' ? SpinnerIcon : ArrowUpIcon

  return (
    <button
      aria-label={status === 'streaming' ? '停止生成' : '发送'}
      className={className}
      data-slot="prompt-input-submit"
      data-status={status}
      type={status === 'streaming' ? 'button' : 'submit'}
      {...props}
    >
      <Icon aria-hidden="true" />
    </button>
  )
}
