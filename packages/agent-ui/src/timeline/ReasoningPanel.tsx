import { DisclosureBody, useDisclosure } from '../primitives/disclosure'
import { ChevronDownIcon, ThinkingIcon } from '../primitives/icons'
import { Prose } from './Prose'
import { useStickToBottom } from './use-stick-to-bottom'

export interface ReasoningPanelProps {
  readonly text: string
  readonly isStreaming: boolean
}

/**
 * The thought chain.
 *
 * Not a card: a card would give a passing remark the same weight as an answer.
 * One quiet line that can be opened, and the thinking underneath it — rendered
 * by the same pipeline as the answer, because it is the same kind of content.
 *
 * 挂载时正在思考，它就是展开的；此后归读者。
 *
 * 此前这个默认值每帧派生：思考一结束面板自己收起 —— 没有人点过它，行高却突降
 * 一截，而这一行挂着虚拟器的 measureElement。理由写在 useDisclosure。
 *
 * The prose is always mounted: unmounting it is why the panel used to snap
 * open, as there is nothing to animate between a node and no node. It lives in
 * a grid row that travels between 0fr and 1fr, the one way an intrinsic height
 * animates without being measured in script. Closed, the row is inert, so its
 * content is out of reach of the keyboard and of a screen reader.
 *
 * A long chain scrolls within a capped box rather than pushing the answer down
 * the page. The cap is a maximum, so a short chain has no scroller and no
 * scrollbar at all.
 *
 * 这个盒子此前没有任何人拥有它的滚动位置 —— 唯一碰它的 use-scroll-fade 只读不写。
 * 于是思考一越过上限，新到的字就在视口外面继续长，读者盯着的是一段已经过去的话。
 * 贴底跟随因此不是一个装饰，是这个盒子缺的那个所有者；判据与转录那一层同一套：
 * 内容长高时若人还贴在末端就跟随，人往上滚就放手，滚回末端就重新接管。
 */
export function ReasoningPanel({ isStreaming, text }: ReasoningPanelProps) {
  const { isOpen, toggle } = useDisclosure(isStreaming)
  const viewportRef = useStickToBottom()

  return (
    <div className="timeline-reasoning" data-open={isOpen ? 'true' : undefined}>
      <button
        aria-expanded={isOpen}
        className="timeline-reasoning__toggle"
        onClick={toggle}
        type="button"
      >
        <ThinkingIcon aria-hidden="true" className="timeline-reasoning__mark" />

        <span className="timeline-reasoning__label">{isStreaming ? '正在思考' : '思考完毕'}</span>

        <ChevronDownIcon aria-hidden="true" className="timeline-reasoning__chevron" />
      </button>

      <DisclosureBody block="timeline-reasoning" isOpen={isOpen}>
        <div className="timeline-reasoning__scroll" ref={viewportRef}>
          <Prose className="timeline-reasoning__body" isStreaming={isStreaming} text={text} />
        </div>
      </DisclosureBody>
    </div>
  )
}
