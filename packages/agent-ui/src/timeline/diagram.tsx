import { type PointerEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import { CodeBlock, CodeBlockCopyButton } from 'streamdown'

import { CodeIcon, PreviewIcon, ResetIcon, ZoomInIcon, ZoomOutIcon } from '../primitives/icons'

/*
 * 一张图，一块面板。
 *
 * mermaid 围栏由这里接管：上游的自定义渲染器分支排在它自带的 mermaid 分支之前，注册了这
 * 一条之后，那套「外层卡片 + 一行语言标签 + 悬在渲染区上方的按钮 + 内层卡片」不再有机会
 * 出现。面板长什么样归 timeline.css，与代码块、表格同一处。
 *
 * isIncomplete 由上游给：流式进行中、且这是最后一块、且围栏尚未闭合。「写完了没有」因此
 * 按围栏计，不按整条消息计 —— 官方 Streaming Considerations 一节给的正是这条路径。围栏
 * 没闭合的这段时间屏幕上是源码本身（官方代码块，Shiki 高亮），围栏一闭合当场换成图。
 */

type Engine = ReturnType<typeof import('@streamdown/mermaid')['mermaid']['getMermaid']>

/*
 * 引擎的配置只说一次：getMermaid 初始化的是模块级单例，两份配置轮流生效意味着同一段源码
 * 画出两种样子。
 *
 * theme neutral 是灰阶，与这块面板同一个语气；fontFamily 交给 inherit，图里的中文标签因此
 * 和界面同一套字形，而不是落到 monospace 的兜底字体上。securityLevel strict 让标签里的
 * HTML 不被执行，suppressErrorRendering 让渲染失败不要往文档上挂一张官方错误图 —— 失败
 * 该说什么，由下面那个状态决定。
 */
const CONFIG = {
  fontFamily: 'inherit',
  securityLevel: 'strict',
  startOnLoad: false,
  suppressErrorRendering: true,
  theme: 'neutral',
} as const

/*
 * 缩放的上下限与上游取齐（它那个 pan-zoom 组件是 minZoom 0.5 / maxZoom 3）。步长不同：
 * 那边是滚轮连续缩放所以取 0.1，这里一次点击走一档，0.25 才看得出变化。
 */
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
const ZOOM_STEP = 0.25

/*
 * 布局引擎按需取，取回来的整个进程共用一台：它在首屏那个 chunk 里是纯负担，一条一张图都
 * 没有的会话也要在窗口呈现之前解析完它。动态 import 是 ESM 与打包器官方的代码分割形态。
 */
let engine: Promise<Engine> | undefined

function diagramEngine(): Promise<Engine> {
  engine ??= import('@streamdown/mermaid')
    .then((module) => module.mermaid.getMermaid(CONFIG))
    .catch((cause: unknown) => {
      /* 取不回来不是此后的定局：忘掉这一次，下一张图重新取。 */
      engine = undefined

      throw new Error(`diagram engine unavailable: ${String(cause)}`)
    })

  return engine
}

/*
 * 图该有多大，由 viewBox 说了算。
 *
 * 引擎交出来的 svg 自带 width="100%" 和一条 max-width 内联样式，于是它永远缩到正文栏宽 ——
 * 一张十来个参与者的时序图落进 700px，字就只剩几个像素高。viewBox 是这张图自己的坐标尺寸，
 * viewBox.baseVal 是 SVG DOM 的官方读法，拿它按倍数写死像素宽高，图就按自己的尺寸出现，
 * 装不下的部分交给舞台去滚。max-width 必须一并解除，否则放大到超过它之后再也大不上去。
 *
 * 没有 viewBox 的图（baseVal 全零）保持引擎自己的尺寸，不去猜。
 */
function fit(node: SVGSVGElement, zoom: number): void {
  const box = node.viewBox.baseVal

  if (box.width === 0 || box.height === 0) {
    return
  }

  node.removeAttribute('width')
  node.removeAttribute('height')
  node.style.maxWidth = 'none'
  node.style.width = `${Math.round(box.width * zoom)}px`
  node.style.height = `${Math.round(box.height * zoom)}px`
}

/* 画图这件事本身：一段源码进去，一个 svg 元素或者一句失败原因出来。 */
function useDiagramSvg(code: string, isIncomplete: boolean) {
  const seed = useId().replace(/[^a-z0-9]/gi, '')
  const pass = useRef(0)
  const [graphic, setGraphic] = useState<SVGSVGElement | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    /* 上一张还在画，下一段源码已经到了：迟到的那张不许再贴上去。 */
    let live = true

    if (!isIncomplete) {
      /*
       * 每画一次换一个 id。引擎拿它造一个临时节点、画完再按 id 把它摘掉，而画出来的那个
       * svg 自己也带着这个 id 一起交回来 —— id 复用意味着下一次渲染按 id 找到的是上一张
       * 图。上游同样每次现编一个并注明 to ensure uniqueness，HTML 也要求 id 文档内唯一。
       */
      pass.current += 1

      const id = `diagram-${seed}-${pass.current}`

      void diagramEngine()
        .then((instance) => instance.render(id, code))
        .then((drawn) => {
          /*
           * 解析失败时 DOMParser 不抛异常，它交回一份装着 parsererror 的文档（官方
           * DOMParser 的 Error handling 一节），所以这里问的是「有没有一个 svg 根」。
           */
          const parsed = new DOMParser().parseFromString(drawn.svg, 'image/svg+xml')
          const root = parsed.querySelector('svg')

          if (root === null) {
            throw new Error('引擎交回的不是一份可解析的 SVG')
          }

          if (live) {
            setFailure(undefined)
            setGraphic(root)
          }
        })
        .catch((cause: unknown) => {
          if (live) {
            setGraphic(undefined)
            setFailure(cause instanceof Error ? cause.message : String(cause))
          }
        })
    }

    return () => {
      live = false
    }
  }, [code, isIncomplete, seed])

  return { failure, graphic }
}

