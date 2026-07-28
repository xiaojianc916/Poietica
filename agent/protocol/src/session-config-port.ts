import type { SessionConfigControl } from './session-config-contract'

/*
 * Where the selectors come from, as far as this feature is concerned.
 *
 * A selector belongs to a session, a session is held by a conversation,
 * and so every call names the conversation it is for. This is not part of
 * the model port and not part of the session port either: it is neither a
 * turn nor a configuration file. Selecting answers with the whole
 * list because the agent decides what the list looks like afterwards, and it
 * may refuse, rename, or withdraw a selector in the same breath.
 *
 * An empty list is a legitimate answer. It means the session has nothing to
 * offer, not that reading it failed.
 *
 * 参数不接受 null。一个不点名对话的问句在原生侧只能落到“第一个会话”，而调用
 * 方拿不到答案究竟是给谁的；没有对话时不问，是调用方的判断，不是这个端口的
 * 一种参数取值。入口那一格在出现时就持有对话，所以 null 不再是任何合法调用
 * 的形态。
 */

export interface SessionConfigPort {
  readonly list: (threadId: string) => Promise<readonly SessionConfigControl[]>
  readonly select: (
    threadId: string,
    configId: string,
    value: string,
  ) => Promise<readonly SessionConfigControl[]>
}
