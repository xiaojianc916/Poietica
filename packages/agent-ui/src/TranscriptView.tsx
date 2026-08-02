import { useAssistantTimeline } from '@poietica/agent-session'
import type { FeedRow, PermissionItem, TurnFooter } from '@poietica/agent-timeline'
import {
  selectFeedRows,
  selectIsBusy,
  selectTurnFooter,
  selectTurns,
} from '@poietica/agent-timeline'
import { type ReactNode, useCallback } from 'react'
import { AgentActivityFeed, type FeedPort } from './feed/AgentActivityFeed'
import { RestoreSpinner } from './feed/RestoreSpinner'
import { ConversationMinimap } from './minimap/ConversationMinimap'
import { ThinkingIndicator } from './timeline/ThinkingIndicator'
import { TurnOutcomeNotice } from './timeline/TurnOutcomeNotice'

/*
 * 转录，以及只随转录变化的那些东西。
 *
 * 它存在的理由只有一个：把「以帧率变化的订阅」关在一棵尽可能小的子树里。此前
 * 这几行长在 AssistantSurface 上，而那一层还挂着输入框、开场白与快捷入口 ——
 * 于是模型每吐一个字，一棵与转录无关的树跟着 reconcile 一次。
 *
 * 这里不量任何几何，也不持有任何状态：滚动归虚拟器，答复归上层。
 */

/*
 * What the feed shows when the transcript has nothing to show.
 *
 * Two states have no entries to render and are not nothing: the wait before
 * the first frame, and a turn that ended without producing anything. Both are
 * derived, and both live outside the virtualised transcript.
 */
function renderFooter(footer: TurnFooter | null): ReactNode {
  if (footer === null) {
    return undefined
  }

  return footer.kind === 'waiting' ? (
    <ThinkingIndicator />
  ) : (
    <TurnOutcomeNotice outcome={{ status: footer.status }} />
  )
}

export interface TranscriptViewProps {
  readonly sessionKey: string
  readonly isRestoring: boolean
  /** 已经被输入框接管的那一道题：它不再进流，否则同一道题长在两个地方。 */
  readonly excluded?: PermissionItem | undefined
  readonly renderRow: (row: FeedRow) => ReactNode
}

export function TranscriptView({
  excluded,
  isRestoring,
  renderRow,
  sessionKey,
}: TranscriptViewProps) {
  const timeline = useAssistantTimeline(sessionKey)

  /*
   * 不包 useMemo。
   *
   * 这三个选择器自带投影缓存（timeline-selectors 的 FEEDS / TURNS 弱表，内容
   * 没变时交还同一个数组）。再包一层 useMemo，依赖是每帧换引用的 timeline ——
   * 那一层永远不命中，只是每帧多一次依赖数组的分配与比较。缓存的所有权只能
   * 有一个，而它在选择器里：那里是跨组件共享的位置，这里不是。
   */
  const rows = selectFeedRows(timeline)
  const visibleRows = excluded === undefined ? rows : rows.filter((row) => row.item !== excluded)

  /*
   * 轮次读的是屏幕上真正在滚的那个数组：摘出去一行，两个数组的下标就错开一位，
   * 而 ConversationTurn.rowIndex 正是喂给 virtualizer.scrollToIndex 的那个行号。
   */
  const turns = selectTurns(visibleRows)

  const overlay = useCallback(
    (port: FeedPort) =>
      turns.length === 0 ? null : (
        <ConversationMinimap activeRow={port.activeRow} onSelect={port.scrollToRow} turns={turns} />
      ),
    [turns],
  )

  return (
    <>
      {/*
       * 判据里带 rows.length === 0 不是防抖，是归属：这个图标属于「空白」，
       * 不属于「忙碌」。第一批行一到就撤，不等 isRestoring 落下。
       */}
      <RestoreSpinner active={isRestoring && rows.length === 0} />

      <AgentActivityFeed
        footer={renderFooter(selectTurnFooter(timeline))}
        isBusy={selectIsBusy(timeline)}
        overlay={overlay}
        renderRow={renderRow}
        rows={visibleRows}
      />
    </>
  )
}
