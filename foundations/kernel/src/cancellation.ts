export interface CancellationToken {
  readonly cancelled: boolean
  readonly reason: CancellationReason | undefined
  onCancelled(listener: () => void): () => void
}

export type CancellationReason = 'aborted' | 'timeout' | 'cancelled' | 'superseded' | string

export class CancellationTokenSource {
  #cancelled = false
  #reason: CancellationReason | undefined
  #listeners: (() => void)[] = []

  get token(): CancellationToken {
    const source = this
    return {
      get cancelled() {
        return source.#cancelled
      },
      get reason() {
        return source.#reason
      },
      onCancelled(listener: () => void): () => void {
        // Cancellation is level-triggered. A listener registered after
        // cancellation must observe the already-cancelled state immediately;
        // otherwise withCancellation has a check-then-subscribe race.
        if (source.#cancelled) {
          listener()
          return () => {}
        }

        source.#listeners.push(listener)

        return () => {
          const idx = source.#listeners.indexOf(listener)

          if (idx >= 0) {
            source.#listeners.splice(idx, 1)
          }
        }
      },
    }
  }

  cancel(reason: CancellationReason = 'cancelled'): void {
    if (this.#cancelled) {
      return
    }
    this.#cancelled = true
    this.#reason = reason
    const listeners = [...this.#listeners]
    this.#listeners = []
    for (const l of listeners) {
      try {
        l()
      } catch {}
    }
  }

  static fromSignal(signal: AbortSignal): CancellationToken {
    return {
      get cancelled() {
        return signal.aborted
      },
      get reason() {
        return signal.reason as CancellationReason | undefined
      },
      onCancelled(listener) {
        signal.addEventListener('abort', listener, { once: true })
        return () => signal.removeEventListener('abort', listener)
      },
    }
  }

  static none(): CancellationToken {
    return {
      get cancelled() {
        return false
      },
      get reason() {
        return undefined
      },
      onCancelled() {
        return () => {}
      },
    }
  }

  static timeout(ms: number): { token: CancellationToken; cancel: () => void } {
    const cts = new CancellationTokenSource()
    const timer = setTimeout(() => cts.cancel('timeout'), ms)
    return {
      token: cts.token,
      cancel: () => {
        clearTimeout(timer)
        cts.cancel('cancelled')
      },
    }
  }
}

export function withCancellation<T>(
  token: CancellationToken,
  promise: Promise<T>,
  onCancel?: (reason?: CancellationReason) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (token.cancelled) {
      reject(new CancellationError(token.reason ?? 'cancelled'))
      return
    }
    const cleanup = token.onCancelled(() => {
      cleanup()
      onCancel?.(token.reason)
      reject(new CancellationError(token.reason ?? 'cancelled'))
    })
    promise.then(
      (v) => {
        cleanup()
        resolve(v)
      },
      (e) => {
        cleanup()
        reject(e)
      },
    )
  })
}

export class CancellationError extends Error {
  readonly reason: CancellationReason

  constructor(reason: CancellationReason) {
    super(`Cancelled: ${reason}`)
    this.name = 'CancellationError'
    this.reason = reason
  }
}

export function isCancellationError(error: unknown): error is CancellationError {
  return error instanceof CancellationError
}
