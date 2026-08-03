import { type Clock, createMockClock } from '@poietica/core'

export function fakeClock(initialIso = '2024-01-01T00:00:00.000Z'): Clock {
  return createMockClock(new Date(initialIso))
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