/*
 * 按住左键拖动 = 滚动这个容器。
 *
 * 舞台本身是 overflow: auto，触控板、触摸屏、滚轮因此天生就能推动它。上游那套是给内容加
 * transform: translate()，内容被挪出容器之后滚动条与内容对不上，还得在 wheel 里
 * preventDefault 把滚轮据为己有 —— 页面从此在图上滚不动。这里只补鼠标按住拖这一件事：
 * 指针事件 + setPointerCapture 是平台官方做法，指针滑出元素也不会丢。
 */
function useDragScroll() {
  const from = useRef<{ x: number; y: number } | null>(null)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    from.current = { x: event.clientX, y: event.clientY }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const last = from.current

    if (last === null) {
      return
    }

    event.currentTarget.scrollBy(last.x - event.clientX, last.y - event.clientY)
    from.current = { x: event.clientX, y: event.clientY }
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (from.current === null) {
      return
    }

    event.currentTarget.releasePointerCapture(event.pointerId)
    from.current = null
  }

  return { onPointerDown, onPointerMove, onPointerUp }
}

export interface DiagramProps {
  readonly code: string
  readonly isIncomplete: boolean
}

export function Diagram({ code, isIncomplete }: DiagramProps) {
  const { failure, graphic } = useDiagramSvg(code, isIncomplete)
  const drag = useDragScroll()
  const shown = useRef<SVGSVGElement | null>(null)
  const [asCode, setAsCode] = useState(false)
  const [zoom, setZoom] = useState(1)

  /*
   * 上屏走 ref 回调，不走 effect。
   *
   * effect 只在依赖变化时跑，而画布是否已经挂上去与依赖无关：上一版把画布放在一个条件
   * 分支里，节点晚一步出现，那一次 effect 拿到的就是 null，此后再没有人重试 —— 屏幕上那块
   * 什么都没有的面板就是这么来的。ref 回调由 React 在节点挂载的那一刻调用，数据先到还是
   * 节点先到都成立。这一片 DOM 归这个回调独有，所以它下面不放任何 React 子节点。
   */
  const mount = useCallback(
    (host: HTMLDivElement | null) => {
      if (host === null || graphic === undefined) {
        shown.current = null

        return
      }

      const node = host.ownerDocument.importNode(graphic, true)

      shown.current = node
      host.replaceChildren(node)
    },
    [graphic],
  )

  /* ref 先挂、effect 后跑，所以这里一定拿得到刚贴上去的那个节点。 */
  useEffect(() => {
    const node = shown.current

    if (node !== null) {
      fit(node, zoom)
    }
  }, [graphic, zoom])

  const showCode = asCode || graphic === undefined
  const Toggle = showCode ? PreviewIcon : CodeIcon
  const toggle = showCode ? '看图' : '看源码'

  return (
    <div className="timeline-prose__diagram" data-view={showCode ? 'code' : 'diagram'}>
      <div className="timeline-prose__diagram-tools">
        <CodeBlockCopyButton className="timeline-prose__diagram-tool" code={code} />
        <button
          aria-label={toggle}
          className="timeline-prose__diagram-tool"
          disabled={graphic === undefined}
          onClick={() => {
            setAsCode(!asCode)
          }}
          title={toggle}
          type="button"
        >
          <Toggle aria-hidden="true" />
        </button>
        {!showCode && (
          <>
            <span className="timeline-prose__diagram-split" />
            <button
              aria-label="缩小"
              className="timeline-prose__diagram-tool"
              disabled={zoom <= ZOOM_MIN}
              onClick={() => {
                setZoom(Math.max(ZOOM_MIN, zoom - ZOOM_STEP))
              }}
              title="缩小"
              type="button"
            >
              <ZoomOutIcon aria-hidden="true" />
            </button>
            <button
              aria-label="放大"
              className="timeline-prose__diagram-tool"
              disabled={zoom >= ZOOM_MAX}
              onClick={() => {
                setZoom(Math.min(ZOOM_MAX, zoom + ZOOM_STEP))
              }}
              title="放大"
              type="button"
            >
              <ZoomInIcon aria-hidden="true" />
            </button>
            <button
              aria-label="还原比例"
              className="timeline-prose__diagram-tool"
              disabled={zoom === 1}
              onClick={() => {
                setZoom(1)
              }}
              title="还原比例"
              type="button"
            >
              <ResetIcon aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      {failure !== undefined && (
        <p className="timeline-prose__diagram-alert">这段 mermaid 没能画出来：{failure}</p>
      )}
      <div
        className="timeline-prose__diagram-stage"
        onPointerCancel={drag.onPointerUp}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        ref={mount}
      />
      {showCode && (
        <CodeBlock code={code} isIncomplete={isIncomplete} language="mermaid" lineNumbers={false} />
      )}
    </div>
  )
}

/* 注册进 Streamdown 的 renderers：mermaid 围栏从此只走这一条路径。 */
export const DIAGRAM_RENDERER = { component: Diagram, language: 'mermaid' }
