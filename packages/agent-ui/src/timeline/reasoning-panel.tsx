import { useRef } from 'react'

import { DisclosureBody, useDisclosure } from '../primitives/disclosure'
import { ChevronDownIcon, ThinkingIcon } from '../primitives/icons'
import { VirtualProse } from './virtual-prose'

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
 * 正在思考时展开，思考完毕收起；人点过一次之后以人为准。判据与工具卡片同一个，
 * 语义写在 useDisclosure。
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
 * 而「内容量无上限、只有一个窗口可见」的那一半已经不在这个文件里了。它此前整台机器
 * 长在这里 —— 切分、估高、末端锚定、设备像素对齐 —— 而工具抽屉里的载荷是同一种场景。
 * 一个问题一个答案：那台机器搬进 VirtualProse，这里只剩下属于思考链自己的三件事：
 * 什么时候展开、盒子长什么样、以及「边写边打开时先看最新一行」。
 */
export function ReasoningPanel({ isStreaming, text }: ReasoningPanelProps) {
  const { isOpen, toggle } = useDisclosure(isStreaming)

  /* 滚动容器归这一层：那个盒子的上限、滚动条与锚定策略都写在它自己的类里。 */
  const scrollRef = useRef<HTMLDivElement | null>(null)

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

        <ChevronDownIcon
          aria-hidden="true"
          className="timeline-reasoning__chevron disclosure__chevron"
        />
      </button>

      <DisclosureBody isOpen={isOpen}>
        <div className="timeline-reasoning__scroll" ref={scrollRef}>
          <VirtualProse
            bodyClassName="timeline-reasoning__body"
            chaseEnd={isOpen && isStreaming}
            isStreaming={isStreaming}
            scrollRef={scrollRef}
            text={text}
          />
        </div>
      </DisclosureBody>
    </div>
  )
}
