import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import 'katex/dist/katex.min.css'
import {
  type AnimateOptions,
  type ControlsConfig,
  Streamdown,
  type StreamdownTranslations,
} from 'streamdown'

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
  // controls 的默认值是 true，未具名的组按全开处理 —— mermaid 此前白得一个
  // 与 code/table 口径相反的下载按钮，同时漏掉了本该要的 panZoom。
  mermaid: { copy: true, download: false, fullscreen: true, panZoom: true },
  table: { copy: true, download: false, fullscreen: true },
}

/*
 * 控件与弹窗的中文标签。
 *
 * 上游的 37 个键默认全是英文（defaultTranslations），落在一个整体中文的界面上
 * 就是半句英文半句中文。translations 收的是 Partial，没写的键继续用英文默认值,
 * 所以这里只译真正会出现的那些 —— download 那一组全部关掉了，不译。
 *
 * 外链弹窗的六个键必须在场：linkSafety 默认就是开的（官方 Link Safety 文档逐字
 * 「enabled by default」），点任何链接都会弹它出来。在这个 webview 里它暂时还不
 * 能关 —— 关掉之后链接会在应用内导航，把整个界面替换成网页。接管外链是下一刀，
 * 在那之前它至少该说中文。
 */
const TRANSLATIONS: Partial<StreamdownTranslations> = {
  copied: '已复制',
  copyCode: '复制代码',
  copyLink: '复制链接',
  copyTable: '复制表格',
  copyTableAsCsv: '复制为 CSV',
  copyTableAsMarkdown: '复制为 Markdown',
  copyTableAsTsv: '复制为 TSV',
  exitFullscreen: '退出全屏',
  externalLinkWarning: '即将打开外部网站。',
  imageNotAvailable: '图片无法显示',
  openExternalLink: '打开外部链接？',
  openLink: '打开链接',
  viewFullscreen: '全屏查看',
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
 * 流式期间只需要说一次。parseIncompleteMarkdown 的默认值就是 true，而静态模式
 * 整个跳过未完成标记的修补（官方 Usage 的 How Static Mode Works 逐字）—— 显式
 * 写成 {isStreaming}，两种状态得到的都是它本来的行为，只是多一个真值来源。
 *
 * isAnimating 才是真正放行 animate 插件的那一个：animated 单独在场什么也不做。
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
        plugins={PLUGINS}
        translations={TRANSLATIONS}
      >
        {text}
      </Streamdown>
    </div>
  )
}
