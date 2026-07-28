import type { AgentSessionPort } from '@poietica/agent-protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSharedThreads } from '../../application/ai/threads-context'
import { ConversationSurface } from './ConversationSurface'

/*
 * AI 表面：还没有指向任何一条已有对话的那一格，也就是“新建对话”。
 *
 * 它一出现就开一条对话，也就同时开一个 agent 会话（ACP 的 session/new）。
 * 这不是提前，而是必须：能选哪些模型、哪些模式、哪一档思考，只有正在跑的会话
 * 说得出来，session/new 的应答里就带着它们。把会话推到第一句话之后，等于把
 * “能选什么”也推到第一句话之后 —— Zed 的 agent panel、Copilot Chat、Cursor
 * 都不是这样：模型就在输入框左下角，开口之前可看可改。
 *
 * 开了又走开不会留下垃圾。list_threads 只认有过 run 的对话（threads.rs 里的
 * WHERE EXISTS (SELECT 1 FROM runs ...)），所以一条没人说过话的对话既不进
 * 侧边栏也不进标签条 —— 这层保护在数据库那一侧，不需要靠推迟开会话来换。
 *
 * 它仍然不预支身份：id 由平台给出，拿到了才用。此前是挂载时先用一个占位 id
 * 顶着，占位 id 会漏进名字、标签和 prompt，而它对应的对话并不存在。
 *
 * 说出第一句话之后这一格就不再是“新建对话”了：它当场变成那条对话，标签标题、
 * 侧边栏那一行的高亮都由工作台的同一次 openConversation 得出。
 */

export interface AssistantPaneProps {
  readonly onConversationStarted: (threadId: string, title: string) => void
  readonly session: AgentSessionPort
}

export function AssistantPane({ onConversationStarted, session }: AssistantPaneProps) {
  const threads = useSharedThreads()
  const open = threads.create
  const [threadId, setThreadId] = useState<string | null>(null)
  const opening = useRef<Promise<string | null> | null>(null)

  /*
   * 一格只开一条对话，哪怕连着说两句。
   *
   * 第二次问等的是第一次那个 promise，所以不会开出两条对话，也不会有两条
   * 都自称是这一格。
   */
  const identify = useCallback(async (): Promise<string | null> => {
    opening.current ??= open()

    const opened = await opening.current

    if (opened !== null) {
      setThreadId(opened)
    }

    return opened
  }, [open])

  /*
   * 一出现就去开。
   *
   * identify 自己保证只开一条（opening.current ??=），所以第一句话问到的仍是
   * 同一个 id，开会话的动作全仓有且只有那一处。开不出来时 threadId 留在 null，
   * 选择器就是空的，而失败在第一句话时如实说出来 —— 什么都没做就先弹一句读取
   * 失败，是上一轮已经拆掉的做法。
   */
  useEffect(() => {
    void identify()
  }, [identify])

  return (
    <ConversationSurface
      onIdentify={identify}
      onStarted={onConversationStarted}
      session={session}
      threadId={threadId}
    />
  )
}
