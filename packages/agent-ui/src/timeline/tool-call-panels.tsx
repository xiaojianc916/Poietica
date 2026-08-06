import type { ToolCallTimelineItem } from '@poietica/agent-timeline'
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

/** 受影响的文件；类型从协议那一侧取，不在这里手抄一份结构。 */
type ToolCallLocations = ToolCallTimelineItem['locations']

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
 * 行号判的是「是不是一个数」，不是「是不是 undefined」：协议给的是
 * number | null | undefined，而此前那句 location.line === undefined 会让 null 落进
 * else，String(null) 于是把 ":null" 印在路径后面。
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
  readonly locations: ToolCallLocations
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
              {typeof location.line === 'number' ? `:${String(location.line)}` : null}
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

/**
 * 这个抽屉只有两种形态，所以它就写成两种，而不是一套挂满三元表达式的标记。
 *
 * ARIA 角色是这个节点「是什么」，不是「此刻可能是什么」：把 role 写成分支表达式，
 * 静态分析只能按 generic 判定，aria-labelledby 于是落空 —— 读屏拿到的也确实是一个
 * 无名的匿名容器。两个面时它是一个真正的 tabpanel，一个面时它就是一个普通盒子，
 * 两边的属性都是字面量。
 *
 * 面板不写 tabIndex：滚动容器的键盘可达性归渲染器 —— 这个应用是单引擎 WebView2
 * （见 reasoning-panel.tsx 的 useScrollendEvent），Chromium 自 127 起让滚动容器默认
 * 可聚焦，而同一体系里的 timeline-reasoning__scroll 也正是这么落地的。手写一份只是
 * 给同一个问题添第二个答案。
 */
export function ToolCallPanels({
  facets,
  isRunning,
  locations,
}: {
  readonly facets: ToolCallFacets
  readonly isRunning: boolean
  readonly locations: ToolCallLocations
}) {
  const { brief, output, parts, request } = facets
  const baseId = useId()
  const [chosen, setChosen] = useState<string | null>(null)

  /*
   * 停在哪一面是派生的，不是一次性初值 —— 与 useDisclosure 同一条语义：还没有产出就
   * 停在入参那一面（运行中唯一有内容的就是它），产出到了自动让位，人点过一次之后以
   * 人为准。上游没送入参时只有一面，那一面恒定是 Response。
   */
  const settled = parts.length > 0 || output !== null
  const activeId = request === null ? RESPONSE : (chosen ?? (settled ? RESPONSE : REQUEST))

  const face =
    activeId === REQUEST && request !== null ? (
      <Prose className="timeline-tool__prose" isStreaming={false} text={request} />
    ) : (
      <ResponseFacet
        brief={brief}
        isRunning={isRunning}
        locations={locations}
        output={output}
        parts={parts}
      />
    )

  /* 一个面：没有可切的东西，就不摆一条只有一格的切换条，也不假装自己是 tabpanel。 */
  if (request === null) {
    return (
      <div className="timeline-tool__body">
        <div className="timeline-tool__panel">{face}</div>
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
        role="tabpanel"
      >
        {face}
      </div>
    </div>
  )
}
