import { PROVIDER_MARK_FALLBACK, providerMarkOf } from './provider-icon-source'

export interface ProviderIconProps {
  readonly provider?: string
  readonly label?: string
  readonly className?: string
}

/**
 * 一枚厂商标记。
 *
 * 三个状态，不是两个：
 *
 *   还不知道   —— 选择器尚未从 agent 认领回来。留一格等尺寸的空白，不着一笔。
 *   知道，认得 —— 画那家的字形。
 *   知道，不认得 —— 画中性的那枚。
 *
 * 中间那条分界线是这个文件此前没有的。上一版把「还不知道」直接喂给查表函数，空
 * 名字落进兜底分支，于是开场那一帧画的是 generic —— 不是「正在加载」，是一个确
 * 定的错误答案，等真答案到了再当着人的面改口。开场那枚标记有 --cp-mark 那么大，
 * 这一跳无处可藏。
 *
 * 「不认识的厂商给中性字形而不是空盒子」这句话仍然成立，它说的是第三种状态。
 */
export function ProviderIcon({ className, label = '', provider }: ProviderIconProps) {
  const shell =
    className === undefined ? 'assistant-provider-icon' : `assistant-provider-icon ${className}`

  if (provider === undefined) {
    return <span aria-hidden="true" className={shell} data-pending="true" />
  }

  const Mark = providerMarkOf(provider)

  return (
    <Mark
      aria-hidden={label.length === 0}
      aria-label={label.length === 0 ? undefined : label}
      className={shell}
      data-fallback={Mark === PROVIDER_MARK_FALLBACK}
      data-provider={provider}
      role={label.length === 0 ? undefined : 'img'}
    />
  )
}
