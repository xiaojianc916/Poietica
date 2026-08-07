import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { useCopy } from '../primitives/use-copy'

/*
 * 一张图，一块面板。
 *
 * mermaid 围栏由这里接管：上游的 useCustomRenderer 在它自带的 mermaid 分支之前先问
 * plugins.renderers，注册了这一条之后，那套「外层卡片 + 一行 mermaid 标签 + 悬在渲染区
 * 上方的按钮 + 内层卡片」不再有机会出现。面板长什么样归 timeline.css，与代码块、表格
 * 同一处。
 *
 * isIncomplete 由上游给：流式进行中、且这是最后一块、且围栏尚未闭合。「写完了没有」因此
 * 按围栏计，不按整条消息计 —— 官方 Streaming Considerations 一节给的正是这条路径。围栏
 * 一闭合，这张图当场画出来，后面的字继续流。
 */

type Engine = ReturnType<typeof import('@streamdown/mermaid')['mermaid']['getMermaid']>

/*
 * 引擎的配置只说一次：getMermaid 初始化的是模块级单例，两份配置轮流生效意味着同一段
 * 源码画出两种样子。
 *
 * theme neutral 是灰阶，与这块面板同一个语气；fontFamily 交给 inherit，图里的中文标签
 * 因此和界面同一套字形，而不是落到 monospace 的兜底字体上。securityLevel strict 让标签
 * 里的 HTML 不被执行，suppressErrorRendering 让渲染失败不要往文档上挂一张官方错误图 ——
 * 失败该说什么，由下面那个状态决定。
 */
const CONFIG = {
  fontFamily: 'inherit',
  securityLevel: 'strict',
  startOnLoad: false,
  suppressErrorRendering: true,
  theme: 'neutral',
} as const

/*
 * 布局引擎按需取，取回来的整个进程共用一台：它在首屏那个 chunk 里是纯负担，一条一张图
 * 都没有的会话也要在窗口呈现之前解析完它。动态 import 是 ESM 与打包器官方的代码分割形态。
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

/* 全屏被拒（没有用户手势、被策略挡住）不该是一件悄无声息的事。 */
function reportFullscreen(cause: unknown): void {
  console.error('[Poietica] Fullscreen request rejected', cause)
}

export interface DiagramProps {
  readonly code: string
  readonly isIncomplete: boolean
}

export function Diagram({ code, isIncomplete }: DiagramProps) {
  /* 引擎拿这个 id 去选中它自己刚插进文档的那个节点，所以它必须能直接拼进选择器。 */
  const id = `diagram-${useId().replace(/[^a-z0-9]/gi, '')}`
  const panel = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [asCode, setAsCode] = useState(false)
  const [full, setFull] = useState(false)
  const { copied, copy } = useCopy(code)

  useEffect(() => {
    /* 上一张还在画，下一段源码已经到了：迟到的那张不许再贴上去。 */
    let live = true

    if (!isIncomplete) {
      void diagramEngine()
        .then((instance) => instance.render(id, code))
        .then((drawn) => {
          if (live) {
            setFailure(undefined)
            setSvg(drawn.svg)
          }
        })
        .catch((cause: unknown) => {
          if (live) {
            setSvg(undefined)
            setFailure(cause instanceof Error ? cause.message : String(cause))
          }
        })
    }

    return () => {
      live = false
    }
  }, [code, id, isIncomplete])

  useEffect(() => {
    const host = canvas.current

    if (host === null || svg === undefined) {
      return
    }

    /*
     * 引擎交出来的是一段 SVG 源码。DOMParser 按 SVG 命名空间解析它，importNode 把结果
     * 搬进本文档 —— 这一片 DOM 归这个 effect 所有，所以它下面不放任何 React 子节点。
     */
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')

    host.replaceChildren(host.ownerDocument.importNode(parsed.documentElement, true))
  }, [svg])

  /* 全不全屏的真相在 document 上，这里只是把它的事件抄成一次重画。 */
  useEffect(() => {
    const sync = () => {
      setFull(document.fullscreenElement === panel.current)
    }

    document.addEventListener('fullscreenchange', sync)

    return () => {
      document.removeEventListener('fullscreenchange', sync)
    }
  }, [])

  const toggleFull = useCallback(() => {
    const element = panel.current

    if (element === null) {
      return
    }

    if (document.fullscreenElement === element) {
      void document.exitFullscreen().catch(reportFullscreen)

      return
    }

    void element.requestFullscreen().catch(reportFullscreen)
  }, [])

  const showCode = asCode || svg === undefined

  return (
    <div className="timeline-prose__diagram" ref={panel}>
      <div className="timeline-prose__diagram-tools">
        <button className="timeline-prose__diagram-tool" onClick={copy} type="button">
          {copied ? '已复制' : '复制'}
        </button>
        <button
          className="timeline-prose__diagram-tool"
          disabled={svg === undefined}
          onClick={() => {
            setAsCode(!asCode)
          }}
          type="button"
        >
          {showCode ? '预览' : '代码'}
        </button>
        <button className="timeline-prose__diagram-tool" onClick={toggleFull} type="button">
          {full ? '退出全屏' : '全屏'}
        </button>
      </div>
      {failure !== undefined && <p className="timeline-prose__diagram-alert">{failure}</p>}
      {showCode ? (
        <pre className="timeline-prose__diagram-code">{code}</pre>
      ) : (
        <div className="timeline-prose__diagram-view" ref={canvas} />
      )}
    </div>
  )
}

/* 语言 mermaid 的唯一渲染者。 */
export const DIAGRAM_RENDERER = { component: Diagram, language: 'mermaid' }
