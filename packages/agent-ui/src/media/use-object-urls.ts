import { useEffect, useRef, useState } from 'react'

export interface ObjectUrlSource {
  readonly id: string
  readonly file: File
}

/**
 * Object URLs for a changing set of files, keyed by attachment id.
 *
 * `URL.createObjectURL` pins its `File` in memory for the lifetime of the
 * document unless the URL is revoked, so every URL minted here is revoked the
 * moment its attachment leaves the set — and the whole table is revoked on
 * unmount. Nothing else in the tree may create these URLs; one owner, one
 * revoke path.
 *
 * The map identity only changes when the set of ids actually changes, so
 * consumers can put it straight into a `useMemo` dependency list without
 * re-running on every keystroke.
 */
export function useObjectUrls(sources: readonly ObjectUrlSource[]): ReadonlyMap<string, string> {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(() => new Map())
  const live = useRef(new Map<string, string>())

  useEffect(() => {
    const current = live.current
    const keep = new Set<string>()
    let changed = false

    for (const source of sources) {
      keep.add(source.id)

      if (!current.has(source.id)) {
        current.set(source.id, URL.createObjectURL(source.file))
        changed = true
      }
    }

    for (const [id, url] of current) {
      if (!keep.has(id)) {
        URL.revokeObjectURL(url)
        current.delete(id)
        changed = true
      }
    }

    /* Only swap identity on a real change: this hook feeds a memo upstream. */
    if (changed) {
      setUrls(new Map(current))
    }
  }, [sources])

  /* Last line of defence: nothing survives the unmount. */
  useEffect(
    () => () => {
      for (const url of live.current.values()) {
        URL.revokeObjectURL(url)
      }

      live.current.clear()
    },
    [],
  )

  return urls
}
