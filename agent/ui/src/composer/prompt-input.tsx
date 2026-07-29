import type { ChatStatus } from '@poietica/agent-protocol'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@poietica/foundations-design-system'
import type { ComponentProps, KeyboardEvent, MouseEvent, ReactNode, RefObject } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cx } from '../primitives/class-names'
import { CloseIcon, FileIcon, SpinnerIcon, StopIcon, SubmitIcon } from '../primitives/icons'

/*
 * The composer input.
 *
 * One owner for everything the box holds. The draft text and the attachments
 * live here and nowhere else: the form reads them at submit time, the toolbar
 * reads them to decide what it may offer, and the surface reaches them through
 * the context rather than through the document. Nothing in this file, and
 * nothing built on it, looks an element up by id.
 *
 * Popups are the design system's DropdownMenu, which is the same one the thread
 * list already uses. Rolling a second menu here bought nothing and cost the
 * keyboard: no arrow keys, no typeahead, no focus return, no portal.
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
  readonly text: string
  readonly setText: (text: string) => void
  readonly insertText: (token: string) => void
  readonly focusTextarea: () => void
  readonly attachments: readonly PromptInputAttachmentData[]
  readonly addFiles: (files: FileList | readonly File[]) => void
  readonly removeAttachment: (id: string) => void
  readonly openFilePicker: () => void
  readonly registerTextarea: (element: HTMLTextAreaElement | null) => void
  readonly requestSubmit: () => void
}

const PromptInputContext = createContext<PromptInputContextValue | null>(null)

export function usePromptInput(): PromptInputContextValue {
  const context = useContext(PromptInputContext)

  if (!context) {
    throw new Error('PromptInput sub-components must be rendered inside <PromptInput>.')
  }

  return context
}

/**
 * What the composer may be asked from outside it.
 *
 * The draft is owned here, so writing a starter into it has to come in through
 * the element rather than through a second copy of the state held above it;
 * focus travels with the text, because a phrase the user is meant to finish is
 * useless in an unfocused field.
 *
 * Its own prop, not a ref: the form's ref is already spoken for by
 * requestSubmit, and a caller-supplied one would land after the spread and win
 * silently.
 */
export interface PromptInputHandle {
  readonly setText: (text: string) => void
  readonly focus: () => void
}

export interface PromptInputProps extends Omit<ComponentProps<'form'>, 'onSubmit'> {
  readonly accept?: string
  readonly handle?: RefObject<PromptInputHandle | null> | undefined
  readonly multiple?: boolean
  readonly maxFiles?: number
  readonly onSubmit: (message: PromptInputMessage) => void
}

