export interface IpcError {
  readonly code: string
  readonly message: string
  readonly operation: string
  readonly recoverable: boolean
}

export function isIpcError(value: unknown): value is IpcError {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.operation === 'string' &&
    typeof candidate.recoverable === 'boolean'
  )
}

export class IpcInvocationError extends Error {
  readonly details: IpcError

  constructor(details: IpcError) {
    super(details.message)
    this.name = 'IpcInvocationError'
    this.details = details
  }
}
