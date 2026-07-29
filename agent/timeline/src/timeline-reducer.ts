import type {
  AcpContentBlock,
  AcpSessionUpdate,
  AcpStopReason,
  RunEvent,
  RunId,
  RunStatus,
} from '@poietica/agent-protocol'
import type {
  AgentTextItem,
  AgentThoughtItem,
  TimelineItem,
  TimelineState,
  ToolCallTimelineItem,
} from '@poietica/agent-timeline'

/**
 * The timeline reducer.
 *
 * Pure, total and replayable: the same events in the same order always produce
 * the same state, and replaying a persisted log must reproduce a live run byte
 * for byte. It performs no IO, holds no clock and touches no module state.
 *
 * The state is a conversation, not a run. A turn is a segment appended to it:
 * appendUserMessage opens the segment the moment the user commits, and the
 * frames of that turn fill it in. Nothing is ever cleared, because a transcript
 * that forgets the previous turn is not a transcript.
 *
 * Sequence numbers restart at one for every run, so a seq identifies a frame
 * only inside its own segment, and entry identities are namespaced by segment.
 * Without that, a second turn writes over the first one: the agent is free to
 * reuse a tool call id, and the deduplicator would discard every frame of it.
 *
 * Tolerances are deliberate, because a transport can misbehave:
 *   - a duplicated seq inside a segment is discarded;
 *   - a tool_call_update for an unknown id creates a placeholder rather than
 *     dropping the update on the floor.
 *
 * 纯是对外的性质，不是每一步都要复制。
 *
 * 内部走一份草稿：draftOf 取出可变副本，事件逐帧写进去，freeze 交出成品。
 * 一次重放因此只分配一次 items、一次 Set，而不是每帧各一次；此前那种写法
 * 在一条几千帧的对话上是 O(N²)，代价直接落在打开会话的那一刻。
 *
 * 身份索引按需建：只有真的要按 id 对账（tool_call、tool_call_update、plan）
 * 才建一次 Map，纯文本流一次都不建。
 */

interface Draft {
  readonly runId: RunId
  status: RunStatus
  readonly items: TimelineItem[]
  /** id → 下标；没人按 id 找过就还没有。 */
  index: Map<string, number> | null
  lastSeq: number
  applied: Set<number>
  runIndex: number
}

export function createTimelineState(runId: RunId): TimelineState {
  return {
    runId,
    status: 'idle',
    items: [],
    lastSeq: -1,
    appliedSeqs: new Set<number>(),
    runIndex: 0,
  }
}

export function replayRunEvents(runId: RunId, events: readonly RunEvent[]): TimelineState {
  const draft = draftOf(createTimelineState(runId))

  for (const event of events) {
    apply(draft, event)
  }

  return freeze(draft)
}

/**
 * Replays a whole conversation: several turns, one transcript.
 *
 * Every run numbers its own frames from one, so a stored conversation is a
 * sequence of segments rather than one long run. A turn beginning therefore
 * opens a new segment, which is what stops the second turn from being
 * discarded frame by frame as a duplicate of the first.
 */
export function replayThreadEvents(runId: RunId, events: readonly RunEvent[]): TimelineState {
  const draft = draftOf(createTimelineState(runId))

  /*
   * 段号从末端倒着编，所以它不随读取宽度变化。
   *
   * 身份前缀此前是「这是本次窗口里的第几段」，于是同一句话，读 40 轮时叫
   * r5-，读 80 轮时叫 r45-：向上续读的那一刻，虚拟器手上每一行的 key 全部
   * 作废，整表重挂载，滚动位置随之失去锚。上游注释里那句「由稳定的
   * getItemKey 认回同一条并保持它的视觉位置」，前提就断在这里。
   *
   * 倒着编之后，最后一轮恒为 r0、倒数第二轮恒为 r-1，续读只在负的方向上长
   * 出新号 —— 屏幕上已有的那些行，连 id 带对象一起原样留下。这不是为滚动做
   * 的让步：一轮在一条对话里的位置，本来就该由它距今多少轮来定，而不是由
   * 「这次我读了多少」来定。
   */
  draft.runIndex = -turnsIn(events)

  for (const event of events) {
    if (event.kind === 'run_started') {
      openSegment(draft)
    }

    apply(draft, event)
  }

  /* A run that never reached a terminal event was interrupted (force-kill,
     crash), and that is a fact about the run, not about the calls it made.
     Whatever a tool call was doing when the process died is what the log says
     it was doing; how a stalled call is drawn is the read model's business. */
  if (draft.status === 'running' || draft.status === 'awaiting_permission') {
    draft.status = 'failed'
  }

  return freeze(draft)
}

