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
  const source = providerIconUrl(provider)

  return (
    <img
      alt={label}
      aria-hidden={label.length === 0}
      className={
        className === undefined ? 'assistant-provider-icon' : 'assistant-provider-icon ' + className
      }
      data-fallback={source === PROVIDER_ICON_FALLBACK}
      data-provider={provider ?? 'unknown'}
      draggable={false}
      src={source}
    />
  )
}
