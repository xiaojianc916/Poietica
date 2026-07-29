import type { AcpAgentDescriptor, AcpToolCallContentEntry } from '../acp-agent-contract'

/*
 * Kimi Code CLI 的档案。
 *
 * 事实来源是它自己的源码，不是观察和猜测：
 * MoonshotAI/kimi-code @ 67dd0314，packages/acp-adapter/src/。
 * 每一条下面都注明具体是哪个函数。
 */

/**
 * 提问方言。
 *
 * question.ts 的 optOptionId / skipOptionId 拼出 \`q\${questionIndex}_opt_\${optionIndex}\`
 * 与 \`q\${questionIndex}_skip\`，该文件注释把权威正则写成
 * /^q(\\d+)_(opt_(\\d+)|skip)$/。选项是 kind: 'allow_once'，Skip 是 'reject_once'。
 *
 * 题号今天恒为 0（适配器把多题降级成单题），但命名空间是上游为多题预留的，
 * 所以这里按 (\\d+) 收而不写死 q0：等上游放开，这两行不用动。
 *
 * 注意上游的回包解析 outcomeToQuestionAnswer 目前写死 /^q0_opt_(\\d+)$/，只认
 * 0 号题。我们收的是超集，方向上是安全的。
 */
const QUESTION_DIALECT = {
  option: /^q(\d+)_opt_(\d+)$/,
  skip: /^q(\d+)_skip$/,
}

/**
 * Kimi 把 diff 挂在开头那一帧，终局帧不带。
 *
 * 证据全在 events-map.ts：
 *  - toolCallStartToSessionUpdate 把 displayBlockToAcpContent(event.display)
 *    unshift 进 CREATE 帧的 content；
 *  - toolResultToSessionUpdate 的 content 整个来自 toolResultToAcpContent(event)，
 *    其中没有 diff；
 *  - 该文件自己的注释写明这是有意为之："ToolCallUpdate.content is REPLACE, not
 *    APPEND" / "the result's content array overwrites the streaming args preview
 *    with the final tool output"。
 *
 * 所以这不是 Kimi 的 bug，是它选择的发法：diff 前置一次，此后由客户端负责留住。
 * 照字面替换的话，diff 会在调用完成的那一瞬间消失 —— 而完成恰好是最需要看到
 * 它的时刻。
 *
 * 为什么是钩子而不是一个布尔声明：另一家如果把 diff 一直挂在 content 里，同一
 * 条规则会让它显示两遍；再一家可能要按 path 合并。三种落法是三段不同的算法，
 * 通用层没法靠换参数伺候，只能各家自带一段。
 */
export function carryForwardDiff<TEntry extends AcpToolCallContentEntry>(
  current: readonly TEntry[],
  incoming: readonly TEntry[] | undefined,
): readonly TEntry[] {
  if (incoming === undefined) {
    return current
  }

  /* 新帧自带 diff：它更新，整份采用。 */
  if (incoming.some((entry) => entry.type === 'diff')) {
    return incoming
  }

  const held = current.filter((entry) => entry.type === 'diff')

  return held.length === 0 ? incoming : [...held, ...incoming]
}

/*
 * 启动方式取自上游 README 给 ACP 客户端的配置：command "kimi"，args ["acp"]。
 * 它是一个可执行名加一串参数，不是一行待解析的命令行 —— 拼成字符串再拆开只会
 * 凭空长出一个引号和转义的问题。
 */
export const kimiCode = {
  id: 'kimi',
  displayName: 'Kimi Code',
  command: 'kimi',
  args: ['acp'],
  questionDialect: QUESTION_DIALECT,
  toolCallContentRule: carryForwardDiff,
} as const satisfies AcpAgentDescriptor
