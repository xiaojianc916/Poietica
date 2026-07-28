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
 * 这里没有"读"。选择器随会话一起交回来：打开一条对话（ThreadPort.open）时
 * agent 在 session/new 的答复里报了整张表，改一项时它又把改完的整张表报回来。
 * 曾经有过一个 list：它按对话去问原生侧，而原生侧只有在"本进程恰好握着这条
 * 对话的会话"时才答得出来，于是同一个选择器时而是空表（整块消失）、时而抛错
 * （那句「会话设置读取失败」）。把读这条路删掉，到达口就只剩下会话本身。
 */

export interface SessionConfigPort {
  readonly select: (
    threadId: string,
    configId: string,
    value: string,
  ) => Promise<readonly SessionConfigControl[]>
}
