import { useId, useState } from 'react'

import { panelId, TabList, type TabOption, tabId } from '../primitives/tabs'
import type { SubAgentBrief } from '../semantics/sub-agent'
import type { ToolContentPart } from '../semantics/tool-call-content'
import type { ToolCallFacets } from '../semantics/tool-call-facets'
import { Prose } from './prose'

/**
 * 抽屉里的两个面：左边是我们送出去的，右边是它交回来的。
 *
 * 此前这里是一路平铺 —— locations、任务书、那句空话、若干段产出，一件挨一件往下
 * 摞，读者得自己分辨哪一段是因、哪一段是果。而「因」还只对子代理可见。
 *
 * 抽屉里只剩一个滚动容器（.timeline-tool__panel）。上限仍是
 * --cp-timeline-output-max，只是它现在管的是整个面，不是其中一块。
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
 * 一段产出，一格一个组件。
 *
 * 种类分流属于「一段产出怎么画」，不属于「这张卡片怎么排」。种类直接取投影层导出的
 * 那个联合，不另立一份。key 由调用方给。
 */
function ToolCallPart({ part }: { readonly part: ToolContentPart }) {
  /*
   * 工具返回的正文和回答是同一种东西：一段 markdown。所以它走同一个组件，而不是一个
   * 只会原样倒字符串的 <pre> —— 计划模式产出的整份文档此前正是因此以 # 与 | 的原文
   * 出现在卡片里。命令输出不受影响：协议把终端单列为一种 part。这里的内容已经落定，
   * 所以流式修补与增量揭示都关掉。
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

/**
 * 交回来的那一面。
 *
 * 受影响的文件排在最前：它是这次调用的结果之一，而且这样一来它也进了面板那一个滚动
 * 容器 —— 此前那张 <ul> 谁都不封顶。
 *
 * parts 的 key 用下标：投影是 content 数组的纯函数，顺序即协议顺序，不重排也不中间
 * 插入，而每个渲染器都没有自己的状态。
 */
function ResponseFacet({
  brief,
  isRunning,
  locations,
  output,
  parts,
}: {
  readonly brief: SubAgentBrief | null
  readonly isRunning: boolean
  readonly locations: readonly { readonly line?: number; readonly path: string }[]
  readonly output: string | null
  readonly parts: readonly ToolContentPart[]
}) {
  return (
    <>
      {locations.length > 0 ? (
        <ul className="timeline-tool__locations">
          {locations.map((location, index) => (
            <li className="timeline-tool__location" key={`${location.path}:${String(index)}`}>
              {location.path}
              {location.line === undefined ? null : `:${String(location.line)}`}
            </li>
          ))}
        </ul>
      ) : null}

      {parts.map((part, index) => (
        <ToolCallPart key={`${part.type}:${String(index)}`} part={part} />
      ))}

      {/* 协议只给了 rawOutput 的时候，它就是这一面唯一交得出来的东西。 */}
      {output === null ? null : (
        <Prose className="timeline-tool__prose" isStreaming={false} text={output} />
      )}

      {parts.length === 0 && output === null ? (
        <p className="timeline-tool__empty">{emptyNoteOf(brief, isRunning)}</p>
      ) : null}
    </>
  )
}

export function ToolCallPanels({
  facets,
  isRunning,
  locations,
}: {
  readonly facets: ToolCallFacets
  readonly isRunning: boolean
  readonly locations: readonly { readonly line?: number; readonly path: string }[]
}) {
  const { brief, output, parts, request } = facets
  const baseId = useId()
  const [chosen, setChosen] = useState<string | null>(null)

  /*
   * 停在哪一面是派生的，不是一次性初值 —— 与 useDisclosure 同一条语义：还没有产出就
   * 停在入参那一面（运行中唯一有内容的就是它），产出到了自动让位，人点过一次之后以
   * 人为准。上游没送入参时切换条整条不出现，那时只有一面可停。
   */
  const hasRequest = request !== null
  const settled = parts.length > 0 || output !== null
  const activeId = hasRequest ? (chosen ?? (settled ? RESPONSE : REQUEST)) : RESPONSE

  return (
    <div className="timeline-tool__body">
      {hasRequest ? (
        <TabList
          activeId={activeId}
          baseId={baseId}
          className="timeline-tool__tabs"
          label="这次调用的两个面"
          onSelect={setChosen}
          options={FACETS}
        />
      ) : null}

      {/*
       * tabIndex 恒为 0：这是一个可滚动区域，键盘必须够得着（WCAG 2.1.1），
       * 与它此刻是不是一个 tabpanel 无关。
       */}
      <div
        aria-labelledby={hasRequest ? tabId(baseId, activeId) : undefined}
        className="timeline-tool__panel"
        id={hasRequest ? panelId(baseId, activeId) : undefined}
        role={hasRequest ? 'tabpanel' : undefined}
        tabIndex={0}
      >
        {activeId === REQUEST && request !== null ? (
          <Prose className="timeline-tool__prose" isStreaming={false} text={request} />
        ) : (
          <ResponseFacet
            brief={brief}
            isRunning={isRunning}
            locations={locations}
            output={output}
            parts={parts}
          />
        )}
      </div>
    </div>
  )
}