/**
 * Opens a turn with what the user said.
 *
 * The message is a local fact: they typed it, they committed it, and no process,
 * protocol or log has to confirm it before it can be read back. A transport
 * failure must be able to take the answer away without taking the question with
 * it, which is why nothing here waits for a frame.
 *
 * Opening a segment also resets the sequence window, because the run about to
 * start numbers its own frames from one.
 */
export function appendUserMessage(state: TimelineState, text: string, at: number): TimelineState {
  const said = text.trim()

  if (said.length === 0) {
    return state
  }

  const draft = draftOf(state)

  draft.status = 'running'
  /* 这句话先于 run_started 到达，所以它落在上一段的命名空间里；
     位置补进 id，同一段内问两次也不会撞。 */
  push(draft, {
    type: 'user_message',
    id: `${namespace(draft)}said-${String(draft.items.length)}`,
    at,
    text: said,
  })

  return freeze(draft)
}

export function applyRunEvent(state: TimelineState, event: RunEvent): TimelineState {
  /* 重复帧不产生新状态：身份不变，下游的记忆化才不会被白白打掉。
     run_started 例外：它开的是新一段，段内的 seq 窗口本来就要重来，
     拿上一段的窗口去判它，判出来的"重复"是假的。 */
  if (event.kind !== 'run_started' && state.appliedSeqs.has(event.seq)) {
    return state
  }

  const draft = draftOf(state)

  /* 实时流不会把旧帧再送一遍，所以这里的 run_started 一定是新的一轮。
     它从 1 开始编自己的号，窗口必须跟着换，否则整轮会被上一轮的 seq
     判成重复——没有经过输入框的那些轮次（重连续接、重试）就是这么消失的。 */
  if (event.kind === 'run_started') {
    openSegment(draft)
  }

  apply(draft, event)

  return freeze(draft)
}

/* -------------------------------------------------------------- */

function draftOf(state: TimelineState): Draft {
  return {
    runId: state.runId,
    status: state.status,
    items: state.items.slice(),
    index: null,
    lastSeq: state.lastSeq,
    applied: new Set(state.appliedSeqs),
    runIndex: state.runIndex,
  }
}

function freeze(draft: Draft): TimelineState {
  return {
    runId: draft.runId,
    status: draft.status,
    items: draft.items,
    lastSeq: draft.lastSeq,
    appliedSeqs: draft.applied,
    runIndex: draft.runIndex,
  }
}

/** 新的一轮：它自己的帧从一开始编号，所以窗口跟着换。 */
function openSegment(draft: Draft): void {
  draft.lastSeq = -1
  draft.applied = new Set<number>()
  draft.runIndex += 1
}

