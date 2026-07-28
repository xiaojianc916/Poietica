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
 * An empty list is a legitimate answer. It means no session is running yet,
 * not that the agent has nothing to offer.
 */

export interface SessionConfigPort {
  readonly list: (threadId: string | null) => Promise<readonly SessionConfigControl[]>
  readonly select: (
    threadId: string | null,
    configId: string,
    value: string,
  ) => Promise<readonly SessionConfigControl[]>
}
