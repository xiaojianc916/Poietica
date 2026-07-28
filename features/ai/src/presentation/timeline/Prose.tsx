import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { type AnimateOptions, type ControlsConfig, Streamdown } from 'streamdown'

import { cx } from '../primitives/class-names'

/*
 * Plugins are declared once, at module scope.
 *
 * Streamdown reads this object on every render, and a fresh object per frame
 * would defeat its memoisation mid-stream.
 *
 * math and mermaid are installed but not wired: math additionally requires
 * katex's stylesheet, which this workspace does not resolve.
 */
const PLUGINS = { cjk, code }

/*
 * How arriving text is revealed.
 *
 * A word at a time, not a character: for Chinese a word is already close to a
 * character, and per-character spans multiply the node count of a long answer
 * for no visible gain.
 *
 * The stagger has to be shorter than the gap between tokens from the model, or
 * the queue of waiting words grows and the reveal falls behind the text it is
 * revealing. Fading is the only property here that stays off the layout: blurIn
 * is a filter per word, and slideUp shifts each word into place, which makes a
 * paragraph twitch as it fills.
 *
 * The plugin skips code, pre, svg and math itself, so a fence never flickers.
 */
const ANIMATION: AnimateOptions = {
  animation: 'fadeIn',
  duration: 220,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
  sep: 'word',
  stagger: 18,
}

/*
 * Copying a snippet is an action; saving it as file.txt is not. Declared here
 * rather than hidden in CSS, so the button is never rendered in the first place.
 */
const CONTROLS: ControlsConfig = { code: { copy: true, download: false } }

export interface ProseProps {
  readonly text: string
  readonly isStreaming: boolean
  /** A place in the timeline, for measure and scale. Never for typography. */
  readonly className?: string
}

/**
 * Markdown from the model, wherever it appears.
 *
 * The answer and the thought chain are the same kind of content — a markdown
 * stream, half written until it is not — so they are rendered by one component
 * rather than by two that drift apart. `timeline-prose` is the single scope the
 * stylesheet dresses, which is why a fenced block inside the thinking already
 * looks like a fenced block inside the answer.
 *
 * While text is still arriving Streamdown is told so twice, because it asks
 * twice: parseIncompleteMarkdown closes the open constructs so a lone fence
 * cannot swallow the rest, and isAnimating is what actually admits the animate
 * plugin — `animated` alone does nothing without it.
 *
 * Line numbers and the download control are turned off through the props that
 * govern them. Overriding rendered output from a stylesheet works until the
 * markup moves; declining to render it does not.
 */
export function Prose({ className, isStreaming, text }: ProseProps) {
  return (
    <div
      className={cx('timeline-prose', className)}
      data-streaming={isStreaming ? 'true' : undefined}
    >
      <Streamdown
        animated={ANIMATION}
        controls={CONTROLS}
        isAnimating={isStreaming}
        lineNumbers={false}
        parseIncompleteMarkdown={isStreaming}
        plugins={PLUGINS}
      >
        {text}
      </Streamdown>
    </div>
  )
}