function apply(draft: Draft, event: RunEvent): void {
  /*
   * 段的边界不在这里判。
   *
   * 一帧 run_started 可能是新的一轮，也可能是同一份日志被重放了一遍，
   * 而这两者的 seq、at、prompt 全都一样：apply 手上没有任何东西能把它们
   * 分开。所以由知道自己在干什么的调用方来开段——replayThreadEvents 遍历
   * 多轮日志时开，applyRunEvent 在实时流上收到一轮开始时开，而
   * replayRunEvents 一轮到底，一段都不开：同一份日志放两遍必须得到同一个
   * 状态，这是回放能被信任的前提。
   */
  if (draft.applied.has(event.seq)) {
    return
  }

  draft.applied.add(event.seq)
  draft.lastSeq = Math.max(draft.lastSeq, event.seq)

  switch (event.kind) {
    case 'run_started': {
      draft.status = 'running'
      withPrompt(draft, event)

      return
    }

    case 'acp_update': {
      applyAcpUpdate(draft, event.notification.update, event.seq, event.at)

      return
    }

    case 'permission_requested': {
      draft.status = 'awaiting_permission'
      push(draft, {
        type: 'permission',
        id: `${namespace(draft)}permission-${event.requestId}`,
        at: event.at,
        requestId: event.requestId,
        title: event.title,
        /* 缺席和"值为 undefined"在 exactOptionalPropertyTypes 下不是一回事，
           所以没带就整个键不写。 */
        ...(event.toolCall === undefined ? {} : { toolCall: event.toolCall }),
        options: event.options,
      })

      return
    }

    case 'permission_resolved': {
      draft.status = 'running'

      for (const [position, item] of draft.items.entries()) {
        if (item.type === 'permission' && item.requestId === event.requestId) {
          draft.items[position] = {
            ...item,
            resolution: { optionId: event.optionId, outcome: event.outcome },
          }
        }
      }

      return
    }

    case 'run_finished': {
      /* A turn can end on the agent terms and still be a failure: a rejected
         provider request is reported by the agent itself, outside the
         protocol, and the stop reason stays ordinary. When it left such an
         account, that account is the entry, and our own wording never
         appears at all. */
      sealTail(draft)
      draft.status = finalStatus(event.stopReason)

      const said = event.diagnostics?.trim() ?? ''

      if (said.length > 0) {
        push(draft, {
          type: 'error',
          id: `${namespace(draft)}agent-${String(event.seq)}`,
          at: event.at,
          message: said,
        })
      }

      return
    }

    case 'run_failed': {
      sealTail(draft)
      draft.status = 'failed'
      push(draft, {
        type: 'error',
        id: `${namespace(draft)}error-${String(event.seq)}`,
        at: event.at,
        message: preferAgent(event.message, event.diagnostics),
      })

      return
    }
  }
}

/*
 * 收窄后的协议更新类型。用 Extract 而不是在 contracts 里新导出七个成员名：
 * 判别式已经在类型里了，再手抄一份就是第二份需要同步维护的清单。
 */
type AcpUpdateOf<TKind extends AcpSessionUpdate['sessionUpdate']> = Extract<
  AcpSessionUpdate,
  { sessionUpdate: TKind }
>

function applyAcpUpdate(draft: Draft, update: AcpSessionUpdate, seq: number, at: number): void {
  const scope = namespace(draft)

  switch (update.sessionUpdate) {
    case 'user_message_chunk': {
      push(draft, {
        type: 'user_message',
        id: `${scope}user-${String(seq)}`,
        at,
        text: textOf(update.content),
      })

      return
    }

    case 'agent_message_chunk': {
      appendChunk(draft, 'agent_text', textOf(update.content), scope, seq, at)

      return
    }

    case 'agent_thought_chunk': {
      appendChunk(draft, 'agent_thought', textOf(update.content), scope, seq, at)

      return
    }

    case 'tool_call': {
      applyToolCall(draft, update, scope, at)

      return
    }

    case 'tool_call_update': {
      applyToolCallUpdate(draft, update, scope, at)

      return
    }

    case 'plan': {
      /* The protocol replaces the whole plan; keep exactly one plan entry per
         turn, so a later turn cannot rewrite an earlier one. */
      const id = `${scope}plan`
      const plan = { type: 'plan', id, at, entries: update.entries } as const
      const position = positionOf(draft, id)

      if (position < 0) {
        push(draft, plan)

        return
      }

      draft.items[position] = plan

      return
    }

    case 'available_commands_update': {
      /* A session capability, not a turn. The command list belongs to the
         composer that offers the commands, not to the transcript of what
         happened, so it produces no item here. This case is written out rather
         than left to the default so that ignoring it stays a decision. */
      return
    }
  }
}

