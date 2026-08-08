import type { ToolCallTimelineItem } from '@poietica/agent'
import { DisclosureBody, useDisclosure } from '../primitives/disclosure'
import {
  ChevronDownIcon,
  FailureIcon,
  FileIcon,
  GlobeIcon,
  ModelIcon,
  PencilIcon,
  SearchIcon,
  SpinnerIcon,
  ToolIcon,
} from '../primitives/icons'
import { Surface } from '../primitives/surface'
import { type ToolCallFacets, toToolCallFacets } from '../semantics/tool-call-facets'
import { readToolIntent, type ToolIntent } from '../semantics/tool-intent'
import { ToolCallPanels } from './tool-call-panels'
import { ToolDuration } from './tool-duration'

function ToolKindIcon({ kind }: { readonly kind: ToolCallTimelineItem['kind'] }) {
  const className = 'timeline-tool__icon'

  switch (kind) {
    case 'edit':
      return <PencilIcon aria-hidden="true" className={className} />
    case 'delete':
    case 'move':
      return <FileIcon aria-hidden="true" className={className} />
    case 'read':
    case 'search':
      return <SearchIcon aria-hidden="true" className={className} />
    case 'fetch':
      return <GlobeIcon aria-hidden="true" className={className} />
    case 'think':
      return <ModelIcon aria-hidden="true" className={className} />
    default:
      return <ToolIcon aria-hidden="true" className={className} />
  }
}

/**
 * 这张卡片此刻是什么样子 —— 一次算完，渲染器只读不算。
 *
 * 抽屉里的两个面由投影层交回来（toToolCallFacets），这一层只做属于卡片自己的三件
 * 派生：意图那一行、跑没跑完、抽屉默不默认开着。此前这里还要自己拼任务书、自己挑
 * 那句空话 —— 那两件事都是「抽屉里怎么画」，已经跟着一起搬走了。
 */
interface ToolCallCardView {
  readonly facets: ToolCallFacets
  /** 子代理已把意图写在标题上，所以它那一路不叠第二句。 */
  readonly intent: ToolIntent | null
  readonly isRunning: boolean
  /** 活着而且真有东西可看才默认开着。人点过之后以人为准（useDisclosure 的语义）。 */
  readonly opensByDefault: boolean
}

/*
 * isRunning 的两个条件缺一不可：这一轮还在跑，并且这次调用还没有收到终态。后半句
 * 单独用不得 —— status 是 agent 说过的话，一次没等到终态的调用会永远停在
 * in_progress，那张卡片会在一轮早就结束之后还在转。轮次是否还在飞由读模型说。
 *
 * 开合判据落在「它还在跑吗」，不落在「它跑成了什么」：上游对多数工具不回传过程，而
 * 终端类的实时输出走 terminal/* 反向 RPC —— 用结果轴当判据，两头都会错。入参现在也
 * 算「有东西可看」：运行中它往往是唯一到齐的那一份。失败不自动摊开，标题栏那枚失败
 * 图标是常驻记号，点开才是一次动作。
 */
function describeToolCall(item: ToolCallTimelineItem, isInFlight: boolean): ToolCallCardView {
  const facets = toToolCallFacets(item)
  const isRunning = isInFlight && (item.status === 'pending' || item.status === 'in_progress')

  return {
    facets,
    intent: facets.brief === null ? readToolIntent(item) : null,
    isRunning,
    opensByDefault: isRunning && (facets.response !== null || facets.request !== null),
  }
}

/** 加减了多少行。两边都是零就不占位。 */
function ToolCallDiffStat({ diffStat }: { readonly diffStat: ToolCallFacets['diffStat'] }) {
  if (diffStat === null || diffStat.added + diffStat.removed === 0) {
    return null
  }

  return (
    <span className="timeline-tool__diffstat">
      {diffStat.added > 0 ? (
        <span className="timeline-tool__diffstat-added">+{diffStat.added}</span>
      ) : null}
      {diffStat.removed > 0 ? (
        <span className="timeline-tool__diffstat-removed">-{diffStat.removed}</span>
      ) : null}
    </span>
  )
}

