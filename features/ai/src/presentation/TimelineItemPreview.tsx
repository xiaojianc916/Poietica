import type { FeedRow } from '../domain/timeline-selectors'

/**
 * TEMPORARY renderer.
 *
 * This exists so the feed is verifiable end to end today. It is replaced in the
 * next step by the vendored AI Elements output components (response, reasoning,
 * tool, task) rendered through Streamdown. Do not grow styling here.
 */
export function TimelineItemPreview({ row }: { readonly row: FeedRow }) {
  const { item } = row

  switch (item.type) {
    case 'user_message':
      return <p data-role="user">{item.text}</p>

    case 'agent_text':
      return <p data-role="assistant">{item.text}</p>

    case 'agent_thought':
      return <p data-role="reasoning">{item.text}</p>

    case 'tool_call':
      return (
        <p data-role="tool" data-status={item.status}>
          {item.kind} · {item.title} · {item.status}
        </p>
      )

    case 'plan':
      return (
        <ul data-role="plan">
          {item.entries.map((entry) => (
            <li key={entry.content}>
              {entry.status} · {entry.content}
            </li>
          ))}
        </ul>
      )

    case 'permission':
      return <p data-role="permission">{item.title}</p>

    case 'error':
      return <p data-role="error">{item.message}</p>

    default:
      return null
  }
}