/*
 * 需要和既有条目对账的两个分支各自独立。派发表因此只剩"哪种更新交给谁"，
 * 而每个投影都可以在不看见另外六个分支的情况下读懂。
 */
function applyToolCall(
  draft: Draft,
  update: AcpUpdateOf<'tool_call'>,
  scope: string,
  at: number,
): void {
  const id = `${scope}tool-${update.toolCallId}`
  const created: ToolCallTimelineItem = {
    type: 'tool_call',
    id,
    at,
    toolCallId: update.toolCallId,
    title: update.title,
    kind: update.kind,
    status: update.status,
    content: update.content ?? [],
    locations: update.locations ?? [],
    rawInput: update.rawInput,
    startedAt: at,
  }

  const position = positionOf(draft, id)

  if (position < 0) {
    push(draft, created)

    return
  }

  draft.items[position] = created
}

function applyToolCallUpdate(
  draft: Draft,
  update: AcpUpdateOf<'tool_call_update'>,
  scope: string,
  at: number,
): void {
  const id = `${scope}tool-${update.toolCallId}`
  const position = positionOf(draft, id)

  if (position < 0) {
    push(draft, {
      type: 'tool_call',
      id,
      at,
      toolCallId: update.toolCallId,
      title: update.title ?? update.toolCallId,
      kind: update.kind ?? 'other',
      status: update.status ?? 'in_progress',
      content: update.content ?? [],
      locations: update.locations ?? [],
      rawOutput: update.rawOutput,
      startedAt: at,
    })

    return
  }

  const current = draft.items[position]

  if (current?.type !== 'tool_call') {
    return
  }

  const status = update.status ?? current.status
  /* A call that is still running has no end time, which is not the same as
     having one that is undefined. The distinction is the whole point of
     exactOptionalPropertyTypes, so the property is omitted rather than set
     to nothing. An end, once recorded, is never moved. */
  const endedAt = isTerminal(status) ? (current.endedAt ?? at) : current.endedAt

  draft.items[position] = {
    ...current,
    title: update.title ?? current.title,
    kind: update.kind ?? current.kind,
    status,
    content: carryForwardDiff(current.content, update.content),
    locations: update.locations ?? current.locations,
    rawOutput: update.rawOutput ?? current.rawOutput,
    ...(endedAt === undefined ? {} : { endedAt }),
  }
}

/**
 * 一段日志里有多少轮。
 *
 * 一次线性预扫描，与随后那次遍历同阶；换来的是一个不随读取宽度变化的段号。
 */
function turnsIn(events: readonly RunEvent[]): number {
  let turns = 0

  for (const event of events) {
    if (event.kind === 'run_started') {
      turns += 1
    }
  }

  return turns
}

/**
 * The identity prefix of the turn currently being written.
 *
 * 回放出来的段号是零或负数（最后一轮为 r0），实时开出来的段号为正。两者不会
 * 相遇：一条对话被读回来之后，接着说的话开的是 r1，而 r1 在任何一次回放里都
 * 不存在。
 */
function namespace(draft: Draft): string {
  return `r${String(draft.runIndex)}-`
}

/**
 * Reconciles the recorded prompt with the one already on screen.
 *
 * A live surface shows the question the instant it is asked; a replayed run has
 * only the recorded frame to show it with. Both are the same question, so they
 * converge on one entry instead of each adding their own.
 */
function withPrompt(
  draft: Draft,
  event: { readonly seq: number; readonly at: number; readonly prompt?: string },
): void {
  const prompt = event.prompt

  if (prompt === undefined || prompt.length === 0) {
    return
  }

  const tail = draft.items.at(-1)

  if (tail && tail.type === 'user_message' && tail.text === prompt) {
    return
  }

  push(draft, {
    type: 'user_message',
    id: `${namespace(draft)}said-${String(event.seq)}`,
    at: event.at,
    text: prompt,
  })
}

