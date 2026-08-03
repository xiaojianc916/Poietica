import type { ToolCallTimelineItem } from '@poietica/agent-timeline'
import { toToolCallView } from '../domain/tool-call-content'
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
   * 活着就开着，落定就收起，异常落定也是落定。人点过之后不再自动动：override
   * 一旦落下就压过这个默认值，那是 useDisclosure 的语义，不在这里重述第二遍。
   *
   * 失败不再自动摊开。理由不是不重要，是它不该由一张永久展开的卡片来承担：
   * 标题栏上那枚失败图标是常驻记号，点开才是一次动作 —— Claude Code、Cursor、
   * Zed 的工具卡片都是这么收的。
   */
  const { isOpen, toggle } = useDisclosure(isRunning)
  const { diffStat, parts } = toToolCallView(item.content)

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
        <ToolKindIcon kind={item.kind} />

        <span className="timeline-tool__title">{item.title}</span>

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

        <ChevronDownIcon aria-hidden="true" className="timeline-tool__chevron" />
      </button>

      <DisclosureBody block="timeline-tool" isOpen={isOpen}>
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

          {parts.length === 0 ? (
            <p className="timeline-tool__empty">这次调用没有返回内容。</p>
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
