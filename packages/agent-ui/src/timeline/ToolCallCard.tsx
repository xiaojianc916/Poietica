import type { ToolCallTimelineItem } from '@poietica/agent-timeline'
import { readSubAgent, type SubAgentBrief } from '../domain/sub-agent'
import { toToolCallView } from '../domain/tool-call-content'
import { readToolIntent, type ToolIntent } from '../domain/tool-intent'
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
import { Prose } from './Prose'
import { ToolDuration } from './ToolDuration'

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

/*
 * 抽屉里空着，原因有三种，而此前只说了一种。
 *
 * 「没有返回内容」对一个还在跑的调用是假的：它不是没返回，是还没返回。子代理这
 * 一路更进一步 —— 它整段运行期都是空的，而且空得有原因：上游不回传子代理的过程。
 */
function emptyNoteOf(brief: SubAgentBrief | null, isRunning: boolean): string {
  if (!isRunning) {
    return '这次调用没有返回内容。'
  }

  return brief === null ? '还在运行，暂时没有输出。' : '子代理在自己那边干活，上游不回传它的过程。'
}

type ToolCallContentView = ReturnType<typeof toToolCallView>
type ToolCallPartView = ToolCallContentView['parts'][number]

/**
 * 这张卡片此刻是什么样子 —— 一次算完，渲染器只读不算。
 *
 * 派生集中在这里，不是为了分层好看，是因为它们互相咬着：抽屉的默认开合、任务书
 * 要不要出现、那句空话说哪一种，三者读的是同一组事实。此前它们分散在三处各自重算
 * （revealsProgress 一处、抽屉里两处），一致性靠一句「不会出现开了但里面什么都没有」
 * 的注释担保；现在由构造担保。
 *
 * 顺带去掉一次白跑：revealsProgress 里调过 readSubAgent，组件体里又调一遍。
 * toToolCallView 有 WeakMap 记忆化（原注释说的是它），readSubAgent 没有 —— 它每次
 * 都要 Reflect.get 四次、trim 三次，并对整段 prompt 做一次正则切分。
 */
interface ToolCallCardView {
  /** 这次派发的任务书概要；不是子代理派发就是 null。 */
  readonly brief: SubAgentBrief | null
  readonly diffStat: ToolCallContentView['diffStat']
  /** 抽屉里那句诚实的话；有东西可画时是 null。 */
  readonly emptyNote: string | null
  /** 子代理已把意图写在标题上，所以它那一路不叠第二句。 */
  readonly intent: ToolIntent | null
  readonly isRunning: boolean
  /** 活着而且真有东西可看才默认开着。人点过之后以人为准（useDisclosure 的语义）。 */
  readonly opensByDefault: boolean
  readonly parts: ToolCallContentView['parts']
  /** 抽屉里画的任务书；有产出之后让位。 */
  readonly task: string | null
}

/*
 * isRunning 的两个条件缺一不可：这一轮还在跑，并且这次调用还没有收到终态。
 * 后半句单独用不得 —— status 是 agent 说过的话，一次没等到终态的调用会永远停在
 * in_progress，那张卡片会在一轮早就结束之后还在转。轮次是否还在飞由读模型说。
 *
 * 开合判据落在「它还在跑吗」，不落在「它跑成了什么」：上游对多数工具不回传过程，
 * 而终端类的实时输出走 terminal/* 反向 RPC —— 用结果轴当判据，两头都会错。
 * 失败不自动摊开：标题栏那枚失败图标是常驻记号，点开才是一次动作。
 */
function describeToolCall(item: ToolCallTimelineItem, isInFlight: boolean): ToolCallCardView {
  const { diffStat, parts } = toToolCallView(item.content)
  const brief = readSubAgent(item.rawInput)
  const isRunning = isInFlight && (item.status === 'pending' || item.status === 'in_progress')
  const task = brief !== null && parts.length === 0 && brief.task.length > 0 ? brief.task : null

  return {
    brief,
    diffStat,
    emptyNote: parts.length === 0 && task === null ? emptyNoteOf(brief, isRunning) : null,
    intent: brief === null ? readToolIntent(item) : null,
    isRunning,
    opensByDefault: isRunning && (parts.length > 0 || task !== null),
    parts,
    task,
  }
}