export function PromptInput({
  accept,
  children,
  className,
  handle,
  maxFiles,
  multiple = false,
  onSubmit,
  ...props
}: PromptInputProps) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<readonly PromptInputAttachmentData[]>([])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const idPrefix = useId()

  const addFiles = useCallback(
    (incoming: FileList | readonly File[]) => {
      setAttachments((current) => {
        const next = multiple ? [...current] : []

        for (const file of Array.from(incoming)) {
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

  const focusTextarea = useCallback(() => {
    const editor = textareaRef.current

    if (!editor) {
      return
    }

    editor.focus()
    editor.setSelectionRange(editor.value.length, editor.value.length)
  }, [])

  useImperativeHandle(handle, () => ({ setText, focus: focusTextarea }), [focusTextarea])

  const contextValue = useMemo<PromptInputContextValue>(
    () => ({
      text,
      setText,
      insertText: (token) => {
        setText((current) =>
          current.length === 0 || current.endsWith(' ') ? current + token : `${current} ${token}`,
        )
        focusTextarea()
      },
      focusTextarea,
      attachments,
      addFiles,
      removeAttachment: (id) => {
        setAttachments((current) => current.filter((attachment) => attachment.id !== id))
      },
      openFilePicker: () => fileInputRef.current?.click(),
      registerTextarea: (element) => {
        textareaRef.current = element
      },
      requestSubmit: () => formRef.current?.requestSubmit(),
    }),
    [addFiles, attachments, focusTextarea, text],
  )

  /* Scoped to the composer, so it cannot outrank the workbench command table. */
  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'u') {
      event.preventDefault()
      fileInputRef.current?.click()
    }
  }

  /* Clicking the card is clicking the field, unless something else was hit. */
  const onFormMouseDown = (event: MouseEvent<HTMLFormElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input, textarea, [role]')) {
      return
    }

    event.preventDefault()
    focusTextarea()
  }

  return (
    <PromptInputContext.Provider value={contextValue}>
      <form
        className={cx('assistant-prompt-input', className)}
        data-slot="prompt-input"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault()
          }
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) {
            return
          }

          event.preventDefault()
          addFiles(event.dataTransfer.files)
        }}
        onKeyDown={onFormKeyDown}
        onMouseDown={onFormMouseDown}
        onSubmit={(event) => {
          event.preventDefault()

          const trimmed = text.trim()

          if (trimmed.length === 0 && attachments.length === 0) {
            return
          }

          onSubmit({ text: trimmed, files: attachments.map((attachment) => attachment.file) })
          setText('')
          setAttachments([])
        }}
        {...props}
        ref={formRef}
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

