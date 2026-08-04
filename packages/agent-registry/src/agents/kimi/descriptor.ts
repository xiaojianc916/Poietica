import type { AcpAgentDescriptor } from '../../acp-agent-contract'

/*
 * Kimi Code CLI 的档案。
 *
 * 事实来源是它自己的源码，不是观察和猜测：
 * MoonshotAI/kimi-code，packages/acp-adapter/src/。每一条下面都注明具体是哪个函数。
 *
 * 那个包是上游自己叫作 legacy 的那一套（acp-v2.ts 逐字："the legacy
 * @moonshot-ai/acp-adapter over the SDK harness"）。另有一套 @moonshot-ai/acp-server
 * 挂在 kimi acp-v2 下，终端反向 RPC、文件宿主、session/close 只在那一套里。
 * 我们接哪一套、为什么、什么条件下才切，见 docs/adr/0004。
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
 * 按钮上的字。
 *
 * 键取自 approval.ts 自己的常量表：CANONICAL_OPTIONS 三条（Approve once /
 * Approve for this session / Reject），计划评审两条（Revise / Reject and Exit），
 * question.ts 追加的一条（Skip）。Allow / Allow Always / Approve 是 Python 时期
 * kimi-cli 的旧文案，上游的 permissionResponseToApprovalResponse 至今仍收它们的
 * optionId，所以旧版进程接上来时也不会露出英文。
 *
 * 计划评审里 plan_opt_* 的 name 是策略当场给的方案标签，本来就该原样显示，
 * 因此不在表内 —— 表只负责把规范英文换成中文，不负责改写 agent 说的话。
 */
const OPTION_LABELS = {
  Allow: '批准',
  'Allow Always': '始终批准',
  Approve: '批准',
  'Approve for this session': '本次会话内始终批准',
  'Approve once': '批准',
  Reject: '拒绝',
  'Reject and Exit': '拒绝并退出',
  Revise: '修改方案',
  Skip: '跳过',
} as const

/*
 * 启动方式取自上游 README 给 ACP 客户端的配置：command "kimi"，args ["acp"]。
 * 它是一个可执行名加一串参数，不是一行待解析的命令行 —— 拼成字符串再拆开只会
 * 凭空长出一个引号和转义的问题。
 *
 * 不是 acp-v2，这是一个决定而不是疏忽：那一套上游标着 experimental，它的
 * runAcpServer 调用没有传 slashCommands（命令面板会整个消失），而它多出来的
 * terminal/* 与 fs/* 都是客户端侧方法 —— 要先由我们实现并如实声明能力，
 * 声明而不实现比不声明糟。三条前置条件写在 docs/adr/0004。
 */
export const kimiCode = {
  id: 'kimi',
  displayName: 'Kimi Code',
  command: 'kimi',
  /*
   * 子命令决定接的是上游哪一套 ACP 实现。上游两套并存：
   * acp 是 @moonshot-ai/acp-adapter（acp-v2.ts 逐字称它 legacy），
   * acp-v2 是 @moonshot-ai/acp-server + agent-core-v2。
   * 走 v2 是为了子代理的审批能到达客户端 —— legacy 在事件流
   * 首行就把子代理的请求滤掉了。证据见 docs/adr/0004。
   */
  args: ['acp-v2'],
  // apps/kimi-code/src/config/paths.ts 的 resolveKimiHome：
  // homeDir ?? process.env['KIMI_CODE_HOME'] ?? join(homedir(), '.kimi-code')。
  homeVar: 'KIMI_CODE_HOME',
  // 同一行 resolveKimiHome 的最后一个回落，也就是没有受控 home 时它自己去的地方。
  ownHomeDirectory: '.kimi-code',
  // docs/en/reference/kimi-command.md 的 provider catalog add：--api-key
  // "Falls back to KIMI_REGISTRY_API_KEY if not provided"。我们从不给 --api-key，
  // 所以走的一直是这条回落。
  registryKeyVar: 'KIMI_REGISTRY_API_KEY',
  // docs/en/reference/kimi-command.md：provider list --json 输出 providers / models 两张表。
  providerListArgs: ['provider', 'list', '--json'],
  // 上游用一个固定 id 把 KIMI_MODEL_API_KEY 之类的变量合成成一个 provider，落盘时剥掉。
  syntheticProviderId: '__kimi_env__',
  install: { packageName: '@moonshot-ai/kimi-code', versionArgs: ['--version'] },
  optionLabels: OPTION_LABELS,
  questionDialect: QUESTION_DIALECT,
} as const satisfies AcpAgentDescriptor
