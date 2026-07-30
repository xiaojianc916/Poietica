/**
 * The interface admitting that it is still listening.
 *
 * Not a timeline entry: nothing happened yet, so there is nothing to record.
 * It is derived from the run being open with no answer in it, it lives outside
 * the virtualised transcript, and it disappears the moment a real frame arrives.
 */
export function ThinkingIndicator() {
  return (
    <p className="timeline-pending" role="status">
      <span aria-hidden="true" className="timeline-pending__dot" />
      <span aria-hidden="true" className="timeline-pending__dot" />
      <span aria-hidden="true" className="timeline-pending__dot" />
      <span className="assistant-visually-hidden">助手正在思考</span>
    </p>
  )
}