export function PromptInputAttachments({ className, ...props }: ComponentProps<'div'>) {
  const { attachments, removeAttachment } = usePromptInput()

  if (attachments.length === 0) {
    return null
  }

  return (
    <div className={className} data-slot="prompt-input-attachments" {...props}>
      {attachments.map((attachment) => (
        <div
          className="assistant-attachment"
          data-slot="prompt-input-attachment"
          key={attachment.id}
        >
          <FileIcon aria-hidden="true" className="assistant-attachment__icon" />

          <span className="assistant-attachment__meta">
            <span className="assistant-attachment__name">{attachment.filename}</span>

            <span className="assistant-attachment__type">
              {attachment.mediaType === '' ? '文件' : attachment.mediaType}
            </span>
          </span>

          <button
            aria-label={`移除 ${attachment.filename}`}
            className="assistant-attachment__remove"
            onClick={() => {
              removeAttachment(attachment.id)
            }}
            type="button"
          >
            <CloseIcon aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}

export function PromptInputTextarea({ className, ...props }: ComponentProps<'textarea'>) {
  const { registerTextarea, requestSubmit, setText, text } = usePromptInput()
  const editor = useRef<HTMLTextAreaElement | null>(null)
  /* 量高度的替身，以及观察器要用的那一版量法。 */
  const mirror = useRef<HTMLDivElement | null>(null)
  const latest = useRef<() => void>(() => undefined)

  /* 一个 ref 两件事：谁持有这个元素归 PromptInput，量它的高度归这里。 */
  const bind = useCallback(
    (node: HTMLTextAreaElement | null) => {
      editor.current = node
      registerTextarea(node)
    },
    [registerTextarea],
  )

  /*
   * 长高要能补间，就得有一个会变的长度，而且这个元素自己的高度只许被写、不许被读。
   *
   * 样式表里的 field-sizing: content 改的是"用过的值"，计算 block-size 恒为
   * auto，而过渡只在计算值变化时启动——单靠它，长高永远一帧到位。
   *
   * 但"先归零再读 scrollHeight"同样不行：读一次就强制一次样式重算，于是变化前
   * 的样式变成 auto，随后写像素值时两个端点是 auto → Npx，不可插值，过渡照样
   * 不启动。这是上一版没长高的确切原因。
   *
   * 所以量的是一个替身：同宽、同字体、同行高、同内边距，装同样的文本。输入框
   * 自己的 block-size 因此只经历"旧像素值 → 新像素值"，两端都是长度，过渡成立。
   * 上下限仍由样式表的 min/max 钳住；这段路怎么走，见下面的 settle。
   */
  /*
   * 高度怎么走，交给 Web Animations，不交给 CSS transition。
   *
   * 两个理由，都不是调参能解决的：
   *
   * 一，固定时长对内容驱动的位移天生不自然。粘两行和粘两百行走同一个 240ms，
   *     位移差一个数量级而时长不变，观感就是生硬。时长应当跟位移走。
   * 二，transition 被打断时从当前值重新起跑，不保速度；连着粘两次就会顿。
   *     这一版把当前渲染高度读出来当起点，新的一次从旧的那一次手里接管。
   *
   * 起点取 getBoundingClientRect，而不是行内样式里写着的值：上一次的动画可能还在
   * 跑，写着的是它的终点，不是眼睛看到的位置。
   */
  const running = useRef<Animation | null>(null)

  const settle = useCallback((node: HTMLTextAreaElement, target: number) => {
    const from = node.getBoundingClientRect().height

    running.current?.cancel()
    running.current = null

    /* 布局值先落定，动画只负责这段路怎么走。 */
    node.style.setProperty('block-size', `${String(target)}px`)

    const delta = Math.abs(target - from)

    /* 第一次量的时候元素还没进过布局，那一下不该有入场动画。 */
    if (from === 0 || delta < 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    /*
     * 时长跟位移走，两头钳住：短了看不见，长了碍事。
     * 曲线不过冲——过冲会撞上 max-block-size，把工具栏顶一下再弹回来。
     */
    const duration = Math.min(400, Math.max(130, delta * 1.7))

    running.current = node.animate(
      { blockSize: [`${String(from)}px`, `${String(target)}px`] },
      { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'none' },
    )
  }, [])

  const measure = useCallback(() => {
    const node = editor.current

    if (node === null) {
      return
    }

    let ghost = mirror.current

    if (ghost === null) {
      ghost = document.createElement('div')
      ghost.setAttribute('aria-hidden', 'true')
      mirror.current = ghost
      document.body.append(ghost)
    }

    const style = getComputedStyle(node)

    /* 替身不参与布局、不接指针、不可见，也不能自己滚动。 */
    ghost.style.cssText = [
      'position: fixed',
      'inset-block-start: 0',
      'inset-inline-start: -9999px',
      'visibility: hidden',
      'pointer-events: none',
      'overflow: hidden',
      'white-space: pre-wrap',
      'overflow-wrap: break-word',
      `box-sizing: ${style.boxSizing}`,
      `inline-size: ${String(node.clientWidth)}px`,
      `padding-block: ${style.paddingBlockStart} ${style.paddingBlockEnd}`,
      `padding-inline: ${style.paddingInlineStart} ${style.paddingInlineEnd}`,
      `font-family: ${style.fontFamily}`,
      `font-size: ${style.fontSize}`,
      `font-weight: ${style.fontWeight}`,
      `font-style: ${style.fontStyle}`,
      `font-variant: ${style.fontVariant}`,
      `letter-spacing: ${style.letterSpacing}`,
      `line-height: ${style.lineHeight}`,
      `tab-size: ${style.tabSize}`,
      `word-break: ${style.wordBreak}`,
    ].join(';')

    /* 末尾补一个换行：最后一行为空时它也要占一行，否则按回车高度不动。 */
    ghost.textContent = `${text}\n`

    settle(node, ghost.offsetHeight)
  }, [settle, text])

  useLayoutEffect(measure, [measure])

  /* 观察器要用的是最新那一版量法，但它自己不该因为敲了一个字符就重建。 */
  useLayoutEffect(() => {
    latest.current = measure
  }, [measure])

  /* 替身随组件一起走。 */
  useEffect(
    () => () => {
      running.current?.cancel()
      running.current = null
      mirror.current?.remove()
      mirror.current = null
    },
    [],
  )

  /*
   * 宽度变了换行就变了，高度跟着变：拖动侧栏、缩放窗口都算。观察器会把自己写下
   * 的高度一起报回来，所以只在宽度真的变化时重量一次。
   */
  useLayoutEffect(() => {
    const node = editor.current

    if (node === null || typeof ResizeObserver === 'undefined') {
      return undefined
    }

    let last = node.clientWidth

    const observer = new ResizeObserver(() => {
      const width = node.clientWidth

      if (width === last) {
        return
      }

      last = width
      latest.current()
    })

    observer.observe(node)

    return () => {
      observer.disconnect()
    }
  }, [])

  return (
    <textarea
      className={className}
      data-slot="prompt-input-textarea"
      onChange={(event) => {
        setText(event.currentTarget.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          requestSubmit()
        }
      }}
      ref={bind}
      value={text}
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

/* ── action menu ──────────────────────────────────────────
 * The design system's menu, not a second one. Portal, arrow keys, typeahead,
 * Escape and focus return all come with it.
 */

export function PromptInputActionMenu({ children }: { readonly children: ReactNode }) {
  return <DropdownMenu>{children}</DropdownMenu>
}

export function PromptInputActionMenuTrigger({ className, ...props }: ComponentProps<'button'>) {
  return <DropdownMenuTrigger className={className} {...props} />
}

export function PromptInputActionMenuContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <DropdownMenuContent
      align="start"
      className={cx('assistant-action-menu__content assistant-menu-surface', className)}
      data-assistant-skin
      side="top"
      sideOffset={6}
      {...props}
    />
  )
}

/*
 * className 在这里只接受字符串。
 *
 * 设计系统的菜单项允许把 className 写成 (state) => string，而这个包装组件的
 * 职责是往类名里拼一个固定的 BEM 类，只能兑现字符串形式：函数原样进 cx 会被
 * filter(Boolean) 留下、再被 join 成一整段源码当类名，是静默的错误行为。收窄
 * 之后，真需要函数形式时报错会出现在调用点，由那里决定怎么合成。
 *
 * cx 不换成设计系统的 cn：cn 是 clsx + tailwind-merge，而这里拼的全是
 * assistant-* 这类 BEM 类名，没有 Tailwind 的属性冲突可解，换过去只是白跑一遍
 * 冲突表解析。
 */
/*
 * onSelect is refused at the type level.
 *
 * The row underneath is Base UI's Menu.Item, whose callback is onClick, while
 * onSelect is a React DOM event about text selection inside a field. Written
 * here it satisfies the checker, survives the build, and is never called on a
 * click. A silent failure has to become a compile error, and the place to make
 * it one is the wrapper every caller goes through.
 */
export function PromptInputActionMenuItem({
  children,
  className,
  hint,
  ...props
}: Omit<ComponentProps<typeof DropdownMenuItem>, 'className' | 'onSelect'> & {
  readonly className?: string
  readonly hint?: string
}) {
  return (
    <DropdownMenuItem className={cx('assistant-action-menu__item', className)} {...props}>
      <span>{children}</span>

      {hint === undefined ? null : <kbd className="assistant-action-menu__hint">{hint}</kbd>}
    </DropdownMenuItem>
  )
}

export function PromptInputSubmit({
  className,
  onCancel,
  status = 'ready',
  ...props
}: Omit<ComponentProps<'button'>, 'onClick'> & {
  readonly status?: ChatStatus
  readonly onCancel?: (() => void) | undefined
}) {
  const isStreaming = status === 'streaming'
  const Icon = isStreaming ? StopIcon : status === 'submitted' ? SpinnerIcon : SubmitIcon

  return (
    <button
      aria-label={isStreaming ? '停止生成' : '发送'}
      className={className}
      data-slot="prompt-input-submit"
      data-status={status}
      onClick={isStreaming ? onCancel : undefined}
      type={isStreaming ? 'button' : 'submit'}
      {...props}
    >
      <Icon aria-hidden="true" />
    </button>
  )
}
