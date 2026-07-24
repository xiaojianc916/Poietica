export interface WindowErrorLike {
  readonly message: string
  readonly error: unknown
}

/**
 * Browser-defined ResizeObserver scheduling notifications.
 *
 * These exact messages are emitted by browser engines when
 * ResizeObserver delivery is deferred to a later frame.
 * They do not indicate that Hybrid Canvas is unable to
 * continue safely.
 */
const BENIGN_RESIZE_OBSERVER_MESSAGES = new Set([
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded',
])

/**
 * Determines whether a window error is a known recoverable
 * browser scheduling notification.
 *
 * This policy deliberately uses an exact allowlist. It must
 * not ignore arbitrary errors merely because their message
 * contains the word ResizeObserver.
 */
export function isBenignWindowError(event: WindowErrorLike): boolean {
  const messages = [
    normalizeMessage(event.message),
    normalizeMessage(readErrorMessage(event.error)),
  ]

  return messages.some(
    (message) => message !== undefined && BENIGN_RESIZE_OBSERVER_MESSAGES.has(message),
  )
}

function readErrorMessage(value: unknown): string | undefined {
  if (value instanceof Error) {
    return value.message
  }

  if (typeof value === 'string') {
    return value
  }

  return undefined
}

function normalizeMessage(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }

  const normalized = value.trim()

  return normalized.length > 0 ? normalized : undefined
}
