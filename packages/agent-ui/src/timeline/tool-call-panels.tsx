import { useId, useRef, useState } from 'react'

import { panelId, TabList, type TabOption, tabId } from '../primitives/tabs'
import type { SubAgentBrief } from '../semantics/sub-agent'
import type { ToolCallFacets } from '../semantics/tool-call-facets'
import { VirtualProse } from './virtual-prose'

/**
 * 抽屉里的两个面：左边是我们送出去的，右边是它交回来的。
 *
 * 一个面就是一段 markdown —— 投影层已经把参数、路径、diff、回执全部拼好了。这一层
 * 因此不再有四路 switch、不再有 diff 两栏、不再有一张裸 ul。
 *
 * 面板是抽屉里唯一的滚动容器，也是虚拟窗口量高度的那个盒子。它归这一层，不归
 * VirtualProse —— 因为只有这一层知道它此刻是不是一个 tabpanel。
 */

const REQUEST = 'request'
const RESPONSE = 'response'

/* 顺序即语义，不随内容变：先有请求，后有响应。 */
const FACETS: readonly TabOption[] = [
  { id: REQUEST, label: 'Request' },
  { id: RESPONSE, label: 'Response' },
]

/*
 * 抽屉里空着，原因有三种，而此前只说了一种。
 *
 * 「没有返回内容」对一个还在跑的调用是假的：它不是没返回，是还没返回。子代理这一路
 * 更进一步 —— 它整段运行期都是空的，而且空得有原因：上游不回传子代理的过程。
 */
function emptyNoteOf(brief: SubAgentBrief | null, isRunning: boolean): string {
  if (!isRunning) {
    return '这次调用没有返回内容。'
  }

  return brief === null ? '还在运行，暂时没有输出。' : '子代理在自己那边干活，上游不回传它的过程。'
}

/**
 * 这个抽屉只有两种形态，所以它就写成两种，而不是一套挂满三元表达式的标记。
 *
 * ARIA 角色是这个节点「是什么」，不是「此刻可能是什么」：把 role 写成分支表达式，
 * 静态分析只能按 generic 判定，aria-labelledby 于是落空。两个面时它是一个真正的
 * tabpanel，一个面时它就是一个普通盒子，两边的属性都是字面量。
 */
export function ToolCallPanels({
  facets,
  isRunning,
}: {
  readonly facets: ToolCallFacets
  readonly isRunning: boolean
}) {
  const { brief, isReceipt, request, response } = facets
  const baseId = useId()
  const [chosen, setChosen] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  /*
   * 停在哪一面是派生的，不是一次性初值 —— 与 useDisclosure 同一条语义，人点过一次
   * 之后以人为准。上游没送入参时只有一面，那一面恒定是 Response。
   *
   * 产出只是一句回执时停在入参那一面：Write 交回来的「Wrote 127 bytes to …」是一句
   * 确认，这次调用真正的内容（那份要写进去的正文）在入参里。文件内容不搬到响应面 ——
   * 那是我们送出去的东西，把它印在 Response 上等于伪造一份服务端没给过的答复。改的
   * 只是默认落在哪一页，这样一展开看到的就是写了什么。
   */
  const settled = response !== null && !isReceipt
  const activeId = request === null ? RESPONSE : (chosen ?? (settled ? RESPONSE : REQUEST))

  const text =
    activeId === REQUEST && request !== null ? request : (response ?? emptyNoteOf(brief, isRunning))

  const face = (
    <VirtualProse
      bodyClassName="timeline-tool__prose"
      chaseEnd={false}
      isStreaming={false}
      scrollRef={scrollRef}
      text={text}
    />
  )

  /* 一个面：没有可切的东西，就不摆一条只有一格的切换条，也不假装自己是 tabpanel。 */
  if (request === null) {
    return (
      <div className="timeline-tool__body">
        <div className="timeline-tool__panel" ref={scrollRef}>
          {face}
        </div>
      </div>
    )
  }

  return (
    <div className="timeline-tool__body">
      <TabList
        activeId={activeId}
        baseId={baseId}
        className="timeline-tool__tabs"
        label="这次调用的两个面"
        onSelect={setChosen}
        options={FACETS}
      />

      <div
        aria-labelledby={tabId(baseId, activeId)}
        className="timeline-tool__panel"
        id={panelId(baseId, activeId)}
        ref={scrollRef}
        role="tabpanel"
      >
        {face}
      </div>
    </div>
  )
}