function appendChunk(
  draft: Draft,
  type: 'agent_text' | 'agent_thought',
  chunk: string,
  scope: string,
  seq: number,
  at: number,
): void {
  const tail = draft.items.at(-1)

  if (tail && tail.type === type && !tail.sealed) {
    const grown: AgentTextItem | AgentThoughtItem = { ...tail, text: tail.text + chunk }

    draft.items[draft.items.length - 1] = grown

    return
  }

  const prefix = type === 'agent_text' ? 'text-' : 'thought-'

  push(draft, {
    type,
    id: scope + prefix + String(seq),
    at,
    text: chunk,
    sealed: false,
  } as AgentTextItem | AgentThoughtItem)
}

/** 追加一条：末尾那段说到这里为止，新的一条排在它后面。 */
function push(draft: Draft, item: TimelineItem): void {
  sealTail(draft)
  draft.items.push(item)
  draft.index?.set(item.id, draft.items.length - 1)
}

function sealTail(draft: Draft): void {
  const tail = draft.items.at(-1)

  if (!tail) {
    return
  }

  if (tail.type !== 'agent_text' && tail.type !== 'agent_thought') {
    return
  }

  if (tail.sealed) {
    return
  }

  draft.items[draft.items.length - 1] = { ...tail, sealed: true }
}

/**
 * 按 id 找一条：索引只有在真的要对账时才建，一次草稿至多建一次。
 *
 * 纯文本流从不走这里，所以流式追加不需要为索引付任何代价。
 */
function positionOf(draft: Draft, id: string): number {
  let index = draft.index

  if (index === null) {
    index = new Map<string, number>()

    for (const [position, item] of draft.items.entries()) {
      index.set(item.id, position)
    }

    draft.index = index
  }

  return index.get(id) ?? -1
}

/**
 * 把已经看见过的 diff 带到后续帧里。
 *
 * 协议规定 tool_call_update.content 是整体替换而不是追加，但它并不要求每一帧都
 * 重新带上 diff —— agent 通常只在调用开始时给出一次，终局帧的 content 由工具结果
 * 重建，不含 diff。照字面替换，diff 会在调用完成的那一瞬间消失，而完成恰好是最
 * 需要看到它的时刻。这是对协议的容差，不针对任何一家 agent。
 *
 * 于是：新帧自带 diff 就整份采用（它更新），否则把旧的 diff 留在前面。
 *
 * 这一条对每一家都成立，所以它留在通用层，不做成每家档案自带的钩子：把 diff
 * 一直挂在 content 里的 agent 每帧都命中第一个分支（整份采用，不会显示两遍），
 * 只在开头挂一次的命中第二个。两种发法同一段代码就够了 —— 各家不同的是数据，
 * 不是做法。
 */
function carryForwardDiff(
  current: ToolCallTimelineItem['content'],
  incoming: ToolCallTimelineItem['content'] | undefined,
): ToolCallTimelineItem['content'] {
  if (incoming === undefined) {
    return current
  }

  if (incoming.some((entry) => entry.type === 'diff')) {
    return incoming
  }

  const held = current.filter((entry) => entry.type === 'diff')

  return held.length === 0 ? incoming : [...held, ...incoming]
}

function isTerminal(status: ToolCallTimelineItem['status']): boolean {
  return status === 'completed' || status === 'failed'
}

function textOf(content: AcpContentBlock): string {
  return content.type === 'text' ? content.text : ''
}

/**
 * The account the agent gave, or ours if it gave none.
 *
 * Ours is a description of a silence: it exists so that a turn nobody can
 * explain is still visible. The moment the agent explains itself, ours is not
 * context, it is noise, so it is not shown alongside — it is not shown.
 */
function preferAgent(message: string, diagnostics?: string): string {
  const said = diagnostics?.trim() ?? ''

  return said.length === 0 ? message : said
}

function finalStatus(stopReason: AcpStopReason): RunStatus {
  if (stopReason === 'cancelled') {
    return 'cancelled'
  }

  if (stopReason === 'refusal') {
    return 'failed'
  }

  return 'completed'
}
