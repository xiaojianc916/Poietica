import type { ChatStatus } from '@poietica/acp'
import type { ComponentProps, KeyboardEvent, MouseEvent, RefObject } from 'react'
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
 * 弹层不在这里:加号那一侧的菜单是 composer-actions.tsx 的事,它直接用设计系统
 * 的 DropdownMenu。这个文件曾经为它包了四层只转发 props 的壳 —— 转发不是抽象,
 * 它只是让调用点多绕一层,并且逼出一段解释"为什么 onSelect 必须在类型上被拒"
 * 的长注释。壳没了,那段债也就没了。
 */

export type { ChatStatus }

/* 问一次就够。此前它长在每个字符都要跑的那条路上。 */
const STILLNESS =
  typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null

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

/*
 * 四条线，各订各的。
 *
 * 草稿每敲一个字符就变，而工具栏、加号菜单、附件区没有一个真的需要那串字：
 * 它们要么只要动作，要么只要「有没有东西可发」这一个布尔。此前四方共用一个
 * useMemo 出来的对象，而 text 在它的依赖里 —— 于是每一次按键都换掉同一个引用，
 * 整棵 composer 子树跟着 reconcile，其中包括 ComposerActions 与 SessionControls
 * 两个菜单根，以及后者每次都重跑的 [...controls].filter().sort()。
 *
 * 拆开之后：动作恒定，文本只有 textarea 订，附件只有附件区订，而 hasText /
 * hasFiles 只在空与非空之间翻转时换引用。从第一个字符敲到第五百个，工具栏一共
 * 醒一次。
 */
const NO_ATTACHMENTS: readonly PromptInputAttachmentData[] = []

/** 能不能发，就这两位。整串草稿不出现在这里，因为没有人需要它。 */
export interface PromptInputDraft {
  readonly hasText: boolean
  readonly hasFiles: boolean
}

const NO_DRAFT: PromptInputDraft = { hasText: false, hasFiles: false }

interface PromptInputActions {
  readonly setText: (text: string) => void
  readonly focusTextarea: () => void
  readonly addFiles: (files: FileList | readonly File[]) => void
  readonly removeAttachment: (id: string) => void
  readonly openFilePicker: () => void
  readonly registerTextarea: (element: HTMLTextAreaElement | null) => void
  readonly requestSubmit: () => void
}

const ActionsContext = createContext<PromptInputActions | null>(null)
const TextContext = createContext<string>('')
const AttachmentsContext = createContext<readonly PromptInputAttachmentData[]>(NO_ATTACHMENTS)
const DraftContext = createContext<PromptInputDraft>(NO_DRAFT)

export function usePromptInputActions(): PromptInputActions {
  const actions = useContext(ActionsContext)

  if (!actions) {
    throw new Error('PromptInput sub-components must be rendered inside <PromptInput>.')
  }

  return actions
}

export function usePromptInputText(): string {
  return useContext(TextContext)
}

export function usePromptInputAttachments(): readonly PromptInputAttachmentData[] {
  return useContext(AttachmentsContext)
}

export function usePromptInputDraft(): PromptInputDraft {
  return useContext(DraftContext)
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

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }, [])

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const registerTextarea = useCallback((element: HTMLTextAreaElement | null) => {
    textareaRef.current = element
  }, [])

  const requestSubmit = useCallback(() => {
    formRef.current?.requestSubmit()
  }, [])

  /* 全是 useCallback 或 setState，所以这个对象建一次就到卸载。 */
  const actions = useMemo<PromptInputActions>(
    () => ({
      setText,
      focusTextarea,
      addFiles,
      removeAttachment,
      openFilePicker,
      registerTextarea,
      requestSubmit,
    }),
    [addFiles, focusTextarea, openFilePicker, registerTextarea, removeAttachment, requestSubmit],
  )

  /*
   * 两个布尔，不是一串字。
   *
   * 依赖是布尔本身，所以第 2 到第 500 个字符全部落在同一个引用上 —— 订这条线
   * 的工具栏因此不会因为多敲一个字而重渲。
   */
  const hasText = text.trim().length > 0
  const hasFiles = attachments.length > 0
  const draft = useMemo<PromptInputDraft>(() => ({ hasText, hasFiles }), [hasFiles, hasText])

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
    <ActionsContext.Provider value={actions}>
      <TextContext.Provider value={text}>
        <AttachmentsContext.Provider value={attachments}>
          <DraftContext.Provider value={draft}>
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
          </DraftContext.Provider>
        </AttachmentsContext.Provider>
      </TextContext.Provider>
    </ActionsContext.Provider>
  )
}

