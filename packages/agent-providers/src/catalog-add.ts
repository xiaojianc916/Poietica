/*
 * agent 的 provider 目录（catalog）—— 只剩写入参数这一半。
 *
 * 读取那一半（catalog list 的参数与输出解析）删了：第三十一版之后它没有一个调用点，
 * 而它本来也要现拉 models.dev —— 那个域名在部分网络下不可达。一条死了没人用的管线
 * 留着，只会让人以为它还活着。候选模型来自 builtin-catalog 的内置表。
 *
 * 写入走 agent 官方 CLI 的 provider catalog add。目录从哪来不归这里管：调用方随
 * execCli 带上 api.json 形状的内置目录，原生侧起一次性 loopback 服务并把官方的
 * --url 指过去。对方只读 `type`/`api`/`models.*.id` 与 `limit.context`
 * （@moonshot-ai/kosong 的 src/catalog.ts），形状由 builtin-catalog 的
 * agentProviderCatalogDocument 保证。
 *
 * 密钥永远不出现在这里返回的任何一个 arg 里。原生侧的 FORBIDDEN_FLAGS 会拒掉
 * --api-key，因为 Windows 上任何用户都读得到别的进程的完整命令行。密钥走
 * KIMI_REGISTRY_API_KEY 这类环境变量注入，变量名记在 agent 档案的 registryKeyVar 里。
 */

/*
 * 能安全出现在命令行上的参数。
 *
 * 收得比 shell 严：这些值最终会被原生侧再校验一次（contains_metacharacter），在这里先
 * 拦一次是为了让错误发生在看得见的地方，而不是变成一句 IPC 报错。
 */
const ARG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/

export interface AgentProviderCatalogAdd {
  readonly providerId: string
  readonly defaultModelId?: string | undefined
  /** 在场时覆盖目录自带的接口地址（对方的 resolveCatalogImport：用户给的赢）。 */
  readonly baseUrl?: string | undefined
}

function requireArg(value: string, what: string): string {
  if (!ARG_PATTERN.test(value)) {
    throw new Error(`${what}含有不能出现在命令行上的字符：${value}`)
  }

  return value
}

/**
 * 从目录里添加一家 provider。
 *
 * 协议类型、base URL 与模型信息全部由目录提供，我们只补一个密钥 —— 而密钥不在这串参数
 * 里，也不可能被加进来：这个函数根本没有接收它的形参。
 */
export function agentProviderCatalogAddArgs(input: AgentProviderCatalogAdd): readonly string[] {
  const args: string[] = ['provider', 'catalog', 'add', requireArg(input.providerId, '厂商标识')]

  if (input.defaultModelId !== undefined && input.defaultModelId.length > 0) {
    args.push('--default-model', requireArg(input.defaultModelId, '模型标识'))
  }

  if (input.baseUrl !== undefined && input.baseUrl.length > 0) {
    args.push('--base-url', requireArg(input.baseUrl, '基础地址'))
  }

  return args
}
