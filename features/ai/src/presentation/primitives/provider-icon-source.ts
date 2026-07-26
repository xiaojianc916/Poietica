/*
 * Where a provider mark comes from.
 *
 * Resolved with import.meta.url, which the bundler understands on its own, so
 * shipping a mark is adding a file and nothing else: no plugin, no loader
 * declaration, no build configuration to keep in step.
 *
 * Kept apart from the component so the mapping can be tested without
 * rendering anything.
 */

const url = (name: string): string =>
  new URL('../assets/provider-icons/' + name + '.svg', import.meta.url).href

/** The mark for a provider we do not ship a mark for. */
export const PROVIDER_ICON_FALLBACK = url('generic')

/*
 * A provider is named by whoever wrote the agent config, so the same company
 * arrives under several names. The aliases are the spellings actually seen in
 * a Kimi config: the model name, the provider name, and the vendor name.
 */
const SOURCES: Readonly<Record<string, string>> = {
  deepseek: url('deepseek'),
  glm: url('zhipu'),
  kimi: url('moonshot'),
  moonshot: url('moonshot'),
  moonshotai: url('moonshot'),
  zhipu: url('zhipu'),
  zhipuai: url('zhipu'),
}

/** The mark for this provider, or the neutral one. */
export function providerIconUrl(provider?: string): string {
  const key = (provider ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

  if (key.length === 0) return PROVIDER_ICON_FALLBACK

  /* A config says "moonshot-v1" or "kimi-k2.5"; the mark belongs to whoever
     the name starts with. Longest key first, so a prefix never wins over a
     more specific name. */
  const known = Object.keys(SOURCES).sort((left, right) => right.length - left.length)
  const hit = known.find((name) => key.startsWith(name) || name.startsWith(key))

  return hit === undefined ? PROVIDER_ICON_FALLBACK : SOURCES[hit]
}