/**
 * 抽屉里的一段产出，一格一个组件。
 *
 * 种类分流属于「一段产出怎么画」，不属于「这张卡片怎么排」。种类从投影层的返回值上
 * 取，不另立一份类型：那份联合是 toToolCallView 的产出。key 由调用方给。
 */
function ToolCallPart({ part }: { readonly part: ToolCallPartView }) {
  /*
   * 工具返回的正文和回答是同一种东西：一段 markdown。所以它走同一个组件，而不是
   * 一个只会原样倒字符串的 <pre> —— 计划模式产出的整份文档此前正是因此以 # 与 |
   * 的原文出现在卡片里。命令输出不受影响：协议把终端单列为一种 part。
   * 这里的内容已经落定，所以流式修补与增量揭示都关掉。
   */
  if (part.type === 'text') {
    return <Prose className="timeline-tool__prose" isStreaming={false} text={part.text} />
  }

  if (part.type === 'diff') {
    return (
      <div className="timeline-tool__diff">
        <p className="timeline-tool__diff-path">{part.path}</p>
        {part.oldText === null ? (
          <p className="timeline-tool__diff-note">新建文件</p>
        ) : (
          <pre className="timeline-tool__diff-old">{part.oldText}</pre>
        )}
        <pre className="timeline-tool__diff-new">{part.newText}</pre>
      </div>
    )
  }

  if (part.type === 'terminal') {
    return <p className="timeline-tool__terminal">终端 {part.terminalId}</p>
  }

  return <p className="timeline-tool__opaque">{part.label}</p>
}

/** 加减了多少行。两边都是零就不占位。 */
function ToolCallDiffStat({ diffStat }: { readonly diffStat: ToolCallContentView['diffStat'] }) {
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
 * 标题优先用派发本身：item.title 是 agent 自己的话（Kimi 送过 Read，也送过
 * Reading README.md），对别的工具够用，对子代理不够 —— 一屏平行的子代理会得到
 * 一屏一模一样的标题。
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
  const { brief, diffStat, intent, isRunning } = view

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

      <span className="timeline-tool__title" title={brief?.gist}>
        {brief === null ? item.title : brief.label}
      </span>

      {/*
       * 工具名让位，意图占主位：一屏的 Bash、Glob、Read 之间没有区别，真正把这次
       * 调用和那次调用分开的是它要做什么。长了单行截断，全文进悬浮提示。
       */}
      {intent === null ? null : (
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
 * 抽屉里的内容。
 *
 * 子代理的抽屉里放它领到的任务书：那确实不是产出 —— 它的过程上游不回传，所以在
 * 结果回来之前，这张卡片能诚实交出的最有价值的东西就是这段任务书本身。
 *
 * parts 的 key 用下标：投影是 content 数组的纯函数，顺序即协议顺序，不重排也不
 * 中间插入，而每个渲染器都没有自己的状态。
 */
function ToolCallBody({
  item,
  view,
}: {
  readonly item: ToolCallTimelineItem
  readonly view: ToolCallCardView
}) {
  const { emptyNote, parts, task } = view

  return (
    <div className="timeline-tool__body">
      {item.locations.length > 0 ? (
        <ul className="timeline-tool__locations">
          {item.locations.map((location) => (
            <li className="timeline-tool__location" key={location.path}>
              {location.path}
              {location.line === undefined ? null : `:${String(location.line)}`}
            </li>
          ))}
        </ul>
      ) : null}

      {task === null ? null : (
        <div className="timeline-tool__task">
          <p className="timeline-tool__task-label">派给它的</p>
          <p className="timeline-tool__task-text">{task}</p>
        </div>
      )}

      {emptyNote === null ? null : <p className="timeline-tool__empty">{emptyNote}</p>}

      {parts.map((part, index) => (
        <ToolCallPart key={`${part.type}:${String(index)}`} part={part} />
      ))}
    </div>
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
        <ToolCallBody item={item} view={view} />
      </DisclosureBody>
    </Surface>
  )
}
