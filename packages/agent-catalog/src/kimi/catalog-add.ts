import type { AgentCatalogAddRequest } from '../catalog-contract'

/*
 * Kimi Code 的 provider catalog add 参数。
 *
 * 这个文件此前住在通用包根目录（catalog-add.ts）。它从来不通用：子命令逐字是
 * provider catalog add，开关逐字是 --default-model / --base-url，回落的环境变量逐字是
 * KIMI_REGISTRY_API_KEY（docs/en/reference/kimi-command.md）。也就是说通用层握着一家
 * CLI 的命令行语法 —— 与上一刀搬走的目录文档格式是同一类错误，所以它跟着搬。
 *
 * 读取那一半（catalog list 的参数与输出解析）早前就删了：第三十一版之后它没有一个调用
 * 点，而它本来也要现拉 models.dev —— 那个域名在部分网络下不可达。候选模型来自
 * provider-presets.ts 的内置表。
 *
 * 目录从哪来不归这里管：调用方随 execCli 带上 api.json 形状的文档，原生侧起一次性
 * loopback 服务并把官方的 --url 指过去。形状由同目录 catalog.ts 的 catalogDocument 保证。
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
export function kimiCatalogAddArgs(request: AgentCatalogAddRequest): readonly string[] {
  const args: string[] = ['provider', 'catalog', 'add', requireArg(request.providerId, '厂商标识')]

  if (request.defaultModelId !== undefined && request.defaultModelId.length > 0) {
    args.push('--default-model', requireArg(request.defaultModelId, '模型标识'))
  }

  if (request.baseUrl !== undefined && request.baseUrl.length > 0) {
    args.push('--base-url', requireArg(request.baseUrl, '基础地址'))
  }

  return args
}
