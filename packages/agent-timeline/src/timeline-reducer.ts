import type {
  AcpContentBlock,
  AcpSessionUpdate,
  AcpStopReason,
  RunEvent,
  RunStatus,
} from '@poietica/acp'
import type {
  AgentTextItem,
  AgentThoughtItem,
  MessageImage,
  TimelineItem,
  TimelineState,
  ToolCallTimelineItem,
  UserMessageItem,
} from '@poietica/agent-timeline'
import { isRenderable } from './renderable'

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
  status: RunStatus
  readonly items: TimelineItem[]
  /** id → 下标；没人按 id 找过就还没有。 */
  index: Map<string, number> | null
  lastSeq: number
  runIndex: number
}

export function createTimelineState(): TimelineState {
  return {
    status: 'idle',
    items: [],
    lastSeq: 0,
    runIndex: 0,
  }
}

export function replayRunEvents(events: readonly RunEvent[]): TimelineState {
  const draft = draftOf(createTimelineState())

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
export function replayThreadEvents(events: readonly RunEvent[]): TimelineState {
  const draft = draftOf(createTimelineState())

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
export function appendUserMessage(
  state: TimelineState,
  text: string,
  at: number,
  images: readonly MessageImage[] = [],
): TimelineState {
  const said = text.trim()

  /* 空的是这一句话，不是这一格。只挑了图、没打字，仍然是一句说过的话 ——
     此前这里只看文字，那条消息连转录都进不去：图发出去了，屏幕上没有它。
     缺省成空数组，所以既有的调用方一个字都不用改。 */
  if (said.length === 0 && images.length === 0) {
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
    /* 缺席和「值为 undefined」在 exactOptionalPropertyTypes 下不是一回事。 */
    ...(images.length === 0 ? {} : { images }),
  })

  return freeze(draft)
}

/**
 * 记一件本地发生的事故。
 *
 * 起不来的 agent、送不出去的权限答复、读不回来的历史 —— 它们发生在任何一帧
 * 之前或之外，日志里没有对应的帧。此前调用方伪造一帧 run_failed 交给
 * applyRunEvent，序号取 lastSeq 加一；而序号是原生那侧发的（recorder.rs 的
 * next_seq，每轮从一起编），客户端自己发一个就是替对面占了一个号：真的那一帧
 * 带着同一个号到达时，会被上面那道去重判成重复而永久丢弃。
 *
 * 所以本地的事故以本地的形式进来：一条 error 条目，不占序号、不动 lastSeq 窗口、
 * 不冒充任何一帧。它因此也不参与重放 —— 一段日志放两遍仍然得到同一个状态，那是
 * 回放能被信任的前提，而一件只发生在这台机器上的事故本来就不在日志里。
 *
 * endsTurn 是一个事实，不是一个开关：问送不出去，这一轮就到此为止；答复送不出去
 * 或历史读不回来时，那一轮还在跑，谁也没资格替它宣告失败。
 */
export function appendLocalError(
  state: TimelineState,
  error: { readonly message: string; readonly at: number; readonly endsTurn: boolean },
): TimelineState {
  const draft = draftOf(state)

  if (error.endsTurn) {
    draft.status = 'failed'
  }

  /* 位置补进 id：同一段里出两次事故也不会撞，与 said- 同一套办法。 */
  push(draft, {
    type: 'error',
    id: `${namespace(draft)}local-${String(draft.items.length)}`,
    at: error.at,
    message: error.message,
  })

  return freeze(draft)
}

/**
 * 一批帧，一趟草稿。
 *
 * 逐帧调用会为每一帧复制一次整条 items —— 一次回答几千帧，那是 O(帧 × 条目)，
 * 而屏幕一秒只画六十次：中间那些副本没有一个被人看见过。上游按屏幕的节拍把帧
 * 攒起来，攒到的这一批在这里合成一次复制、一次封版。
 *
 * 判据一个字没改，只是共用一份草稿：草稿自己带着 lastSeq，同一批里的重复帧
 * 照样被丢掉。一批全是重复帧时原样交回入参那个对象 —— 引用不变，下游的记忆化
 * 不会被白白打掉，这正是此前那道提前返回守着的东西。
 */
export function applyRunEvents(state: TimelineState, events: readonly RunEvent[]): TimelineState {
  let draft: Draft | null = null

  for (const event of events) {
    /* run_started 例外：它开的是新一段，段内的 seq 窗口本来就要重来，
       拿上一段的窗口去判它，判出来的"重复"是假的。 */
    if (event.kind !== 'run_started' && event.seq <= (draft?.lastSeq ?? state.lastSeq)) {
      continue
    }

    draft ??= draftOf(state)

    /* 实时流不会把旧帧再送一遍，所以这里的 run_started 一定是新的一轮。
       它从 1 开始编自己的号，窗口必须跟着换，否则整轮会被上一轮的 seq
       判成重复——没有经过输入框的那些轮次（重连续接、重试）就是这么消失的。 */
    if (event.kind === 'run_started') {
      openSegment(draft)
    }

    apply(draft, event)
  }

  return draft === null ? state : freeze(draft)
}

/** 一帧就是一批只有一帧的批。两条路径共用同一套判据，不是两份实现。 */
export function applyRunEvent(state: TimelineState, event: RunEvent): TimelineState {
  return applyRunEvents(state, [event])
}

/** 账本里的一张图，以及它属于哪一句话。 */
export interface ReplayedAttachment {
  readonly url: string
  readonly turn: number
  readonly ordinal: number
}

/**
 * 把账本里的图挂回它当初那句话上。
 *
 * 两份东西在这里合流：一段由 agent 交还的经过，和一张只存在于本机的账本。
 * 它们没有共同的 id —— 这个程序不存对话内容，历史里的每一个 id 都是 agent
 * 发的，本地账本不可能引用它们。能由两侧各自数出同一个答案的只有序号。
 *
 * 所以对齐靠数数，而且是**倒着数**：账本的计数 N 盖住的是最后 N 条用户消息
 * （见迁移 0011）。正着数在任何一条早于 0011 的对话上都是错的 —— 那些话发生
 * 在计数存在之前，第 0 轮并不是第一条消息。
 *
 * 数的是「消息」，不是「帧」。协议按 content block 发 chunk，一句「文字加一
 * 张图」是两帧；把帧当消息数，这两个数就永远不等，而不等的后果是整批不认领。
 * 并帧的规矩只有一处（appendSaid），这条对齐能不能成立全靠它。
 *
 * 数的是「消息」，不是「帧」。协议按 content block 发 chunk，一句「文字加一张
 * 图」是两帧，一句纯图片在有些 agent 的回放里一帧都没有 —— 把帧当消息数，这
 * 两个数就没有一次会相等。并帧的规矩只有一处（appendSaid），这条对齐成不成立
 * 全靠它。
 *
 * 对不齐就整批不认领。历史比账本还短（换过 agent、只交回了一段），这时候硬挂
 * 就是把图挂到别人的话上；一张不显示，好过显示在错的地方 —— 后者人看不出来。
 *
 * 但不认领要说出来。此前这两条路径是光秃秃的 return state：图没了，屏幕上没有
 * 任何痕迹，连排查的入口都没有 —— 这个文件自己的原则是「空本身不是问题，不作声
 * 才是」，那条原则此前只写给了历史，没写给附件。
 *
 * 顺序不在这里定：账本按 (turn, ordinal) 排好了才交过来（见 attachments_of
 * 的 ORDER BY），这里再排一遍就是第二份排序规则。
 */
export function attachImages(
  state: TimelineState,
  attachments: readonly ReplayedAttachment[],
  prompts: number,
): TimelineState {
  if (attachments.length === 0) {
    return state
  }

  const said: number[] = []

  for (const [position, item] of state.items.entries()) {
    if (item.type === 'user_message') {
      said.push(position)
    }
  }

  /* 账本盖不住的那一段前史，跳过它。负数意味着这段经过比账本还短。 */
  const offset = said.length - prompts

  if (offset < 0) {
    return unclaimed(state, attachments, prompts, said.length)
  }

  const carried = new Map<number, MessageImage[]>()

  for (const attachment of attachments) {
    const position = said[offset + attachment.turn]

    /* 一格对不上，整批都不能信：说明这两侧数出来的不是同一件事。 */
    if (position === undefined) {
      return unclaimed(state, attachments, prompts, said.length)
    }

    const held = carried.get(position)

    if (held === undefined) {
      carried.set(position, [{ url: attachment.url }])

      continue
    }

    held.push({ url: attachment.url })
  }

  const items = state.items.slice()

  for (const [position, images] of carried) {
    const item = items[position]

    if (item?.type !== 'user_message') {
      return state
    }

    const grown: UserMessageItem = { ...item, images }

    items[position] = grown
  }

  return { ...state, items }
}

/**
 * 这批图没能挂回原处，说一声。
 *
 * 走的是本地事故那条既有通道（appendLocalError），与「历史取不回来」同一条
 * 横线：两者都发生在任何一帧之外，日志里都没有对应的帧。endsTurn 为假 ——
 * 这不是某一轮失败了。
 *
 * 两个数字写进这句话里，因为它们正是判断出在哪一侧的全部依据：账本多，说明
 * agent 没把那几句话回放出来；屏幕多，说明一句话被拆成了几条。
 *
 * 时间取末尾那一条的，这一层不持有时钟（见文件头）。
 */
function unclaimed(
  state: TimelineState,
  attachments: readonly ReplayedAttachment[],
  prompts: number,
  said: number,
): TimelineState {
  return appendLocalError(state, {
    message: `这条对话有 ${String(attachments.length)} 张图没能挂回原处：账本记着 ${String(prompts)} 句话，重放出来 ${String(said)} 句。`,
    at: state.items.at(-1)?.at ?? 0,
    endsTurn: false,
  })
}
/* -------------------------------------------------------------- */

function draftOf(state: TimelineState): Draft {
  return {
    status: state.status,
    items: state.items.slice(),
    index: null,
    lastSeq: state.lastSeq,
    runIndex: state.runIndex,
  }
}

function freeze(draft: Draft): TimelineState {
  return {
    status: draft.status,
    items: draft.items,
    lastSeq: draft.lastSeq,
    runIndex: draft.runIndex,
  }
}

/** 新的一轮：它自己的帧从一开始编号，所以窗口跟着换。 */
function openSegment(draft: Draft): void {
  draft.lastSeq = 0
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
  if (event.seq <= draft.lastSeq) {
    return
  }

  draft.lastSeq = event.seq

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

      /* 身份是算得出来的（见 permission_requested 那一支），所以按 id 定位。
         此前每来一次答复就把整条转录扫一遍 —— 索引就在同一个文件里。 */
      const position = positionOf(draft, `${namespace(draft)}permission-${event.requestId}`)
      const asked = position < 0 ? undefined : draft.items[position]

      if (asked?.type === 'permission') {
        draft.items[position] = {
          ...asked,
          resolution: { optionId: event.optionId, outcome: event.outcome },
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
      /* 一轮的结局是一轮的事实，不是它发起的每一次调用的事实。没等到终态的
         调用就停在它最后被报到的地方：status 装的是协议值，也就是 agent 说过
         的话，这一层没有资格替它补一句「失败」。停住的纺锤怎么画，归读模型。 */
      draft.status = finalStatus(event.stopReason)

      const said = event.diagnostics?.trim() ?? ''
      const told = said.length > 0 ? said : silentTurn(draft, event.stopReason)

      if (told !== undefined) {
        push(draft, {
          type: 'error',
          id: `${namespace(draft)}agent-${String(event.seq)}`,
          at: event.at,
          message: told,
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
      appendSaid(draft, scope, seq, at, textOf(update.content))

      return
    }

    case 'agent_message_chunk': {
      appendChunk(draft, 'agent_text', update, scope, seq, at)

      return
    }

    case 'agent_thought_chunk': {
      appendChunk(draft, 'agent_thought', update, scope, seq, at)

      return
    }

    case 'tool_call':
    case 'tool_call_update': {
      upsertToolCall(draft, update, scope, at)

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

/**
 * 一次工具调用的投影，只有这一条路径。
 *
 * tool_call 与 tool_call_update 是同一件事的两次到达：协议按 toolCallId 寻址，
 * 两种帧携带同一组字段，区别只在后者全部可选。所以没见过就建，见过就按这一帧
 * 真的带了的字段合并 —— 一个 upsert，不是两份实现。
 *
 * 此前是两个函数，而且不等价：tool_call 分支整份覆盖，于是 agent 依协议重发一次
 * tool_call 会把已经收到的 endedAt 与 rawOutput 一并抹掉。
 *
 * 也不再把旧的 diff 往新 content 前面拼。协议规定 content 是整体替换，拼接是
 * 客户端自己发明的语义：对只在中途带一次 diff 的 agent，它会让同一次调用显示
 * 两份 diff。要显示什么由帧说了算，这一层不猜。
 */
function upsertToolCall(
  draft: Draft,
  update: AcpUpdateOf<'tool_call'> | AcpUpdateOf<'tool_call_update'>,
  scope: string,
  at: number,
): void {
  const id = `${scope}tool-${update.toolCallId}`
  const position = positionOf(draft, id)
  const found = position < 0 ? undefined : draft.items[position]
  const held = found?.type === 'tool_call' ? found : undefined

  const status = update.status ?? held?.status ?? 'pending'
  /* running 的调用没有结束时间，这与「有一个 undefined 的结束时间」不是一回事；
     结束一旦记下就不再移动。 */
  const endedAt = isTerminal(status) ? (held?.endedAt ?? at) : held?.endedAt
  const rawInput = 'rawInput' in update ? update.rawInput : held?.rawInput
  const rawOutput = 'rawOutput' in update ? update.rawOutput : held?.rawOutput

  const next: ToolCallTimelineItem = {
    type: 'tool_call',
    id,
    at: held?.at ?? at,
    toolCallId: update.toolCallId,
    title: update.title ?? held?.title ?? update.toolCallId,
    kind: update.kind ?? held?.kind ?? 'other',
    status,
    content: update.content ?? held?.content ?? [],
    locations: update.locations ?? held?.locations ?? [],
    startedAt: held?.startedAt ?? at,
    ...(rawInput === undefined ? {} : { rawInput }),
    ...(rawOutput === undefined ? {} : { rawOutput }),
    ...(endedAt === undefined ? {} : { endedAt }),
  }

  if (held === undefined) {
    push(draft, next)

    return
  }

  draft.items[position] = next
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
  event: { readonly seq: number; readonly at: number; readonly prompt?: string | undefined },
): void {
  /* 缺席与空串在这里是同一件事：都表示这一帧没有带来一句要显示的话。 */
  const prompt = event.prompt ?? ''

  if (prompt.length === 0) {
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

/**
 * 把一段流式文本并进它所属的那一条消息。
 *
 * 边界此前是遍历顺序的副产品：末尾那条同类型、还没封口，就接着往上贴，而任何
 * 别的条目进来都会先给它封口。除此之外没有第二个信号 —— 所以 agent 背靠背发
 * 两条消息、中间什么都没插时，两条会粘成一条。
 *
 * 协议给了信号：ContentChunk 带 messageId，同一条消息的每一段带同一个号。
 * 号变了就是另一条消息，哪怕它紧挨着上一段。
 *
 * 它只会切，不会合。中间隔着一张工具卡片的两段，即使同号也仍然是两条：时间轴
 * 记的是发生的顺序，为了让同号的两段并拢而跨过中间那张卡片，就是在改写这个
 * 顺序。
 *
 * 号缺席时退回相邻续写，逐字保持原行为。这不是兼容层：messageId 在 schema 里
 * 本来就是可选的，client 必须能处理它不在的情况，而实现上也只是同一个条件里
 * 多一个合取项，没有第二条代码路径。
 */
function appendChunk(
  draft: Draft,
  type: 'agent_text' | 'agent_thought',
  update: AcpUpdateOf<'agent_message_chunk'> | AcpUpdateOf<'agent_thought_chunk'>,
  scope: string,
  seq: number,
  at: number,
): void {
  const chunk = textOf(update.content)
  /* 协议里「没报」是 undefined、「报了个空」是 null，对边界是同一件事；
     归一在这里做一次，模型里就只有「有号」和「没号」。 */
  const messageId = update.messageId ?? undefined
  const tail = draft.items.at(-1)

  if (tail && tail.type === type && !tail.sealed && sameMessage(tail, messageId)) {
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
    /* 缺席和「值为 undefined」在 exactOptionalPropertyTypes 下不是一回事。 */
    ...(messageId === undefined ? {} : { messageId }),
  } as AgentTextItem | AgentThoughtItem)
}

/**
 * 用户说的那一句，由若干块拼成。
 *
 * 协议发的是 chunk：一句话里的每一个 content block 各来一帧 —— 文字一帧，
 * 每张图各一帧。此前这里每收到一帧就推一条 user_message，于是「文字加一张图」
 * 在屏幕上是两条消息，其中一条永远是空的（textOf 对 image block 交回空串）。
 *
 * 更要紧的是它让「屏幕上有几条用户消息」与「这条对话问过几句话」成了两个数。
 * 附件的位置正是照着后者记的（见 attachImages 与迁移 0011），两个数一旦不等，
 * 整批图对不上位，一张都挂不上去 —— 那正是重启之后图片消失的原因。
 *
 * 所以连着来的 chunk 并成一条，与 agent 那半边（appendChunk）同一条规矩：
 * 中间插进任何别的条目，相邻就断了，那就是下一句话。
 *
 * 只并这条路径自己产的那些（id 前缀 user-）。发送时本地先上屏的那一条是
 * said-，agent 若把它原样回声一遍，那是两个来源说同一件事，不是一句话的
 * 两半 —— 并进去会把文字接成两遍。
 */
function appendSaid(draft: Draft, scope: string, seq: number, at: number, chunk: string): void {
  const tail = draft.items.at(-1)

  if (tail?.type === 'user_message' && tail.id.startsWith(`${scope}user-`)) {
    const grown: UserMessageItem = { ...tail, text: tail.text + chunk }

    draft.items[draft.items.length - 1] = grown

    return
  }

  push(draft, {
    type: 'user_message',
    id: `${scope}user-${String(seq)}`,
    at,
    text: chunk,
  })
}

/** 号缺席时不表态，退回相邻续写；号在，就必须是同一个号。 */
function sameMessage(
  tail: AgentTextItem | AgentThoughtItem,
  messageId: string | undefined,
): boolean {
  return messageId === undefined || messageId === tail.messageId
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

function isTerminal(status: ToolCallTimelineItem['status']): boolean {
  return status === 'completed' || status === 'failed'
}

function textOf(content: AcpContentBlock): string {
  return content.type === 'text' ? content.text : ''
}

/**
 * 两份说法，都留下。
 *
 * message 是运行时报的（连接断了、进程没了），diagnostics 是 agent 自己说的
 * （Authentication required、配额用尽）。此前有后者时就把前者丢掉 —— 而排查
 * 一次失败要的恰好是两者的关系。重复的不写两遍，不重复的一句不删。
 */
function preferAgent(message: string, diagnostics?: string): string {
  const said = diagnostics?.trim() ?? ''
  const ours = message.trim()

  if (said.length === 0) {
    return message
  }

  return ours.length === 0 || said.includes(ours) ? said : `${message}\n${said}`
}

/**
 * 一轮结束，却一个字都没有。
 *
 * 这是一个事实，不是一句话：自这一轮的提问以来，转录里没有任何可看的条目。
 * 空转必须被说出来 —— 界面沉默等于把「我到底发出去了吗」丢给人自己猜。
 *
 * 但说出来的只能是协议自己的词：stopReason 的原值。此前这件事由派生层凭一个
 * 状态枚举编一句话来报，那句话里没有多一个字的事实，却占掉了唯一那一行。
 * 措辞该删，事实不该跟着一起删。
 *
 * agent 自己留下了 diagnostics 时根本走不到这里：一件事只有一个说法。
 *
 * 判据向后扫到本轮的提问为止，代价是一轮的长度，不是整条对话的长度；
 * isRenderable 与派生共用同一份 —— 抄第二份就会有两种「空」。
 */
function silentTurn(draft: Draft, stopReason: AcpStopReason): string | undefined {
  for (let index = draft.items.length - 1; index >= 0; index -= 1) {
    const item = draft.items[index]

    if (item === undefined) {
      continue
    }

    if (item.type === 'user_message') {
      break
    }

    if (isRenderable(item)) {
      return undefined
    }
  }

  return `stopReason: ${stopReason}`
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
