/*
 * 已经写完的那一段，和还在写的那一段。
 *
 * 流式 markdown 的代价不在「解析一次要多久」，在「同一段文本要被解析多少次」。
 * 一段思考链上屏时，整篇文本每一次刷新都被重新交给解析器一次 —— 第 n 帧解析 n 个
 * token，一轮下来是 O(n²)，而 n 是这条思考链的长度。屏幕上看到的就是：字先流得很
 * 顺，越往后越黏，最后停几秒。
 *
 * 行业标杆没有一个是这么做的。VS Code 的 chat 只重画尾部那一个未闭合块，Zed 的
 * acp_thread 把 markdown 按块缓存、只重解析最后一块。共同的前提是同一件事：markdown
 * 的块之间相互独立，一个已经闭合的块不会因为后面又来了几个字而改变含义。既然不会变，
 * 就不该再解析。
 *
 * 这个文件只做那一件事：找到最后一个可以安全封口的位置。
 *
 * 「安全」是这里唯一的难点。切点必须落在两个块之间，而不是落在一个跨行结构的中间 ——
 * 切开一个列表会让编号重来、让 <ul> 断成两截，切开一个围栏会让代码变成正文。判据因此
 * 是保守的：拿不准就不切。找不到切点时交回空的封口段，逐字退化成未拆分时的行为。
 */

/**
 * 这一行是不是某个跨行结构的一部分。
 *
 * 列表项、引用、表格行，以及 setext 标题的下划线 —— 它们的相邻行属于同一个块，中间
 * 那个空行是块内的空行（松散列表），不是块边界。
 */
const CONTINUES = /^\s{0,3}(?:[-*+>|=]|\d{1,9}[.)])/

/** 围栏的开合。缩进四格以上是缩进代码块，不是围栏。 */
const FENCE = /^\s{0,3}(?:```|~~~)/

/** 独占一行的 $$：块级公式的开合。 */
const MATH_FENCE = /^\s{0,3}\$\$\s*$/

/**
 * 把一篇还在写的 markdown 切成封口段与在写段。
 *
 * 封口段可能是空串（还没有任何一块写完，或找不到安全切点）；在写段永远非空 —— 切点
 * 后面必须还有内容，否则封口段就是全文，而全文永远不该被当成写完了。
 *
 * 两段拼回去等于原文减去切点那一个空行，而空行正是块之间的分隔符本身：它属于分隔，
 * 不属于任何一块。
 */
export function sealedSplit(text: string): readonly [sealed: string, live: string] {
  const lines = text.split('\n')

  let fenced = false
  let math = false
  let previous = ''
  let cut = -1

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''

    if (fenced) {
      if (FENCE.test(line)) {
        fenced = false
      }

      previous = line
      continue
    }

    if (math) {
      if (MATH_FENCE.test(line)) {
        math = false
      }

      previous = line
      continue
    }

    if (FENCE.test(line)) {
      fenced = true
      previous = line
      continue
    }

    if (MATH_FENCE.test(line)) {
      math = true
      previous = line
      continue
    }

    if (line.trim() !== '') {
      previous = line
      continue
    }

    /*
     * 一个空行只有在两侧都是普通块的时候才是块边界。
     *
     * previous 为空表示前面还没有内容；next 为空表示这是连续空行中的一个，边界在
     * 更后面那一个。两侧任意一侧属于跨行结构，这个空行就在块内。
     */
    const next = lines[index + 1] ?? ''

    if (previous === '' || next.trim() === '') {
      continue
    }

    if (CONTINUES.test(previous) || CONTINUES.test(next)) {
      continue
    }

    cut = index
  }

  /*
   * 收尾时仍在围栏里，不影响已经记下的切点：切点只在围栏之外记录，所以它一定落在
   * 这个未闭合围栏开始之前。而这正是最需要封口的场景 —— 一个正在被一行行写出来的
   * 代码块，前面那些已经写完的段落没有任何理由陪着它一起重新解析。
   */
  if (cut < 0) {
    return ['', text]
  }

  return [lines.slice(0, cut).join('\n'), lines.slice(cut + 1).join('\n')]
}
