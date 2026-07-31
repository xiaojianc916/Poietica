import type { SessionConfigControl } from '@poietica/agent-protocol'

/*
 * 现在是谁在答话。
 *
 * 供应商藏在模型 id 的第一段里（deepseek/deepseek-v4-flash），这是 agent config
 * 的写法，不是这一层的约定。它此前写在模型选择器里，而开场那张脸也要用同一个
 * 答案——同一件事写两遍，改一处另一处不跟，且不会报错。
 *
 * 空串与没有是同一件事：两者都表示"读不出供应商"，交给 ProviderIcon 去画中性
 * 标记。让调用处各自判一次空，就是把这个决定散出去。
 */
export function modelProviderOf(
  controls: readonly SessionConfigControl[],
): string | undefined {
  const model = controls.find((control) => control.purpose === 'model')

  const provider = model?.current.split('/')[0]

  return provider === undefined || provider === '' ? undefined : provider
}
