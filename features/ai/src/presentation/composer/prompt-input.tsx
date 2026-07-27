import type { ComponentProps, FormEvent, KeyboardEvent, ReactNode } from 'react'
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

import type { ChatStatus } from '../../contracts/chat-status-contract'
import { CloseIcon, FileIcon, SpinnerIcon, StopIcon, SubmitIcon } from '../primitives/icons'

/*
 * The composer input.
 *
 * This file was once labelled a vendored copy of an upstream component set. It
 * never was one: there is no third-party primitive here, no icon package beyond
 * this project's own alias layer, and no utility-class framework. The label was
 * the only thing tying it to a dependency this project does not have, so the
 * label is gone and the file lives where it belongs.
 *
 * Two rules hold it together:
 *   - the DOM is the contract. Every element carries the data-slot the
 *     stylesheet keys off, so the skin is free to change without touching
 *     behaviour, and behaviour is free to change without touching the skin.
 *   - state that more than one part needs lives in a context, and nowhere else.
 *     Nothing here reaches across the tree with a query selector.
 *
 * Optional props are typed `T | undefined` rather than `T?` wherever the value
 * is forwarded onward, because under exactOptionalPropertyTypes "absent" and
 * "present and undefined" are different types, and forwarding conflates them.
 */

export type { ChatStatus }

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
  readonly accept: string | undefined
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

  /*
   * Growth is owned by the stylesheet (`field-sizing: content` between the
   * idle and maximum line counts). Writing an inline height here would outrank
   * the sheet and put two mechanisms in charge of one dimension.
   */
  return (
    <textarea
      className={className}
      data-slot="prompt-input-textarea"
      onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
        onKeyDown?.(event)

        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          requestSubmit()
        }
      }}
      ref={registerTextarea}
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

export function PromptInputActionMenuItem({
  children,
  className,
  hint,
  onClick,
  ...props
}: ComponentProps<'button'> & { readonly hint?: string | undefined }) {
  const { setOpen } = useActionMenu()

  return (
    <button
      className={cx('assistant-action-menu__item', className)}
      data-slot="prompt-input-action-menu-item"
      onClick={(event) => {
        setOpen(false)
        onClick?.(event)
      }}
      role="menuitem"
      type="button"
      {...props}
    >
      <span>{children}</span>

      {hint === undefined ? null : <kbd className="assistant-action-menu__hint">{hint}</kbd>}
    </button>
  )
}

export function PromptInputActionAddAttachments({
  children = '图片与文件',
  hint,
}: {
  readonly children?: ReactNode
  readonly hint?: string | undefined
}) {
  const { openFilePicker } = usePromptInputContext()

  return (
    <PromptInputActionMenuItem
      hint={hint}
      onClick={() => {
        openFilePicker()
      }}
    >
      {children}
    </PromptInputActionMenuItem>
  )
}

export function PromptInputSubmit({
  className,
  status = 'ready',
  ...props
}: ComponentProps<'button'> & { readonly status?: ChatStatus }) {
  const Icon = status === 'streaming' ? StopIcon : status === 'submitted' ? SpinnerIcon : SubmitIcon

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
