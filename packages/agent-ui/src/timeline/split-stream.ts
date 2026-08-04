/*
 * 已经写完的那些块，和还在写的那一块。
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
 * 这个文件只做那一件事：找到所有可以安全封口的位置。
 *
 * 「最后一个」曾经就够用 —— 那时消费者只有一处，而它只想把全文分成「前面的」与
 * 「正在写的」两段。代价是前面那一段仍然是一个整体：每封口一块它就换一次字符串，
 * 于是前面所有块被重新解析一遍，n 块合计 n(n+1)/2 次。O(n²) 换了个位置，没有消失。
 * 切点本来就全在这一次扫描里，交出全部只是不再把它们丢掉。
 *
 * 「安全」是这里唯一的难点。切点必须落在两个块之间，而不是落在一个跨行结构的中间 ——
 * 切开一个列表会让编号重来、让 <ul> 断成两截，切开一个围栏会让代码变成正文。判据因此
 * 是保守的：拿不准就不切。一个切点都找不到时整篇就是一块，逐字退化成未拆分时的行为。
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

/** 独占一行的 $：块级公式的开合。 */
const MATH_FENCE = /^\s{0,3}\$\$\s*$/

/** 当前落在哪一种跨行围栏里面。 */
type Fence = 'none' | 'code' | 'math'

/**
 * 读完这一行之后，围栏状态变成什么。
 *
 * 围栏里只认自己那一种收口符：一个 ``` 块内部出现的 $ 是代码文本，不是公式
 * 的开头。这是 CommonMark 的规则，也是此前那两个布尔变量真正在表达的东西 ——
 * 它们表达得对，只是把它和「哪里可以切」缠在了同一个循环里。
 */
function fenceAfter(line: string, open: Fence): Fence {
  if (open === 'code') {
    return FENCE.test(line) ? 'none' : 'code'
  }

  if (open === 'math') {
    return MATH_FENCE.test(line) ? 'none' : 'math'
  }

  if (FENCE.test(line)) {
    return 'code'
  }

  return MATH_FENCE.test(line) ? 'math' : 'none'
}

/**
 * 一个空行是不是块边界。
 *
 * previous 为空表示前面还没有内容；next 为空表示这是连续空行中的一个，边界在
 * 更后面那一个。两侧任意一侧属于跨行结构（列表、引用、表格、setext 下划线），
 * 这个空行就在块内，切开它会让编号重来、让 <ul> 断成两截。
 */
function separates(previous: string, next: string): boolean {
  if (previous === '' || next.trim() === '') {
    return false
  }

  return !CONTINUES.test(previous) && !CONTINUES.test(next)
}

/**
 * 一块 markdown，以及它的身份。
 *
 * key 是起始行号：块只追加，封口之后内容不再变，所以这个数恒定且唯一。它同时是
 * 虚拟化那一层认人的依据 —— 正在写的那一块封口时起始行号不变，于是它已经测到的
 * 高度不会因为「它现在算封口的了」而作废。
 *
 * lines 是逻辑行数，扫描的时候顺手就有。它只服务估高，而估高要的是下界：一行换行
 * 之后只会更高，不会更矮。
 */
export interface StreamBlock {
  readonly key: number
  readonly lines: number
  readonly text: string
}

function blockAt(lines: readonly string[], start: number, end: number): StreamBlock {
  return { key: start, lines: end - start, text: lines.slice(start, end).join('\n') }
}

/**
 * 整篇当一块。
 *
 * 一条早已结束的消息整篇都是封口的，拆开它只会凭空多出一次扫描与若干渲染实例，而
 * memo 本来就挡住了它的重渲染。它仍然以块的形状交出去：下游只认块，不必为「没切过
 * 的那一种」另留一条分支。
 */
export function wholeText(text: string): readonly StreamBlock[] {
  return [{ key: 0, lines: text.split('\n').length, text }]
}

/**
 * 把一篇还在写的 markdown 切成块。
 *
 * 最后一块就是正在写的那一块：它后面没有安全切点，所以它是唯一还可能变的一块。前面
 * 每一块都已封口 —— 内容不再变，也就不该被解析第二次。
 *
 * 至少交回一块（可能是空串）：一篇还没有任何内容的思考也有一个正在写的位置。
 *
 * 相邻两块之间少掉的正是切点那一个空行，而空行是块之间的分隔符本身：它属于分隔，
 * 不属于任何一块。
 *
 * 切点是前缀确定的：一个空行是不是边界，只取决于它前面的内容与紧随其后的那一行，
 * 而围栏状态只由前缀决定。于是块只会追加、不会重新划分 —— 虚拟化那一层拿起始行号
 * 当身份，靠的就是这一条。
 */
export function blockSplit(text: string): readonly StreamBlock[] {
  const lines = text.split('\n')
  const blocks: StreamBlock[] = []

  let open: Fence = 'none'
  let previous = ''
  let start = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const inside = open !== 'none'

    open = fenceAfter(line, open)

    /*
     * 只有「围栏外的空行」才有资格当边界。围栏内的行、围栏本身那两行、以及任何
     * 有字的行，都只是内容。
     *
     * 注意空行不更新 previous —— 这不是疏忽，是 previous 的定义：它是上一个非空
     * 行。连续空行时它不能被冲掉，否则第二个空行会看见一个空的左邻居，边界就丢了。
     */
    if (inside || open !== 'none' || line.trim() !== '') {
      previous = line
      continue
    }

    if (separates(previous, lines[index + 1] ?? '')) {
      blocks.push(blockAt(lines, start, index))
      start = index + 1
    }
  }

  /*
   * 收尾时仍在围栏里，不影响任何一个已经记下的切点：切点只在围栏之外记录，所以它们
   * 全都落在这个未闭合围栏开始之前。而这正是最需要封口的场景 —— 一个正在被一行行写
   * 出来的代码块，前面那些已经写完的段落没有理由陪着它一起重新解析。
   */
  blocks.push(blockAt(lines, start, lines.length))

  return blocks
}
