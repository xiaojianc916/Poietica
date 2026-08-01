import { CancellationTokenSource, type Clock, createMockClock } from '@poietica/core'

export function fakeClock(initialIso = '2024-01-01T00:00:00.000Z'): Clock {
  return createMockClock(new Date(initialIso))
}

export function neverCancelled() {
  return CancellationTokenSource.none()
}

export function createCancellation() {
  return new CancellationTokenSource()
}

export interface Fixture<T> {
  readonly name: string
  readonly build: () => T
}

export function fixture<T>(name: string, build: () => T): Fixture<T> {
  return { name, build }
}

export function collectFixtures<T>(fixtures: Fixture<T>[]): Record<string, T> {
  const out: Record<string, T> = {}
  for (const f of fixtures) {
    out[f.name] = f.build()
  }
  return out
}

export function waitFor(
  predicate: () => boolean,
  timeoutMs = 1000,
  intervalMs = 10,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (predicate()) {
        return resolve()
      }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('waitFor timeout'))
      }
      setTimeout(tick, intervalMs)
    }
    tick()
  })
}
