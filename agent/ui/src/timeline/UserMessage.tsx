import { useState } from 'react'

/*
 * A long message is clipped, and the clip can be released.
 *
 * A nested scroller inside a scrolling transcript is the wrong answer twice: it
 * traps the wheel, and it hides where the message ends. Clipping with a fade
 * says the same thing and leaves exactly one scrollbar on screen.
 *
 * Whether to clip is decided from the text, not from the layout. One value
 * drives both the clamp and the control, so a button can never appear over a
 * message that was never clipped — the two cannot disagree.
 */
const CLAMP_CHARS = 420
const CLAMP_LINES = 9

function isLong(text: string): boolean {
  return text.length > CLAMP_CHARS || text.split('\n').length > CLAMP_LINES
}

/**
 * What the person said, exactly as they typed it.
 *
 * Never markdown: rendering a user message would let their own text change how
 * it is displayed, and would let a pasted document rewrite the conversation.
 */
export function UserMessage({ text }: { readonly text: string }) {
  const [expanded, setExpanded] = useState(false)
  const long = isLong(text)

  return (
    <div className="timeline-user" data-clamped={long && !expanded ? 'true' : undefined}>
      <p className="timeline-user__text">{text}</p>

      {long ? (
        <button
          className="timeline-user__more"
          onClick={() => {
            setExpanded(!expanded)
          }}
          type="button"
        >
          {expanded ? '收起' : '展开全部'}
        </button>
      ) : null}
    </div>
  )
}
