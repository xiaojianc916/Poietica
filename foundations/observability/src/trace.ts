export interface Span {
  readonly name: string
  end(metadata?: Record<string, unknown>): void
}

export function startSpan(name: string, _metadata?: Record<string, unknown>): Span {
  const start = performance.now()
  const _spanId = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)
  return {
    name,
    end(_meta) {
      const _duration = performance.now() - start
    },
  }
}
