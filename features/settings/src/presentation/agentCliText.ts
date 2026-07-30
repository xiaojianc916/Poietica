/*
 * agent CLI 的失败怎么说给用户听。
 *
 * 两条判断曾各写一份在用到它们的地方。它们不属于任何一个 hook：所有 execCli 调用共用
 * 同一套 —— 非零退出优先转述 agent 自己的 stderr（config.toml 坏掉时它说得比我们清楚，
 * 连怎么修都写了，转述一遍只会丢信息），异常时只有 Error 才有可信的 message。
 */

export function describeAgentCliExit(status: number, stderr: string): string {
  const detail = stderr.trim()

  return detail.length > 0 ? detail : `agent 以退出码 ${status} 结束，且没有说明原因。`
}

export function describeAgentCliFailure(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
