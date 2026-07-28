/*
 * What the composer shows about a run.
 *
 * RunStatus in run-contract.ts is the truth about the run itself: six states
 * the agent and the client can genuinely be in. ChatStatus is coarser on
 * purpose — it is the four states a send button can render, and nothing more.
 *
 * It lives here rather than next to the button because the application layer
 * derives it and the presentation layer displays it. Both may depend on a
 * contract; neither may depend on the other. Collapsing RunStatus into
 * ChatStatus is an application decision and stays in useAssistantSession.
 */
export type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'
