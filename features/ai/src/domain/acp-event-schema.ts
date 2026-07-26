import * as v from 'valibot'

import type { RunEvent } from '../contracts/run-contract'

/**
 * Boundary validation.
 *
 * Everything arriving from an agent is untrusted input, protocol or not. Nothing
 * reaches the reducer without passing through here, so a malformed frame becomes
 * a rejected event rather than a corrupted timeline.
 */

const contentBlockSchema = v.variant('type', [
  v.object({ type: v.literal('text'), text: v.string() }),
  v.object({ type: v.literal('image'), mimeType: v.string(), data: v.string() }),
  v.object({ type: v.literal('resource_link'), uri: v.string(), name: v.optional(v.string()) }),
  v.object({ type: v.literal('resource'), uri: v.string(), text: v.optional(v.string()) }),
])

/* ToolCallContent is a tagged envelope rather than a bare content block. The
   diff and terminal variants are accepted here even though no recording has
   produced one yet: they are in the specification, and a frame the boundary
   has never seen is exactly the frame that must not crash the feed. */
const toolCallContentSchema = v.variant('type', [
  v.object({ type: v.literal('content'), content: contentBlockSchema }),
  v.object({
    type: v.literal('diff'),
    path: v.string(),
    oldText: v.optional(v.nullable(v.string())),
    newText: v.string(),
  }),
  v.object({ type: v.literal('terminal'), terminalId: v.string() }),
])

const toolCallStatusSchema = v.picklist(['pending', 'in_progress', 'completed', 'failed'])

const toolKindSchema = v.picklist([
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'switch_mode',
  'other',
])

const locationSchema = v.object({ path: v.string(), line: v.optional(v.number()) })

const planEntrySchema = v.object({
  content: v.string(),
  status: v.picklist(['pending', 'in_progress', 'completed']),
  priority: v.picklist(['high', 'medium', 'low']),
})

const availableCommandSchema = v.object({
  name: v.string(),
  description: v.string(),
  input: v.optional(v.object({ hint: v.string() })),
})

export const sessionUpdateSchema = v.variant('sessionUpdate', [
  v.object({ sessionUpdate: v.literal('user_message_chunk'), content: contentBlockSchema }),
  v.object({ sessionUpdate: v.literal('agent_message_chunk'), content: contentBlockSchema }),
  v.object({ sessionUpdate: v.literal('agent_thought_chunk'), content: contentBlockSchema }),
  v.object({
    sessionUpdate: v.literal('tool_call'),
    toolCallId: v.string(),
    title: v.string(),
    kind: toolKindSchema,
    status: toolCallStatusSchema,
    content: v.optional(v.array(toolCallContentSchema)),
    locations: v.optional(v.array(locationSchema)),
    rawInput: v.optional(v.unknown()),
  }),
  v.object({
    sessionUpdate: v.literal('tool_call_update'),
    toolCallId: v.string(),
    title: v.optional(v.string()),
    kind: v.optional(toolKindSchema),
    status: v.optional(toolCallStatusSchema),
    content: v.optional(v.array(toolCallContentSchema)),
    locations: v.optional(v.array(locationSchema)),
    rawOutput: v.optional(v.unknown()),
  }),
  v.object({ sessionUpdate: v.literal('plan'), entries: v.array(planEntrySchema) }),
  v.object({ sessionUpdate: v.literal('current_mode_update'), currentModeId: v.string() }),
  v.object({
    sessionUpdate: v.literal('available_commands_update'),
    availableCommands: v.array(availableCommandSchema),
  }),
])

const permissionOptionSchema = v.object({
  optionId: v.string(),
  name: v.string(),
  kind: v.picklist(['allow_once', 'allow_always', 'reject_once', 'reject_always']),
})

export const runEventSchema = v.variant('kind', [
  v.object({
    kind: v.literal('run_started'),
    seq: v.number(),
    at: v.number(),
    sessionId: v.string(),
    prompt: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal('acp_update'),
    seq: v.number(),
    at: v.number(),
    notification: v.object({ sessionId: v.string(), update: sessionUpdateSchema }),
  }),
  v.object({
    kind: v.literal('permission_requested'),
    seq: v.number(),
    at: v.number(),
    requestId: v.string(),
    toolCallId: v.optional(v.string()),
    title: v.string(),
    options: v.array(permissionOptionSchema),
  }),
  v.object({
    kind: v.literal('permission_resolved'),
    seq: v.number(),
    at: v.number(),
    requestId: v.string(),
    optionId: v.string(),
    outcome: v.picklist(['selected', 'cancelled']),
  }),
  v.object({
    kind: v.literal('run_finished'),
    seq: v.number(),
    at: v.number(),
    stopReason: v.picklist(['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled']),
    /* Declared, not tolerated: an object schema keeps only what it names, so
       an undeclared field would be quietly stripped on the way in. */
    diagnostics: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal('run_failed'),
    seq: v.number(),
    at: v.number(),
    message: v.string(),
    diagnostics: v.optional(v.string()),
  }),
])

export type ParsedRunEvent =
  | { readonly ok: true; readonly event: RunEvent }
  | { readonly ok: false; readonly issue: string }

/** Never throws: a bad frame is a rejected frame, not a crashed surface. */
export function parseRunEvent(input: unknown): ParsedRunEvent {
  const result = v.safeParse(runEventSchema, input)
  if (!result.success) {
    const first = result.issues.at(0)
    return { ok: false, issue: first ? first.message : 'invalid run event' }
  }
  return { ok: true, event: result.output as RunEvent }
}
