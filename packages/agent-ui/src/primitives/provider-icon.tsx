import { PROVIDER_ICON_FALLBACK, providerIconUrl } from './provider-icon-source'

/*
 * The mark of whoever is actually answering.
 *
 * Only the marks we ship are used, and an unrecognised provider gets the
 * neutral one rather than an empty box: a control that renders nothing is
 * indistinguishable from a control that failed to load.
 */

export interface ProviderIconProps {
  /** Provider name as the agent config spells it. */
  readonly provider?: string
  readonly label?: string
  /**
   * 额外的类名。
   *
   * 同一张图出现在两个尺度上：工具条那颗胶囊里它随字号（1em），开场那张脸
   * 是版面元素（--cp-mark）。尺寸属于位置，不属于图，所以由调用处给。
   */
  readonly className?: string
}

export function ProviderIcon({ className, label = '', provider }: ProviderIconProps) {
  const shell =
    className === undefined ? 'assistant-provider-icon' : `assistant-provider-icon ${className}`

  /*
   * 还不知道，和知道了但不认识，不是同一件事。
   *
   * 上一版把两者合并进 providerIconUrl 的 key.length === 0 分支，于是选择器
   * 还没从 agent 那边认领回来的那几帧里，开场那张脸画的是 generic —— 不是
   * 「正在加载」，是一个确定的错误答案，等真答案到了再当着人的面改口。开场
   * 那枚标记有 --cp-mark 那么大，这一跳无处可藏。
   *
   * 未定就占位：等尺寸、不发请求、不跳版。generic 收回它本来的职责，只答
   * 「这家我们没有图」—— 也就是这个文件顶上那段注释一直说的那件事。
   */
  if (provider === undefined) {
    return <span aria-hidden="true" className={shell} data-pending="true" />
  }

  const source = providerIconUrl(provider)

  return (
    <img
      alt={label}
      aria-hidden={label.length === 0}
      className={shell}
      data-fallback={source === PROVIDER_ICON_FALLBACK}
      data-provider={provider}
      draggable={false}
      src={source}
    />
  )
}
