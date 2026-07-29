import type { AgentSessionPort, ChatStatus, RunEvent } from '@poietica/agent-protocol'
import type { TimelineState } from '@poietica/agent-timeline'
import {
  appendUserMessage,
  applyRunEvent,
  createTimelineState,
  replayThreadEvents,
} from '@poietica/agent-timeline'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/*
 * The surface depends on the agent session PORT, never on a protocol client.
 *
 * The port is implemented in Rust behind typed IPC: it owns the ACP client, the
 * agent subprocess and every credential. Rendering the AI surface must not
 * require any of that to exist, so the default is an inert stub and the UI stays
 * fully developable against recorded fixtures.
 *
 * What the user said is not part of that arrangement. It is committed locally
 * and shown immediately; the run that follows is a segment appended to the same
 * transcript. A turn that fails therefore loses its answer, never the question,
 * and a second turn is added to the conversation instead of replacing it.
 */

export interface AssistantSubmission {
  readonly text: string
  readonly files: readonly File[]
}

export interface AssistantSessionOptions {
  /**
   * Thread this surface is bound to, or null before it has become one.
   *
   * 入口那一格还不是任何一条对话：没有可回放的记录，也没有名字。
   */
  readonly endpoint: string | null
  /**
   * Acquires the conversation this surface is about to become.
   *
   * 只在第一句话时问一次。要不到就没有地方可送，这一句因此失败，
   * 而不是发往一个不存在的对话。
   */
  readonly identify?: (() => Promise<string | null>) | undefined
  /**
   * What the user just said, before the agent is asked anything.
   *
   * The conversation list names a conversation from its first message,
   * and the list is not this hook to keep, so the fact is handed out
   * rather than reached for.
   */
  readonly onUserMessage?: ((threadId: string, text: string) => void) | undefined
  readonly session?: AgentSessionPort | undefined
}

export interface AssistantSession {
  readonly status: ChatStatus
  readonly timeline: TimelineState
  readonly send: (submission: AssistantSubmission) => void
  readonly cancel: () => void
  readonly resolvePermission: (requestId: string, optionId: string) => void
  /** True while a conversation is still being read out of the log. */
  readonly isRestoring: boolean
  /**
   * 人读到了这段历史的上边界。
   *
   * 界面报告的是位置，不是意图：上面还有没有、要不要现在去读、读多少，全部
   * 由这里回答。滚动每一帧都可能报一次，所以它是幂等的，调用方不必节流。
   */
  readonly reachStart: () => void
}

const RUN_PLACEHOLDER = 'run_pending'

/*
 * 一条对话打开时读多少轮，以及向上续读一次往前推多少。
 *
 * 原生那侧有同一个默认值，两处都写不是重复：宽度是界面的决定，那边的只是
 * 没人交代时的兜底。往前推是加一段而不是翻倍——续读是人向上滚出来的，代价
 * 应当与他滚过的距离成正比，而不是每读一次就翻一番。
 */
const WINDOW_RUNS = 40
const WINDOW_STEP = 40

/*
 * What has already been read out of the log, per conversation.
 *
 * Frames are immutable history, so coming back to a conversation must not
 * go blank and then fill in: the snapshot from the last read is shown in
 * the same commit as the switch, and the fresh read replaces it silently
 * when it lands. Module scope, so it outlives a surface unmounted with its
 * tab.
 */
/*
 * 打开过的对话，记住的是回放结果而不是原始帧。
 *
 * 缓存原始帧只省掉一次查询，最贵的那一步——把成千上万帧 reduce 成转录——
 * 每次回到这条对话都要重跑一遍，而且跑在点击那一帧上。记住结果之后，一条
 * 对话在一次运行里最多 reduce 一次，回访是一次 Map 查找。
 *
 * 上限存在是因为转录会长：最近开过的几条留着，更早的让位。
 */
const RESTORED_LIMIT = 8

/** 打开过的一条对话：读出来的转录、读到多宽、一共有多少轮。 */
interface Restored {
  readonly timeline: TimelineState
  /** 这份转录是按多少轮读出来的。 */
  readonly width: number
  /** 这条对话一共有多少轮。 */
  readonly totalRuns: number
}

const restored = new Map<string, Restored>()

function remember(endpoint: string, held: Restored): Restored {
  restored.delete(endpoint)
  restored.set(endpoint, held)

  if (restored.size > RESTORED_LIMIT) {
    const oldest = restored.keys().next().value

    if (oldest !== undefined) {
      restored.delete(oldest)
    }
  }

  return held
}

