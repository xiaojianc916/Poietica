import { AgentDisclosure } from './AgentDisclosure'

/*
 * Mirrors an ACP plan update, which is always a full replacement rather than
 * a patch, so this component holds no state of its own.
 */

export type PlanEntryStatus = 'pending' | 'in_progress' | 'completed'

export type PlanEntry = {
  content: string
  id: string
  status: PlanEntryStatus
}

export type PlanPanelProps = {
  entries: readonly PlanEntry[]
}

export const PlanPanel = ({ entries }: PlanPanelProps) => {
  const done = entries.filter((entry) => entry.status === 'completed').length

  return (
    <AgentDisclosure
      defaultOpen
      summary={
        <span className="agent-plan__summary">
          Plan · {done}/{entries.length}
        </span>
      }
    >
      <ol className="agent-plan__list">
        {entries.map((entry) => (
          <li className="agent-plan__item" data-status={entry.status} key={entry.id}>
            {entry.content}
          </li>
        ))}
      </ol>
    </AgentDisclosure>
  )
}
