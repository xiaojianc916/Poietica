/**
 * The ACP session vocabulary, re-exported from the official SDK.
 *
 * These names used to be transcribed by hand, right here, from the protocol
 * specification. A transcription is a second description of someone else's
 * protocol: it is only ever as fresh as the day it was typed, and it goes stale
 * in silence, because nothing fails when the protocol grows a variant we have
 * never heard of — the frame simply lands in a branch that does not exist.
 *
 * By the time this file was deleted, the hand-written copy carried eight
 * SessionUpdate variants. The protocol had thirteen. It was also missing
 * ContentChunk's messageId, which is how an agent tells us that two chunks
 * belong to the same message, and ToolCallUpdate's name.
 *
 * The Acp prefix stays. It is not a compatibility shim: it is this package
 * saying "this name belongs to the protocol, not to our product model", which
 * is the distinction run-contract.ts is built on. The types behind the prefix
 * are now upstream's, so they cannot drift.
 */

export type {
  AvailableCommand as AcpAvailableCommand,
  ContentBlock as AcpContentBlock,
  EmbeddedResourceResource as AcpEmbeddedResource,
  PermissionOption as AcpPermissionOption,
  PlanEntry as AcpPlanEntry,
  PlanEntryPriority as AcpPlanEntryPriority,
  PlanEntryStatus as AcpPlanEntryStatus,
  SessionId as AcpSessionId,
  SessionNotification as AcpSessionNotification,
  SessionUpdate as AcpSessionUpdate,
  StopReason as AcpStopReason,
  ToolCallContent as AcpToolCallContent,
  ToolCallId as AcpToolCallId,
  ToolCallLocation as AcpToolCallLocation,
  ToolCallStatus as AcpToolCallStatus,
  ToolCallUpdate as AcpToolCallUpdate,
  ToolKind as AcpToolKind,
} from '@agentclientprotocol/sdk'