/*
 * What the user is told when a run never started.
 *
 * The native side keeps its own detail on its own side of the wire, so this is
 * a fallback for a rejection that carries no message at all.
 */
const FAILURE_FALLBACK = '助手无法启动，或与它的连接已中断。'

/*
 * A surface with no port is a composition mistake, not a mode of operation.
 * Swallowing the submission would make the message vanish with no explanation,
 * which is exactly the failure this round exists to remove.
 */
const NO_SESSION = '这个界面还没有接上助手会话，消息没有发送出去。'

/*
 * 开一条对话失败了，所以这一句没有地方可去。
 *
 * 入口那一格在第一句话时才向平台要一条对话；要不到就不能假装要到了，
 * 更不能发往一个占位的名字。
 */
const NO_THREAD = '无法开始新的对话，消息没有发送出去。'

function describeFailure(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message
  }
  if (typeof cause === 'string' && cause.length > 0) {
    return cause
  }
  return FAILURE_FALLBACK
}

export function useAssistantSession({
  endpoint,
  identify,
  onUserMessage,
  session,
}: AssistantSessionOptions): AssistantSession {
  const [timeline, setTimeline] = useState<TimelineState>(() => opening(endpoint))
  const [shown, setShown] = useState(endpoint)
  const [isRestoring, setIsRestoring] = useState(() => endpoint !== null && !restored.has(endpoint))
  const [width, setWidth] = useState(() => widthOf(endpoint))
  const cancelRef = useRef<(() => Promise<void>) | undefined>(undefined)
  /*
   * 第几次读。
   *
   * 此前挡住过期结果用的是闭包里的一个布尔（let current）。它只让晚到的
   * 结果不落进 state，读本身照跑不误：在列表里连着点五条对话，就是五份
   * 全量回放同时在飞，而其中四份的结果从一开始就注定要被丢掉。代际号是
   * 一个跨渲染的事实而不是每个 effect 各揣一份的布尔，谁是最后一次一目
   * 了然。
   */
  const reading = useRef(0)
  /*
   * 这一格自己开出来的那条对话。
   *
   * 认领是一个意图，不是一个形状。它此前被写成"上一帧 endpoint 是 null"——
   * 而为一条已有对话挂载、id 比首帧晚到时，形状一模一样，意图恰好相反：那次
   * 是要去读的，跳过它就等于把界面留在起始态，把开场白画给一个明明有历史的
   * 对话看。
   *
   * identify() 只在 send 里问一次，所以这个意图有唯一且确定的产生点。记在
   * 这里，而不是从 timeline 的形状去反推——转录里有没有东西是另一件事，它
   * 回答不了"这条对话是谁开的"。
   */
  const claimed = useRef<string | null>(null)

  /*
   * The conversation on screen changes during render, not a paint later.
   *
   * Adjusting state while rendering is the answer React itself gives for
   * state derived from a prop. The alternative is an effect, and an effect
   * runs after the browser has already painted the conversation the user
   * left under the tab of the one they chose. That paint is the flicker,
   * and no amount of easing hides it.
   */
  if (shown !== endpoint) {
    /*
     * 认领身份不是换对话。
     *
     * 入口那一格说出第一句之后才知道自己是哪条对话，而那句话此刻已经在
     * 屏幕上了；把这当成一次切换会把它连同已经流进来的回答一起擦掉。
     * 真正的切换是从一条已知对话走到另一条。
     */
    const claiming = shown === null && claimed.current === endpoint

    setShown(endpoint)

    if (!claiming) {
      /* 走到另一条对话上，认领这件事就过去了：再回来时它和别的对话一样，
         该从日志里读出来。留着这个 ref 会让那次回访跳过读取，看到一份空的
         转录。 */
      claimed.current = null

      setTimeline(opening(endpoint))
      setIsRestoring(endpoint !== null && !restored.has(endpoint))
      /* 换一条对话，也换回它自己上次读到的宽度。 */
      setWidth(widthOf(endpoint))
    }
  }

  useEffect(() => {
    if (!session) {
      return undefined
    }
    return session.subscribe((event: RunEvent) => {
      setTimeline((current) => applyRunEvent(current, event))
    })
  }, [session])

  /*
   * A failure the log never saw.
   *
   * Spawning the agent, or answering a question it no longer waits for, fails
   * before anything durable exists, so there is no frame to replay. The reducer
   * already knows how to render a failed run, so the fact is handed to it as
   * the run_failed event it is rather than by reaching into the state shape.
   */
  const fail = useCallback((cause: unknown) => {
    setTimeline((current) =>
      applyRunEvent(current, {
        kind: 'run_failed',
        seq: current.lastSeq + 1,
        at: Date.now(),
        message: describeFailure(cause),
      }),
    )
  }, [])

  /*
   * Switching conversation is reading one.
   *
   * The transcript on screen belongs to a conversation, so a different
   * endpoint means a different conversation has to be read out of the log
   * rather than an empty one shown. The frames are the ones that were
   * broadcast while each turn was live, so reopening a conversation cannot
   * disagree with having watched it.
   *
   * An answer that arrives after the endpoint moved on is dropped: it
   * belongs to the conversation the user has already left.
   */
  useEffect(() => {
    reading.current += 1

    if (endpoint === null || session?.loadThread === undefined) {
      setIsRestoring(false)

      return undefined
    }

    /*
     * 自己认领的那条，日志里没有它没有的东西。
     *
     * 下面那个 effect 的注释说得对：历史只有这里在写。既然这个进程是唯一
     * 写入方，而这条对话是这一格刚刚开出来的，那么它此刻的全部历史就在屏幕
     * 上——这次读取读回来的至多是同一份，至少可能是一份还没记全的，而它会
     * 覆盖正在直播的转录，连人刚说的那句话一起。
     */
    if (claimed.current === endpoint) {
      setIsRestoring(false)

      return undefined
    }

    /*
     * 读过的对话不再读第二遍。
     *
     * 上面那个 Map 一直号称"回访是一次 Map 查找"，但它此前只决定首帧画
     * 什么：紧接着这里照样发一次 IPC、逐帧校验、把成千上万帧重新 reduce
     * 一遍，然后用一个和屏幕上一模一样的转录覆盖它。命中与否，代价一分
     * 不少，而它落在点击那一帧上。
     *
     * 帧是不会变的历史，而这个进程是它唯一的写入方：这一轮说的话由订阅
     * 送进同一份转录，下面那个 effect 让它留在原处。所以回到一条打开过的
     * 对话，正确的做法是把它拿出来。
     */
    const held = restored.get(endpoint)

    if (held !== undefined && held.width >= width) {
      setIsRestoring(false)

      return undefined
    }

    const mine = reading.current

    void session
      .loadThread(endpoint, width)
      .then((read) => {
        if (reading.current !== mine) {
          return
        }

        /* 更宽的一段是同一条管线读出来的同一种东西：整段重放，而不是把
           更早的部分拼到手上这份的前面。拼接要处理轮次编号、身份命名空间
           和两段之间的接缝，那是第二条回放路径，也是两条路径迟早对不上的
           地方。重放一次多花几毫秒，只发生在人真的向上读到边界的时候。 */
        setTimeline(
          remember(endpoint, {
            timeline: replayThreadEvents(RUN_PLACEHOLDER, read.events),
            totalRuns: read.totalRuns,
            width,
          }).timeline,
        )
        setIsRestoring(false)
      })
      .catch((cause: unknown) => {
        if (reading.current !== mine) {
          return
        }

        setIsRestoring(false)
        fail(cause)
      })

    return () => {
      reading.current += 1
    }
  }, [endpoint, fail, session, width])

  /*
   * 这一轮说的话，留在读过的那份转录里。
   *
   * 缓存此前只在读完那一刻写一次，之后整轮对话都流进 state 却没有回到
   * 缓存里：离开再回来时它是过期的——而正因为它过期，上面那次无条件重读
   * 才显得"必要"。两件事是一个因果，所以一起解决。历史只有这里在写，
   * 把它留下就够了。
   */
  useEffect(() => {
    const held = endpoint === null ? undefined : restored.get(endpoint)

    if (endpoint === null || held === undefined) {
      return
    }

    remember(endpoint, { ...held, timeline })
  }, [endpoint, timeline])

  const send = useCallback(
    (submission: AssistantSubmission) => {
      const at = Date.now()

      /* The question is on screen before anything is asked of the agent. */
      setTimeline((current) => appendUserMessage(current, submission.text, at))

      if (!session) {
        fail(new Error(NO_SESSION))

        return
      }

      /*
       * 先有身份，再有这一轮。
       *
       * 入口那一格在这一刻才成为一条对话，所以名字、标签和 prompt 拿到的
       * 是同一个真 id。此前它在挂载时就预支一个占位 id：抢在会话开出来之前
       * 发出的第一句，会在列表里留下一条永远无人认领的记录，把标签开在一条
       * 不存在的对话上，并在真 id 到达时被从屏幕上清空。
       */
      const conversation =
        endpoint === null ? (identify?.() ?? Promise.resolve(null)) : Promise.resolve(endpoint)

      void conversation
        .then((threadId) => {
          if (threadId === null) {
            fail(new Error(NO_THREAD))

            return undefined
          }

          /* 这一条是这一格开出来的。下一次渲染里 endpoint 变成它，那不是
             一次切换——同步记在这里，因为紧接着的 onUserMessage 就会让上层把
             它交回来。 */
          claimed.current = threadId

          /* The list names a conversation from this, which is why it leaves
             before the turn does: a turn that fails was still asked. */
          onUserMessage?.(threadId, submission.text)

          return session.prompt({ threadId, text: submission.text }).then((handle) => {
            cancelRef.current = handle.cancel

            /* The turn now has a real identity, which is what replaying it from
               the log will need. */
            setTimeline((current) =>
              current.runId === handle.runId ? current : { ...current, runId: handle.runId },
            )
          })
        })
        .catch((cause: unknown) => {
          fail(cause)
        })
    },
    [endpoint, fail, identify, onUserMessage, session],
  )

  const cancel = useCallback(() => {
    void cancelRef.current?.()
  }, [])

  /*
   * The answer is not applied locally. The native side records it and emits
   * permission_resolved, which the reducer applies like any other event, so a
   * replayed run and a live run agree.
   *
   * A rejected call means the agent never heard the answer and the turn cannot
   * continue, which is a failed run rather than a silent stall.
   */
  const resolvePermission = useCallback(
    (requestId: string, optionId: string) => {
      if (!session) {
        return
      }

      session.resolvePermission(requestId, optionId).catch((cause: unknown) => {
        fail(cause)
      })
    },
    [fail, session],
  )

  /*
   * 读到上边界这件事，只有一个后果：把窗口往前推一段。
   *
   * 它没有伴随的界面。一条对话的历史不是一个需要人去"打开"的东西，它就是这
   * 条对话本身；按钮的存在等于承认"上面还有一段我没给你"。人向上读，更早的
   * 部分就已经在那里了 —— 这也是所有以对话为主体的专业软件在这里的做法。
   *
   * 三道闸门都在这一处，而且都是事实，不是标志位：
   *   - 还没读出来过，就不知道有没有更早的；
   *   - totalRuns 是原生那侧数出来的，到底了就是到底了，不从帧数去猜；
   *   - 缓存里的宽度还没赶上要的宽度，说明上一段还在飞。
   * 所以滚动每一帧都调它是安全的：不需要节流，不需要防抖，也不需要一个
   * "正在加载"的状态给别人看 —— 没有人在等，读回来的那一段落在视口之上。
   */
  const reachStart = useCallback(() => {
    if (endpoint === null) {
      return
    }

    setWidth((current) => {
      const held = restored.get(endpoint)

      if (held === undefined || held.totalRuns <= held.width || held.width < current) {
        return current
      }

      return current + WINDOW_STEP
    })
  }, [endpoint])

  const status = useMemo<ChatStatus>(() => toChatStatus(timeline.status), [timeline.status])

  return {
    status,
    timeline,
    send,
    cancel,
    resolvePermission,
    isRestoring,
    reachStart,
  }
}

/** The transcript a conversation opens with: its last read, or an empty one. */
function opening(threadId: string | null): TimelineState {
  const held = threadId === null ? undefined : restored.get(threadId)

  /* 回放结果，无需重算。 */
  return held === undefined ? createTimelineState(RUN_PLACEHOLDER) : held.timeline
}

/** 这条对话上次读到多宽；没打开过就是默认窗口。 */
function widthOf(threadId: string | null): number {
  const held = threadId === null ? undefined : restored.get(threadId)

  return held?.width ?? WINDOW_RUNS
}

function toChatStatus(status: TimelineState['status']): ChatStatus {
  switch (status) {
    case 'running':
    case 'awaiting_permission':
      return 'streaming'
    case 'failed':
      return 'error'
    default:
      return 'ready'
  }
}
