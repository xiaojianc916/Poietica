/*
 * 一次子代理派发。
 *
 * ACP 里没有「子代理」这个概念：派一个子代理，在线上就是一次普通的工具调用。
 * 而上游把子代理自己的 session/update 全部挡在外面（agentId 不是主代理就 return），
 * 所以那张卡片从头到尾没有内容、标题只有一个工具名 —— 在屏幕上和卡死没有区别。
 *
 * 但派发的入参是照常送过来的：ToolCallTimelineItem.rawInput 里就写着派了哪一种
 * 子代理、让它干什么、是不是后台跑。这一层只把已经在手里的东西读出来 —— 不新增
 * 协议，不碰 TimelineState，也不猜。
 *
 * 判据是入参的形状，不是工具名。工具名在不同 agent 与不同版本下写法不一，
 * ask-user-question.ts 为同一个理由做过同样的选择。
 *
 * 下面这组键名今天只有一家 agent 在用。它们没有放进 AgentDialect，是因为那张表
 * 现在会因此多出一层 context，而没有第二个值可以填进去。接第二家 agent 时，把这
 * 组键名搬过去是加一行，判据一个字不改。
 */

/** 这次派发能说清楚的那几件事。 */
export interface SubAgentBrief {
  /** 哪一种子代理，上游的机器名（例如 general-purpose）。 */
  readonly type: string
  /** 让它干什么，一行；上游没写就是空串。 */
  readonly gist: string
  /** 标题栏那一行的成品。 */
  readonly label: string
  /** 后台跑：它不占这一轮的前台，答复会晚一些回来。 */
  readonly isBackground: boolean
}

/*
 * 一行的上限。
 *
 * prompt 是发给子代理的整段任务书，动辄几百字；标题栏只有一行的位置，截断在这一
 * 层做而不是交给 CSS —— text-overflow 截的是像素，读屏与 title 提示拿到的仍是那
 * 整段。description 是上游专门为「给人看」写的短语，所以它优先。
 */
const GIST = 80

function textOf(source: object, key: string): string {
  const value = Reflect.get(source, key)

  return typeof value === 'string' ? value.trim() : ''
}

/** 第一句有字的话。 */
function firstLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const said = line.trim()

    if (said.length > 0) {
      return said.length > GIST ? `${said.slice(0, GIST)}…` : said
    }
  }

  return ''
}

/**
 * 这次工具调用是不是一次子代理派发；不是就交回 null。
 *
 * rawInput 是 unknown，所以每一格都当场判类型。run_in_background 只认真正的
 * true —— 字符串 'false' 是真值，认宽了就会把一次前台派发画成后台。
 */
export function readSubAgent(rawInput: unknown): SubAgentBrief | null {
  if (typeof rawInput !== 'object' || rawInput === null || Array.isArray(rawInput)) {
    return null
  }

  const type = textOf(rawInput, 'subagent_type')

  if (type.length === 0) {
    return null
  }

  const said = textOf(rawInput, 'description')
  const gist = firstLine(said.length > 0 ? said : textOf(rawInput, 'prompt'))

  return {
    gist,
    isBackground: Reflect.get(rawInput, 'run_in_background') === true,
    label: gist.length === 0 ? type : `${type} · ${gist}`,
    type,
  }
}
