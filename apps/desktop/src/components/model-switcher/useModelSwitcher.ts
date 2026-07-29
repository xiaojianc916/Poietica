import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  type ModelDescriptor,
  type ModelTier,
  type RunMode,
  STATIC_MODELS,
  type SwitcherSettings,
  type ThinkingLevel,
  TIER_META,
} from './model-catalog'

const STORAGE_KEY = 'poietica.modelSwitcher.v1'
const MAX_RECENT = 3

interface PersistedState extends SwitcherSettings {
  recent: readonly string[]
  favorites: readonly string[]
}

export interface ModelGroup {
  key: string
  label: string
  models: readonly ModelDescriptor[]
}

export interface ModelSwitcherApi {
  models: readonly ModelDescriptor[]
  selected: ModelDescriptor | undefined
  modelId: string
  thinking: ThinkingLevel
  mode: RunMode
  favorites: readonly string[]
  groups: readonly ModelGroup[]
  flat: readonly ModelDescriptor[]
  open: boolean
  query: string
  activeIndex: number
  activeModel: ModelDescriptor | undefined
  setQuery: (next: string) => void
  setThinking: (next: ThinkingLevel) => void
  setMode: (next: RunMode) => void
  setActiveIndex: (next: number) => void
  select: (id: string) => void
  toggleFavorite: (id: string) => void
  move: (delta: number) => void
  commitActive: () => void
  openPanel: () => void
  closePanel: () => void
}

function initialState(): PersistedState {
  const fallback: PersistedState = { ...DEFAULT_SETTINGS, recent: [], favorites: [] }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      return fallback
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return fallback
    }
    const candidate = parsed as Partial<PersistedState>
    return {
      modelId: typeof candidate.modelId === 'string' ? candidate.modelId : fallback.modelId,
      thinking: candidate.thinking ?? fallback.thinking,
      mode: candidate.mode ?? fallback.mode,
      recent: Array.isArray(candidate.recent) ? candidate.recent : [],
      favorites: Array.isArray(candidate.favorites) ? candidate.favorites : [],
    }
  } catch {
    return { ...DEFAULT_SETTINGS, recent: [], favorites: [] }
  }
}

/** Cheap subsequence match, tolerant of "k27c" style typing. */
function fuzzy(haystack: string, needle: string): boolean {
  const target = needle.toLowerCase().replace(/\s+/g, '')
  if (target.length === 0) {
    return true
  }
  let cursor = 0
  for (const ch of haystack.toLowerCase()) {
    if (ch === target[cursor]) {
      cursor += 1
    }
    if (cursor === target.length) {
      return true
    }
  }
  return false
}

function tierMeta(tier: ModelTier): { label: string; order: number } {
  return TIER_META[tier]
}

export function useModelSwitcher(
  source: readonly ModelDescriptor[] = STATIC_MODELS,
): ModelSwitcherApi {
  const [state, setState] = useState<PersistedState>(initialState)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const storageWritable = useRef(true)

  useEffect(() => {
    if (!storageWritable.current) {
      return
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      storageWritable.current = false
    }
  }, [state])

  const selected = useMemo(
    () => source.find((model) => model.id === state.modelId),
    [source, state.modelId],
  )

  const filtered = useMemo(
    () => source.filter((model) => fuzzy(model.label, query) || fuzzy(model.summary, query)),
    [source, query],
  )

  const groups = useMemo<readonly ModelGroup[]>(() => {
    const out: ModelGroup[] = []
    const pinned = filtered.filter((model) => state.favorites.includes(model.id))
    if (pinned.length > 0) {
      out.push({ key: 'favorites', label: 'Pinned', models: pinned })
    }

    const recents = filtered.filter(
      (model) => state.recent.includes(model.id) && !state.favorites.includes(model.id),
    )
    if (recents.length > 0) {
      out.push({ key: 'recent', label: 'Recent', models: recents })
    }

    const claimed = new Set([...pinned, ...recents].map((model) => model.id))
    const byTier = new Map<ModelTier, ModelDescriptor[]>()
    for (const model of filtered) {
      if (claimed.has(model.id)) {
        continue
      }
      const bucket = byTier.get(model.tier) ?? []
      bucket.push(model)
      byTier.set(model.tier, bucket)
    }

    const tiers = [...byTier.entries()].sort((a, b) => tierMeta(a[0]).order - tierMeta(b[0]).order)
    for (const [tier, list] of tiers) {
      out.push({ key: tier, label: tierMeta(tier).label, models: list })
    }
    return out
  }, [filtered, state.favorites, state.recent])

  const flat = useMemo<readonly ModelDescriptor[]>(
    () => groups.flatMap((group) => [...group.models]),
    [groups],
  )

  const activeModel = flat[activeIndex]

  const select = useCallback(
    (id: string) => {
      if (!source.some((model) => model.id === id)) {
        return
      }
      setState((prev) => ({
        ...prev,
        modelId: id,
        recent: [id, ...prev.recent.filter((entry) => entry !== id)].slice(0, MAX_RECENT),
      }))
      setOpen(false)
      setQuery('')
    },
    [source],
  )

  const toggleFavorite = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      favorites: prev.favorites.includes(id)
        ? prev.favorites.filter((entry) => entry !== id)
        : [...prev.favorites, id],
    }))
  }, [])

  const move = useCallback(
    (delta: number) => {
      const total = flat.length
      if (total === 0) {
        return
      }
      setActiveIndex((prev) => (prev + delta + total) % total)
    },
    [flat.length],
  )

  const commitActive = useCallback(() => {
    const target = flat[activeIndex]
    if (target !== undefined) {
      select(target.id)
    }
  }, [flat, activeIndex, select])

  const openPanel = useCallback(() => {
    setOpen(true)
    setQuery('')
    setActiveIndex(
      Math.max(
        0,
        flat.findIndex((model) => model.id === state.modelId),
      ),
    )
  }, [flat, state.modelId])

  const closePanel = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

  const updateQuery = useCallback((next: string) => {
    setQuery(next)
    setActiveIndex(0)
  }, [])

  const setThinking = useCallback((next: ThinkingLevel) => {
    setState((prev) => ({ ...prev, thinking: next }))
  }, [])

  const setMode = useCallback((next: RunMode) => {
    setState((prev) => ({ ...prev, mode: next }))
  }, [])

  return {
    activeIndex,
    activeModel,
    closePanel,
    commitActive,
    favorites: state.favorites,
    flat,
    groups,
    mode: state.mode,
    modelId: state.modelId,
    models: source,
    move,
    open,
    openPanel,
    query,
    select,
    selected,
    setActiveIndex,
    setMode,
    setQuery: updateQuery,
    setThinking,
    thinking: state.thinking,
    toggleFavorite,
  }
}
