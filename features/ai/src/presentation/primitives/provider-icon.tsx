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
}

export function ProviderIcon({ provider, label = '' }: ProviderIconProps) {
  const source = providerIconUrl(provider)

  return (
    <img
      alt={label}
      aria-hidden={label.length === 0}
      className="assistant-provider-icon"
      data-provider={provider ?? 'unknown'}
      data-fallback={source === PROVIDER_ICON_FALLBACK}
      draggable={false}
      src={source}
    />
  )
}
