import { v7 as uuidv7 } from 'uuid'

export interface SerializationEnvelope<T = unknown> {
  readonly format: string
  readonly version: number
  readonly payload: T
  readonly serializedAt: string
  readonly envelopeId: string
}

export interface Serializer<T> {
  readonly format: string
  readonly version: number
  serialize(value: T): string
  deserialize(raw: string): T
}

export class SerializationError extends Error {
  override readonly cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'SerializationError'
    this.cause = cause
  }
}

export function wrap<T>(format: string, version: number, payload: T): SerializationEnvelope<T> {
  return {
    format,
    version,
    payload,
    serializedAt: new Date().toISOString(),
    envelopeId: uuidv7(),
  }
}

export function unwrap<T>(envelope: SerializationEnvelope<T>): T {
  return envelope.payload
}

export const jsonSerializer: Serializer<unknown> = {
  format: 'json',
  version: 1,
  serialize: (value) => JSON.stringify(value),
  deserialize: (raw) => JSON.parse(raw),
}
