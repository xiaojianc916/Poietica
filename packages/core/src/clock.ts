export interface Clock {
  now(): Date
  nowIso(): string
  nowTimestamp(): number
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowIso: () => new Date().toISOString(),
  nowTimestamp: () => Date.now(),
}

export function createFixedClock(date: Date): Clock {
  return {
    now: () => date,
    nowIso: () => date.toISOString(),
    nowTimestamp: () => date.getTime(),
  }
}

export function createMockClock(initial: Date = new Date(), _stepMs = 0): Clock {
  const current = initial.getTime()
  return {
    now: () => new Date(current),
    nowIso: () => new Date(current).toISOString(),
    nowTimestamp: () => current,
  }
}
