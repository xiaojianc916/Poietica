import type { ToolCallTimelineItem } from '@poietica/agent-timeline'
import { readSubAgent, type SubAgentBrief } from '../domain/sub-agent'
import { toToolCallView } from '../domain/tool-call-content'
import { readToolIntent } from '../domain/tool-intent'
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
 * 那句话该写在卡片上，而不是只留在我们的记忆里。
 */
function emptyNoteOf(brief: SubAgentBrief | null, isRunning: boolean): string {
  if (!isRunning) {
    return '这次调用没有返回内容。'
  }

  return brief === null ? '还在运行，暂时没有输出。' : '子代理在自己那边干活，上游不回传它的过程。'
}

/**
 * 这张卡片此刻画得出东西吗。
 *
 * 不是「它跑完了吗」,也不是「它成功了吗」—— 是抽屉里现在有没有内容。自动展开该由
 * 这件事决定:上游对多数工具不回传过程（toolProgressToSessionUpdate 只把 status 文本
 * 拿去覆盖标题,stdout / stderr / progress 一概不发）,那些卡片运行期摊开的是一片空白。
 *
 * 而终端类恰恰相反:上游把 content 清空是因为输出走 terminal/* 反向 RPC,那是全场唯一
 * 有实时内容的一类。所以判据不能是「在跑就不给看」—— 那会把唯一值得看的那一类关掉。
 *
 * toToolCallView 按 content 数组做记忆化（VIEWS 那张 WeakMap）,所以这里重算一次不额外
 * 花钱;条件与抽屉里那两个分支读的是同一份东西,不会出现「开了但里面什么都没有」。
 */
function revealsProgress(item: ToolCallTimelineItem): boolean {
  if (toToolCallView(item.content).parts.length > 0) {
    return true
  }

  const brief = readSubAgent(item.rawInput)

  return brief !== null && brief.task.length > 0
}

/**
 * One tool call, from the moment it is announced to the moment it settles.
 *
 * The title is the agent's own words and changes as work proceeds — Kimi sends
 * "Read" and then "Reading README.md" — so it is displayed rather than
 * reconstructed from the arguments.
 *
 * 运行时展开，落定后收起 —— 和思考链同一个抽屉、同一条判据，因为两者是同一
 * 种东西：过程。过程值得看，结果不值得摊着。人点过一次之后以人为准。
 *
 * 抽屉：内容常驻挂载，0fr 与 1fr 之间一次跳变，收起时 inert。不补间 —— 这一行
 * 挂着虚拟器的 measureElement，补间高度就是每帧让它下面所有行重排一次。
 */