/**
 * 标题栏。整行是一个按钮，所以这一层不放第二个开关。
 *
 * 标题那一格只有一句话。入参带 description 时印它，否则印 item.title（agent 自己
 * 的话，Kimi 送过 Read，也送过 Reading README.md）。不并排 —— 两者说的是同一次调用
 * 的两个层次，而类别那一层左边的图标已经在说了。
 *
 * 子代理不是一种 ACP 工具类别（AcpToolKind 里没有它），所以图标那一格的分流在
 * 这一层，不在 ToolKindIcon 的 switch 里：那个 switch 认的是协议枚举。
 *
 * 结束状态只画不说：成功不需要一行「已完成」，运行中不需要「执行中」（纺锤正在
 * 转）。四种状态里只有失败带着新消息，所以它是唯一留下的记号 —— 一个图标，不
 * 染色，带 aria-label，读屏仍然听得到。
 */
function ToolCallHeader({
  isOpen,
  item,
  onToggle,
  view,
}: {
  readonly isOpen: boolean
  readonly item: ToolCallTimelineItem
  readonly onToggle: () => void
  readonly view: ToolCallCardView
}) {
  const { facets, intent, isRunning } = view
  const { brief, diffStat } = facets

  return (
    <button
      aria-expanded={isOpen}
      className="timeline-tool__header"
      onClick={onToggle}
      type="button"
    >
      {brief === null ? (
        <ToolKindIcon kind={item.kind} />
      ) : (
        <ModelIcon aria-hidden="true" className="timeline-tool__icon" />
      )}

      {/*
       * 意图在就只印意图：一屏的 Bash、Glob、Read 之间没有区别，真正把这次调用和那次
       * 调用分开的是它要做什么。工具名不再跟着一起印 —— 它是类别，而类别归左边那枚
       * 图标。长了单行截断，全文进悬浮提示。
       */}
      {intent === null ? (
        <span className="timeline-tool__title" title={brief?.gist}>
          {brief === null ? item.title : brief.label}
        </span>
      ) : (
        <span className="timeline-tool__intent" title={intent.full}>
          {intent.text}
        </span>
      )}

      {brief?.isBackground === true ? (
        <span className="timeline-tool__background">后台</span>
      ) : null}

      <ToolCallDiffStat diffStat={diffStat} />

      <ToolDuration isRunning={isRunning} item={item} />

      {isRunning ? <SpinnerIcon aria-hidden="true" className="timeline-tool__spinner" /> : null}

      {item.status === 'failed' ? (
        <FailureIcon aria-label="失败" className="timeline-tool__failed" role="img" />
      ) : null}

      <ChevronDownIcon aria-hidden="true" className="timeline-tool__chevron disclosure__chevron" />
    </button>
  )
}

/**
 * One tool call, from the moment it is announced to the moment it settles.
 *
 * The title is the agent's own words and changes as work proceeds — Kimi sends
 * "Read" and then "Reading README.md" — so it is displayed rather than
 * reconstructed from the arguments.
 *
 * 运行时展开，落定后收起 —— 和思考链同一个抽屉、同一条判据，因为两者是同一种
 * 东西：过程。过程值得看，结果不值得摊着。人点过一次之后以人为准。
 *
 * 抽屉：内容常驻挂载，0fr 与 1fr 之间一次跳变，收起时 inert。不补间 —— 这一行
 * 挂着虚拟器的 measureElement，补间高度就是每帧让它下面所有行重排一次。
 *
 * 这个函数不再自己派生、也不再自己排版：一次投影、两个渲染器。它也不包 memo ——
 * 唯一的调用点 TimelineRow 已经按 row 记忆化，再包一层只是多一次比较。
 */
export function ToolCallCard({
  isInFlight,
  item,
}: {
  readonly isInFlight: boolean
  readonly item: ToolCallTimelineItem
}) {
  const view = describeToolCall(item, isInFlight)
  const { isOpen, toggle } = useDisclosure(view.opensByDefault)

  return (
    <Surface
      as="section"
      className="timeline-tool"
      data-open={isOpen ? 'true' : undefined}
      data-status={item.status}
    >
      <ToolCallHeader isOpen={isOpen} item={item} onToggle={toggle} view={view} />

      <DisclosureBody isOpen={isOpen}>
        <ToolCallPanels facets={view.facets} isRunning={view.isRunning} />
      </DisclosureBody>
    </Surface>
  )
}
