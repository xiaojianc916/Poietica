import { AgentDisclosure } from './AgentDisclosure'
import { AgentMarkdown } from './AgentMarkdown'

/*
 * Speaks ACP directly. The four statuses below are the ones the protocol
 * defines for tool calls, so no translation layer is needed and no state can
 * arrive that this component has not been told about.
 */

export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

const STATUS_LABEL: Record<ToolCallStatus, string> = {
  completed: 'Completed',
  failed: 'Failed',
  in_progress: 'Running',
  pending: 'Pending',
}

const TONE: Record<ToolCallStatus, 'default' | 'running' | 'failed'> = {
  completed: 'default',
  failed: 'failed',
  in_progress: 'running',
  pending: 'default',
}

const FENCE = String.fromCharCode(96).repeat(3)

const asJsonBlock = (value: unknown) => {
  try {
    return FENCE + 'json\n' + JSON.stringify(value, null, 2) + '\n' + FENCE
  } catch {
    return FENCE + '\n' + String(value) + '\n' + FENCE
  }
}

export type ToolCallCardProps = {
  defaultOpen?: boolean
  errorText?: string
  input?: unknown
  output?: unknown
  status: ToolCallStatus
  title: string
}

export const ToolCallCard = ({
  defaultOpen = false,
  errorText,
  input,
  output,
  status,
  title,
}: ToolCallCardProps) => (
  <AgentDisclosure
    defaultOpen={defaultOpen || status === 'failed'}
    summary={
      <span className="agent-tool__summary">
        <span className="agent-tool__dot" data-status={status} />
        <span className="agent-tool__name">{title}</span>
        <span className="agent-tool__status">{STATUS_LABEL[status]}</span>
      </span>
    }
    tone={TONE[status]}
  >
    <div className="agent-tool__body">
      {input === undefined ? null : (
        <section className="agent-tool__section">
          <h4 className="agent-tool__heading">Input</h4>
          <AgentMarkdown>{asJsonBlock(input)}</AgentMarkdown>
        </section>
      )}
      {errorText === undefined ? null : (
        <section className="agent-tool__section" data-variant="error">
          <h4 className="agent-tool__heading">Error</h4>
          <p className="agent-tool__error">{errorText}</p>
        </section>
      )}
      {output === undefined ? null : (
        <section className="agent-tool__section">
          <h4 className="agent-tool__heading">Output</h4>
          <AgentMarkdown>{typeof output === 'string' ? output : asJsonBlock(output)}</AgentMarkdown>
        </section>
      )}
    </div>
  </AgentDisclosure>
)
