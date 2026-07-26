/**
 * What the person said, exactly as they typed it.
 *
 * Never markdown: rendering a user message would let their own text change how
 * it is displayed, and would let a pasted document rewrite the conversation.
 */
export function UserMessage({ text }: { readonly text: string }) {
  return <p className="timeline-user">{text}</p>
}
