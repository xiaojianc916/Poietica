/*
 * 这个包的唯一出口。
 *
 * timeline/ 把 ACP 事件投影成可渲染的时间线：纯函数，没有 React，能在 Node 里
 * 直接单测。session/ 在它上面管线程、转录、可调项与能力表。两段是同一条管线的
 * 前后半，边界留在包内的目录上；timeline/ 的纯度由 timeline-projection-stays-pure
 * 守着，不再靠一份单独的 manifest。
 */

export type {
  AssistantSession,
  AssistantSessionOptions,
  AssistantSubmission,
  ThreadListItem,
  ThreadsList,
  ThreadsStoreOptions,
  ThreadWorkspaceGroup,
  ThreadWorkspaceList,
  TranscriptSink,
} from './session'
export {
  chooseAgentControl,
  DEFAULT_WORKSPACE_ID,
  groupByWorkspace,
  installAgentCapabilityPort,
  refreshAgentCapabilities,
  shorten,
  ThreadsStore,
  TranscriptStore,
  TranscriptsContext,
  useAgentControls,
  useAssistantPending,
  useAssistantPendingCount,
  useAssistantSession,
  useAssistantTimeline,
  useTranscripts,
  workspaceIdOf,
  workspaceNameOf,
} from './session'
export type {
  AgentTextItem,
  AgentThoughtItem,
  ConversationTurn,
  ErrorItem,
  FeedRow,
  MessageImage,
  PermissionItem,
  PlanItem,
  ReplayedAttachment,
  TimelineItem,
  TimelineItemId,
  TimelineState,
  ToolCallTimelineItem,
  UserMessageItem,
} from './timeline'
export {
  appendLocalError,
  appendUserMessage,
  applyRunEvent,
  applyRunEvents,
  attachImages,
  attachImagesTo,
  createTimelineState,
  pendingPermission,
  pendingPermissionCount,
  replayRunEvents,
  replayThreadEvents,
  selectFeedRows,
  selectIsBusy,
  selectIsWaiting,
  selectTurns,
} from './timeline'
