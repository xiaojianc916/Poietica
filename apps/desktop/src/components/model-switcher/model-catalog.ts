/**
 * Single source of truth for selectable models.
 * The UI never invents metadata; it renders this descriptor shape.
 * Swap STATIC_MODELS for a provider/ACP query once the backend exposes one.
 */

export type ModelCapability = 'code' | 'reasoning' | 'vision' | 'tools' | 'longContext' | 'fast'

export type ModelTier = 'flagship' | 'balanced' | 'speed' | 'legacy' | 'preview'

export interface ModelDescriptor {
  id: string
  label: string
  family: string
  tier: ModelTier
  /** Context window in tokens. */
  contextTokens: number
  capabilities: readonly ModelCapability[]
  /** 1 = slowest, 5 = fastest. */
  speed: 1 | 2 | 3 | 4 | 5
  /** 1 = cheapest, 5 = priciest. */
  cost: 1 | 2 | 3 | 4 | 5
  summary: string
  deprecated: boolean
  recommended: boolean
}

export type ThinkingLevel = 'off' | 'auto' | 'extended'

export type RunMode = 'default' | 'plan' | 'agent'

export interface SwitcherSettings {
  modelId: string
  thinking: ThinkingLevel
  mode: RunMode
}

export interface SwitcherOption<T extends string> {
  value: T
  label: string
  hint: string
}

export const THINKING_LEVELS: ReadonlyArray<SwitcherOption<ThinkingLevel>> = [
  { value: 'off', label: 'Off', hint: 'Answer directly, lowest latency' },
  { value: 'auto', label: 'Auto', hint: 'Model decides when to reason' },
  { value: 'extended', label: 'Extended', hint: 'Deliberate multi-step reasoning' },
]

export const RUN_MODES: ReadonlyArray<SwitcherOption<RunMode>> = [
  { value: 'default', label: 'Chat', hint: 'Conversational, no file writes' },
  { value: 'plan', label: 'Plan', hint: 'Propose a plan before editing' },
  { value: 'agent', label: 'Agent', hint: 'Autonomous edits with tool use' },
]

export const CAPABILITY_META: Record<ModelCapability, { label: string; glyph: string }> = {
  code: { label: 'Code', glyph: '{ }' },
  reasoning: { label: 'Reasoning', glyph: '◈' },
  vision: { label: 'Vision', glyph: '◉' },
  tools: { label: 'Tools', glyph: '⚙' },
  longContext: { label: 'Long context', glyph: '≡' },
  fast: { label: 'Low latency', glyph: '⚡' },
}

export const TIER_META: Record<ModelTier, { label: string; order: number }> = {
  flagship: { label: 'Flagship', order: 0 },
  balanced: { label: 'Balanced', order: 1 },
  speed: { label: 'Speed optimized', order: 2 },
  preview: { label: 'Preview', order: 3 },
  legacy: { label: 'Legacy', order: 4 },
}

export const STATIC_MODELS: readonly ModelDescriptor[] = [
  {
    id: 'kimi-k3',
    label: 'kimi-k3',
    family: 'kimi',
    tier: 'flagship',
    contextTokens: 512_000,
    capabilities: ['code', 'reasoning', 'tools', 'vision', 'longContext'],
    speed: 3,
    cost: 5,
    summary: 'Best overall reasoning and long-horizon refactors.',
    deprecated: false,
    recommended: true,
  },
  {
    id: 'kimi-k2.7-code',
    label: 'kimi-k2.7-code',
    family: 'kimi',
    tier: 'balanced',
    contextTokens: 256_000,
    capabilities: ['code', 'tools', 'reasoning', 'longContext'],
    speed: 4,
    cost: 3,
    summary: 'Code-tuned default for day-to-day editing and reviews.',
    deprecated: false,
    recommended: true,
  },
  {
    id: 'kimi-k2.7-code-highspeed',
    label: 'kimi-k2.7-code-highspeed',
    family: 'kimi',
    tier: 'speed',
    contextTokens: 128_000,
    capabilities: ['code', 'tools', 'fast'],
    speed: 5,
    cost: 2,
    summary: 'Same family, latency first. Ideal for inline completions.',
    deprecated: false,
    recommended: false,
  },
  {
    id: 'kimi-k2.6',
    label: 'kimi-k2.6',
    family: 'kimi',
    tier: 'balanced',
    contextTokens: 128_000,
    capabilities: ['code', 'tools', 'reasoning'],
    speed: 4,
    cost: 2,
    summary: 'Stable general-purpose baseline.',
    deprecated: false,
    recommended: false,
  },
  {
    id: 'kimi-k2.5',
    label: 'kimi-k2.5',
    family: 'kimi',
    tier: 'legacy',
    contextTokens: 64_000,
    capabilities: ['code', 'tools'],
    speed: 4,
    cost: 1,
    summary: 'Kept for reproducing older sessions.',
    deprecated: true,
    recommended: false,
  },
]

export const DEFAULT_SETTINGS: SwitcherSettings = {
  modelId: 'kimi-k2.7-code',
  thinking: 'auto',
  mode: 'default',
}

export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M ctx`
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K ctx`
  }
  return `${tokens} ctx`
}

export function optionDomId(modelId: string): string {
  return `ms-option-${modelId.replace(/[^a-zA-Z0-9]+/g, '-')}`
}