export function PromptInputBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={className} data-slot="prompt-input-body" {...props} />
}

export function PromptInputAttachments({ className, ...props }: ComponentProps<'div'>) {
  const attachments = usePromptInputAttachments()
  const { removeAttachment } = usePromptInputActions()

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
  const { registerTextarea, requestSubmit, setText } = usePromptInputActions()
  const text = usePromptInputText()
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
   * 上下限仍然只在样式表里写一次，由 settle 读计算样式取回来；这段路怎么走，
   * 也见下面的 settle。
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

  /*
   * 走多远由样式表说了算，所以先问它，再算时长。
   *
   * 上一版把替身量出的完整文本高度直接当终点：粘进两百行时终点是三千像素，
   * 而 max-block-size 把元素封在八行上。于是位移按三千像素算出满档时长，元素
   * 却在八行处就到底了 —— 眼睛看到的是动一小段、然后剩下大半段时间什么都不
   * 动。那不是曲线不好，是时长在为一段不存在的路计费。
   *
   * 钳制读的是计算样式，不是这里再抄一遍 --cp-editor-max：那两个数一旦分居，
   * 改样式表的人不会知道还有一份副本，而且不会报错。
   */
  /*
   * 上下限与替身的那身衣服，都只在样式真的可能变了的时候取。
   *
   * 此前它们躺在每字符都要跑的那条路上：一次 getComputedStyle 读钳制值、又一次
   * getComputedStyle 读字体与内边距，然后把 22 条声明整段重写一遍。那 22 条里，
   * 两次按键之间会变的只有 inline-size —— 其余 21 条是常量，被当成变量重算了
   * 几百遍，每一遍都在 useLayoutEffect 里同步挡着绘制。
   */
  const bounds = useRef({ ceiling: Number.POSITIVE_INFINITY, floor: 0 })
  /* 上一次穿衣时的宽度，以及上一次写下去的高度。都用来避免白做。 */
  const dressed = useRef(-1)
  const applied = useRef(-1)

  const dress = useCallback((node: HTMLTextAreaElement, ghost: HTMLDivElement) => {
    const style = getComputedStyle(node)
    const ceiling = Number.parseFloat(style.maxBlockSize)
    const floor = Number.parseFloat(style.minBlockSize)

    bounds.current = {
      ceiling: Number.isFinite(ceiling) ? ceiling : Number.POSITIVE_INFINITY,
      floor: Number.isFinite(floor) ? floor : 0,
    }

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
  }, [])

  const settle = useCallback((node: HTMLTextAreaElement, wanted: number) => {
    const { ceiling, floor } = bounds.current
    const target = Math.max(floor, Math.min(ceiling, wanted))

    /*
     * 同一行里继续打字，高度一个像素都不会变。
     *
     * 这一条早退是这段路上最大的一笔：它把 getBoundingClientRect 那次强制布局、
     * 一次行内样式写入和一个 Animation 对象整个省掉，而省掉的次数正是「按键数
     * 减去换行数」—— 绝大多数按键。
     */
    if (target === applied.current) {
      return
    }

    const from = node.getBoundingClientRect().height

    running.current?.cancel()
    running.current = null
    applied.current = target

    /* 布局值先落定，动画只负责这段路怎么走。 */
    node.style.setProperty('block-size', `${String(target)}px`)

    /* 位移是钳制之后的位移，也就是眼睛真的会看到的那一段。 */
    const delta = Math.abs(target - from)

    /* 第一次量的时候元素还没进过布局，那一下不该有入场动画。 */
    if (from === 0 || delta < 1 || STILLNESS?.matches === true) {
      return
    }

    /*
     * 时长跟真实位移走，两头钳住：短了看不见，长了碍事。到顶之后继续粘字
     * 是零位移，于是零动画 —— 这正是该有的表现。
     * 曲线不过冲：过冲会撞上钳位，把工具栏顶一下再弹回来。
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

    /* 宽度没动，衣服就还合身。窗口缩放与侧栏拖动会走到这里换一次。 */
    const width = node.clientWidth

    if (width !== dressed.current) {
      dressed.current = width
      dress(node, ghost)
    }

    /* 末尾补一个换行：最后一行为空时它也要占一行，否则按回车高度不动。 */
    ghost.textContent = `${text}\n`

    settle(node, ghost.offsetHeight)
  }, [dress, settle, text])

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
