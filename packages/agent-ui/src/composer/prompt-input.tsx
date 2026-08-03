import type { ChatStatus } from '@poietica/acp'
import type { ComponentProps, KeyboardEvent, MouseEvent, RefObject } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ImageLightbox, type PreviewableImage } from '../media/ImageLightbox'
import { cx } from '../primitives/class-names'
import { CloseIcon, FileIcon, SpinnerIcon, StopIcon, SubmitIcon } from '../primitives/icons'
import { attachmentIntake, type ComposerAsset } from './attachment-intake'

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

export interface PromptInputMessage {
  readonly text: string
  readonly assets: readonly ComposerAsset[]
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
const NO_ATTACHMENTS: readonly ComposerAsset[] = []

/** 能不能发，就这两位。整串草稿不出现在这里，因为没有人需要它。 */
export interface PromptInputDraft {
  readonly hasText: boolean
  readonly hasFiles: boolean
}

const NO_DRAFT: PromptInputDraft = { hasText: false, hasFiles: false }

/*
 * 收什么，不在这一层判。
 *
 * 判据在原生：内容类型由文件头嗅出来（commands/asset.rs 的 sniff），认不出
 * 来的格式在入库那一步就停住，压根变不出一个 ComposerAsset。所以这里没有
 * accept，也没有 accepted() —— 那个函数在的时候，「能放进框里」这件事由一个
 * 从扩展名猜出来的 File.type 说了算，而它骗得过：把 .svg 改名成 .png 就行。
 *
 * stampedName 与 pastedFiles 也一并没有了：命名归实现（剪贴板那一张由
 * desktop-runtime 给名字），而拖、粘、选三条路交出来的已经是同一种东西。
 */

interface PromptInputActions {
  readonly setText: (text: string) => void
  readonly focusTextarea: () => void
  readonly addAssets: (assets: readonly ComposerAsset[]) => void
  readonly removeAttachment: (assetToken: string) => void
  readonly openFilePicker: () => void
  readonly registerTextarea: (element: HTMLTextAreaElement | null) => void
  readonly requestSubmit: () => void
}

const ActionsContext = createContext<PromptInputActions | null>(null)
const TextContext = createContext<string>('')
const AttachmentsContext = createContext<readonly ComposerAsset[]>(NO_ATTACHMENTS)
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

export function usePromptInputAttachments(): readonly ComposerAsset[] {
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
  readonly handle?: RefObject<PromptInputHandle | null> | undefined
  readonly multiple?: boolean
  readonly maxFiles?: number
  readonly onSubmit: (message: PromptInputMessage) => void
}

export function PromptInput({
  children,
  className,
  handle,
  maxFiles,
  multiple = false,
  onSubmit,
  ...props
}: PromptInputProps) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<readonly ComposerAsset[]>([])

