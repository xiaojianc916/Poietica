import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import 'katex/dist/katex.min.css'
import { type AnimateOptions, type ControlsConfig, Streamdown } from 'streamdown'

import { cx } from '../primitives/class-names'

/*
 * 四个官方插件，一条管线。
 *
 * math 与 mermaid 的版本早已钉在 catalog 里，却从未被任何 package 引用：公式
 * 因此以原始字符出现，```mermaid 被 code 插件当作未知语言退化为纯文本。缺的
 * 不是能力，是这一行。
 */
const PLUGINS = { cjk, code, math, mermaid }

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
 * 取 blurIn 而非 fadeIn：一次提交里涌入十几个词时，纯 opacity 会让它们同时
 * 亮起，读者看到的是"一整块跳出来"而不是"一句话写出来"。官方 Animation 文档
 * 对快模型给的正是这一条 —— 模糊到清晰能盖住批量到达，opacity 盖不住。时长随
 * 之取 240ms，落在官方建议的 200–300ms 区间内。
 *
 * keyframes 由 timeline.css 自备：这个应用不引 streamdown 的样式表，动画名指向
 * 一个不存在的 keyframes 等于没有动画 —— 那一条与这一条必须同时成立。
 *
 * The plugin skips code, pre, svg and math itself, so a fence never flickers.
 */
const ANIMATION: AnimateOptions = {
  animation: 'blurIn',
  duration: 240,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
  sep: 'word',
  stagger: 18,
}

/*
 * Copying a snippet is an action; saving it as file.txt is not.
 *
 * Every group is named, including the ones being declined. An unnamed group is
 * not off: shouldShowTableControl reads an absent `table` as true, which is why
 * the table arrived carrying three buttons nobody chose.
 */
const CONTROLS: ControlsConfig = {
  code: { copy: true, download: false },
  table: { copy: true, download: false, fullscreen: true },
}

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
 *
 * A sealed entry is told so as well. Streaming mode exists to survive text that
 * is still arriving — block splitting, repair, a deferred transition — and none
 * of that is work a finished message needs done to it again on every render.
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
        mode={isStreaming ? 'streaming' : 'static'}
        parseIncompleteMarkdown={isStreaming}
        plugins={PLUGINS}
      >
        {text}
      </Streamdown>
    </div>
  )
}