export function ToolCallCard({
  isInFlight,
  item,
}: {
  readonly isInFlight: boolean
  readonly item: ToolCallTimelineItem
}) {
  /*
   * 这次调用是否还在飞。纺锤和抽屉都读它，因为它们问的是同一件事。
   *
   * 两个条件缺一不可：这一轮还在跑，并且这次调用还没有收到终态。后半句单独
   * 用不得 —— status 是 agent 说过的话，一次没等到终态的调用会永远停在
   * in_progress，于是那张卡片在一轮早就结束之后还在转。reducer 此前用「结束
   * 时把它盖成 failed」来止转，那是拿一句谎话换一个动画。轮次是否还在飞由
   * 读模型说。
   *
   * 这也就是「异常结束」在这里的准确定义：轮次一停，无论这张卡片最后一句话
   * 是什么 —— 报错、被取消、或者干脆没有下文 —— 它都不再是活的。停住的那种
   * 既不转也不报错：安静地待在那里就是它最准确的样子。
   */
  const isRunning = isInFlight && (item.status === 'pending' || item.status === 'in_progress')

  /*
   * 展开与否问的是「它还在跑吗」，不是「它跑成了什么」。
   *
   * 此前这里传的是 item.status === 'failed'，判据落在结果轴上，于是两头都错：
   * 正在跑的调用是收起的 —— 唯一有实时信息的那一段被藏起来；失败的调用则永远
   * 摊开 —— 一句 not found、一句 aborted，此后每次回看这条对话它们都还摊在那
   * 里，而它们恰恰是最不值得占版面的内容。
   *
   * 思考链传的是 isStreaming，这里传 isRunning：同一个 useDisclosure、同一个
   * DisclosureBody、同一个轴。
   *
   * 活着而且真有东西可看才开着，落定就收起，异常落定也是落定。上游对多数工具不
   * 回传过程，一张空抽屉自动摊开只是占版面 —— 但按钮不锁：想看的人点开会看到那句
   * 诚实的话，那不是空白，是信息。人点过之后不再自动动：override
   * 一旦落下就压过这个默认值，那是 useDisclosure 的语义，不在这里重述第二遍。
   *
   * 失败不再自动摊开。理由不是不重要，是它不该由一张永久展开的卡片来承担：
   * 标题栏上那枚失败图标是常驻记号，点开才是一次动作 —— Claude Code、Cursor、
   * Zed 的工具卡片都是这么收的。
   */
  const { isOpen, toggle } = useDisclosure(isRunning && revealsProgress(item))
  /* content 里装的已经是产出：入参回显在投影层就没进来（acp-projection）。 */
  const { diffStat, parts } = toToolCallView(item.content)

  /*
   * 这次调用是不是一次子代理派发。
   *
   * 从 rawInput 现读，不进 TimelineState：它只是入参的函数，而 TimelineState 的
   * 条目引用相等是 feed 的 sharedPrefix 赖以成立的前提，往里加一格派生字段就是
   * 拿一次全表重画去换一个算得出来的东西。
   */
  const brief = readSubAgent(item.rawInput)

  /*
   * 子代理已经把自己的意图写在标题上了（brief.label），不再叠第二句。
   * 别的工具没有这个待遇：它们的标题只有一个工具名。
   */
  const intent = brief === null ? readToolIntent(item) : null

  return (
    <Surface
      as="section"
      className="timeline-tool"
      data-open={isOpen ? 'true' : undefined}
      data-status={item.status}
    >
      <button
        aria-expanded={isOpen}
        className="timeline-tool__header"
        onClick={toggle}
        type="button"
      >
        {/*
         * 子代理不是一种 ACP 工具类别 —— AcpToolKind 里没有它，所以这一格的分流
         * 在组件层，不在 ToolKindIcon 的 switch 里：那个 switch 认的是协议枚举，
         * 往里塞一个协议不认识的值，它就不再是协议的投影了。
         */}
        {brief === null ? (
          <ToolKindIcon kind={item.kind} />
        ) : (
          <ModelIcon aria-hidden="true" className="timeline-tool__icon" />
        )}

        {/*
         * 标题优先用派发本身。
         *
         * item.title 是 agent 自己的话，通常就一个工具名（Agent）—— 对别的工具
         * 够用，对这一种不够：一屏平行的子代理会得到一屏一模一样的标题。派了哪
         * 一种、干什么，上游在入参里已经说了。
         */}
        <span className="timeline-tool__title" title={brief?.gist}>
          {brief === null ? item.title : brief.label}
        </span>

        {/*
         * 工具名让位，意图占主位。
         *
         * 名字不删：它是 agent 自己的话，而且会随进展变（Kimi 送过 Read，也送过
         * Reading README.md）。但一屏的 Bash、Glob、Read 之间没有区别，真正把这次
         * 调用和那次调用分开的是它要做什么。长了单行截断，全文进悬浮提示 —— 标题栏
         * 不做展开：那是抽屉的事，一行里再藏一个开关就是两个开关。
         */}
        {intent === null ? null : (
          <span className="timeline-tool__intent" title={intent.full}>
            {intent.text}
          </span>
        )}

        {brief?.isBackground === true ? (
          <span className="timeline-tool__background">后台</span>
        ) : null}

        {diffStat === null || diffStat.added + diffStat.removed === 0 ? null : (
          <span className="timeline-tool__diffstat">
            {diffStat.added > 0 ? (
              <span className="timeline-tool__diffstat-added">+{diffStat.added}</span>
            ) : null}
            {diffStat.removed > 0 ? (
              <span className="timeline-tool__diffstat-removed">-{diffStat.removed}</span>
            ) : null}
          </span>
        )}

        <ToolDuration isRunning={isRunning} item={item} />

        {isRunning ? <SpinnerIcon aria-hidden="true" className="timeline-tool__spinner" /> : null}

        {/*
         * 结束状态只画，不说。
         *
         * 成功不需要一行「已完成」：卡片在那儿、纺锤停了，就是完成了。运行中
         * 也不需要「执行中」：纺锤正在转。四种状态里只有失败带着新消息，所以
         * 它是唯一留下的记号 —— 一个图标，不染色（原因由展开之后的内容负责
         * 说清楚），带 aria-label，读屏仍然听得到。
         */}
        {item.status === 'failed' ? (
          <FailureIcon aria-label="失败" className="timeline-tool__failed" role="img" />
        ) : null}

        <ChevronDownIcon
          aria-hidden="true"
          className="timeline-tool__chevron disclosure__chevron"
        />
      </button>

      <DisclosureBody isOpen={isOpen}>
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

          {/*
           * 子代理的抽屉里放它领到的任务书。
           *
           * 标一行「派给它的」是因为这确实不是产出 —— 它的过程上游不回传，所以在
           * 结果回来之前，这张卡片能诚实交出的最有价值的东西就是这段任务书本身。
           * 有产出之后就让位：那时 parts 不空。
           */}
          {brief !== null && parts.length === 0 && brief.task.length > 0 ? (
            <div className="timeline-tool__task">
              <p className="timeline-tool__task-label">派给它的</p>
              <p className="timeline-tool__task-text">{brief.task}</p>
            </div>
          ) : null}

          {parts.length === 0 && (brief === null || brief.task.length === 0) ? (
            <p className="timeline-tool__empty">{emptyNoteOf(brief, isRunning)}</p>
          ) : null}

          {parts.map((part, index) => {
            const key = `${part.type}:${String(index)}`

            /*
             * 工具返回的正文和回答是同一种东西：一段 markdown。所以它走同一个
             * 组件，而不是一个只会原样倒字符串的 <pre> —— 计划模式产出的整份
             * 文档此前正是因此以 # 与 | 的原文出现在卡片里。
             *
             * 命令输出不受影响：协议把终端单列为一种 part，不走这条分支。
             * 这里的内容已经落定，所以流式修补与增量揭示都关掉。
             */
            if (part.type === 'text') {
              return (
                <Prose
                  className="timeline-tool__prose"
                  isStreaming={false}
                  key={key}
                  text={part.text}
                />
              )
            }

            if (part.type === 'diff') {
              return (
                <div className="timeline-tool__diff" key={key}>
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
              return (
                <p className="timeline-tool__terminal" key={key}>
                  终端 {part.terminalId}
                </p>
              )
            }

            return (
              <p className="timeline-tool__opaque" key={key}>
                {part.label}
              </p>
            )
          })}
        </div>
      </DisclosureBody>
    </Surface>
  )
}