  const formRef = useRef<HTMLFormElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const addAssets = useCallback(
    (incoming: readonly ComposerAsset[]) => {
      setAttachments((current) => {
        const next = multiple ? [...current] : []

        for (const asset of incoming) {
          if (maxFiles !== undefined && next.length >= maxFiles) {
            break
          }

          /* 身份是内容摘要，所以同一张图挑两次就是同一张图。这不是"去重"，
          这是内容寻址本来的意思 —— 两张卡片指着同一个令牌，移掉其中一张会
          把另一张的字节也放掉。 */
          if (next.some((held) => held.assetToken === asset.assetToken)) {
            continue
          }

          next.push(asset)

          if (!multiple) {
            break
          }
        }

        return next
      })
    },
    [maxFiles, multiple],
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

  const removeAttachment = useCallback((assetToken: string) => {
    setAttachments((current) => {
      const going = current.find((attachment) => attachment.assetToken === assetToken)

      /* 移掉一张卡片就是放掉那一份字节。不放，注册表会一直替一个已经不在
      屏幕上的东西占着预算，而那笔预算是整个进程共用的（MAX_REGISTRY_BYTES）。 */
      if (going !== undefined) {
        attachmentIntake()?.discard(going)
      }

      return current.filter((attachment) => attachment.assetToken !== assetToken)
    })
  }, [])

  /*
   * 加号：系统文件对话框，不是一个藏起来的 <input type="file">。
   *
   * 它交回的是路径，而路径正是原生入库要的东西（asset_import）—— 那个隐藏的
   * input 交回的是 File，于是字节必须先被读进 webview 才能过去。少一个 DOM
   * 节点是顺带的，真正换掉的是这条路的形状。
   */
  const openFilePicker = useCallback(() => {
    const intake = attachmentIntake()

    if (intake === null) {
      return
    }

    void intake.pick(multiple).then(addAssets, () => {
      /* 用户取消，或者这一批一个都收不下。两种都不该在屏幕上炸出一句报错：
      收不下的原因（格式不对）由原生说，而它说的话属于这一句消息的转录，
      不属于输入框 —— 输入框只是没有多出一张卡片。 */
    })
  }, [addAssets, multiple])

  const registerTextarea = useCallback((element: HTMLTextAreaElement | null) => {
    textareaRef.current = element
  }, [])

  const requestSubmit = useCallback(() => {
    formRef.current?.requestSubmit()
  }, [])

  /*
   * 往窗口里拖文件。
   *
   * 这是这个程序第一次真的支持拖放。此前 form 上挂着 onDragOver / onDrop 两个
   * 处理器，而它们从落地起一行都没有执行过：Tauri 的 dragDropEnabled 默认为
   * 真，原生拖放接管了整个 webview，HTML5 的那一套在 Windows 上收不到事件
   * （官方文档：Disabling it is required to use HTML5 drag and drop on the
   * frontend on Windows）。tauri.conf.json 里没有写过这一格，所以它一直是开着的。
   *
   * 正确的做法不是把它关掉去救那两个死处理器 —— 关掉之后拿到的仍然是 File，
   * 字节还得进 webview。而是听原生这一条：它给的是路径。
   */
  useEffect(() => {
    const intake = attachmentIntake()

    if (intake === null) {
      return undefined
    }

    return intake.watchDrop(addAssets)
  }, [addAssets])

  /* 全是 useCallback 或 setState，所以这个对象建一次就到卸载。 */
  const actions = useMemo<PromptInputActions>(
    () => ({
      setText,
      focusTextarea,
      addAssets,
      removeAttachment,
      openFilePicker,
      registerTextarea,
      requestSubmit,
    }),
    [addAssets, focusTextarea, openFilePicker, registerTextarea, removeAttachment, requestSubmit],
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
      openFilePicker()
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
              onKeyDown={onFormKeyDown}
              onMouseDown={onFormMouseDown}
              onPaste={(event) => {
                /* 三条路里唯一还经过字节的一条：剪贴板里的截图没有路径，
                系统给不出，所以它走不了按路径入库那一条。粘贴文字不该被
                这一层碰到，所以先看有没有文件。 */
                const intake = attachmentIntake()
                const [pasted] = Array.from(event.clipboardData.files)

                if (intake === null || pasted === undefined) {
                  return
                }

                event.preventDefault()

                void intake.paste(pasted).then(
                  (asset) => {
                    addAssets([asset])
                  },
                  () => {
                    /* 与加号同一条规矩：收不下就是没多出一张卡片。 */
                  },
                )
              }}
              onSubmit={(event) => {
                event.preventDefault()

                const trimmed = text.trim()

                if (trimmed.length === 0 && attachments.length === 0) {
                  return
                }

                onSubmit({ text: trimmed, assets: attachments })
                setText('')

                /* 不 discard：这些字节现在归这条对话的交付会话（原生侧 adopt
                会把引用加一），输入框只是不再拿着它们。 */
                setAttachments([])
              }}
              {...props}
              ref={formRef}
            >
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

const isImage = (mediaType: string) => mediaType.startsWith('image/')

export function PromptInputAttachments({ className, ...props }: ComponentProps<'div'>) {
  const attachments = usePromptInputAttachments()
  const { removeAttachment } = usePromptInputActions()
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  /*
   * 灯箱只装图片，编号也只在图片之间连续。
   *
   * 混排时若直接拿附件下标当 slide index，左右键会翻到一张不存在的幻灯片 ——
   * 一个 PDF 夹在两张图中间就够了。所以这里先塌缩成纯图片序列，附件行再回头
   * 按 id 找自己的位置。
   */
  const images = useMemo<readonly PreviewableImage[]>(
    () =>
      attachments.flatMap((attachment) =>
        isImage(attachment.mediaType)
          ? [
              {
                id: attachment.assetToken,
                src: attachment.url,
                alt: attachment.filename,
                caption: attachment.filename,
              },
            ]
          : [],
      ),
    [attachments],
  )

  if (attachments.length === 0) {
    return null
  }

  return (
    <div className={className} data-slot="prompt-input-attachments" {...props}>
      {attachments.map((attachment) => {
        /* 地址从入库那一刻就有了，所以没有"第一帧还没有 URL"这回事 —— 那是
        object URL 时代的处境，它要等一个 effect 跑完才存在。 */
        const preview = isImage(attachment.mediaType) ? attachment.url : undefined
        const slide = images.findIndex((image) => image.id === attachment.assetToken)

        return (
          <div
            className="assistant-attachment"
            data-slot="prompt-input-attachment"
            key={attachment.assetToken}
          >
            {preview === undefined || slide === -1 ? (
              <FileIcon aria-hidden="true" className="assistant-attachment__icon" />
            ) : (
              <button
                aria-label={`预览 ${attachment.filename}`}
                className="assistant-attachment__preview"
                onClick={() => {
                  setOpenIndex(slide)
                }}
                type="button"
              >
                <img
                  alt=""
                  className="assistant-attachment__thumb"
                  decoding="async"
                  draggable={false}
                  src={preview}
                />
              </button>
            )}

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
                removeAttachment(attachment.assetToken)
              }}
              type="button"
            >
              <CloseIcon aria-hidden="true" />
            </button>
          </div>
        )
      })}

      <ImageLightbox images={images} index={openIndex} onIndexChange={setOpenIndex} />
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
