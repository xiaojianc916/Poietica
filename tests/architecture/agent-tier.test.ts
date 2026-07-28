import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The agent tier is the spine of this product, so it may not depend on the
 * shells that compose it, and the shells may not reach past its entry points.
 * Both rules are cheap to check and expensive to rediscover after they have
 * been broken for a month.
 */

const ROOT = join(import.meta.dirname, '..', '..')
const SKIPPED = new Set(['node_modules', 'target', 'dist'])
const INWARD = [
  /@poietica\/features-/,
  /@poietica\/app-/,
  /\.\.\/\.\.\/features\//,
  /\.\.\/\.\.\/apps\//,
]
const DEEP_IMPORT = /@poietica\/agent-[a-z]+\//

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED.has(entry)) {
      continue
    }

    const full = join(dir, entry)

    if (statSync(full).isDirectory()) {
      sources(full, out)
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }

  return out
}

describe('agent tier layering', () => {
  it('never depends on features or apps', () => {
    const offenders = sources(join(ROOT, 'agent')).filter((file) =>
      INWARD.some((pattern) => pattern.test(readFileSync(file, 'utf8'))),
    )

    expect(offenders).toEqual([])
  })

  it('is consumed through package entry points only', () => {
    const offenders = [...sources(join(ROOT, 'features')), ...sources(join(ROOT, 'apps'))].filter(
      (file) => DEEP_IMPORT.test(readFileSync(file, 'utf8')),
    )

    expect(offenders).toEqual([])
  })
})
