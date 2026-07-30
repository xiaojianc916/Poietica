import { v7 as uuidv7 } from 'uuid'

export type Brand<T, B> = T & { readonly __brand: B }

export type AssetId = Brand<string, 'AssetId'>
export type CommandId = Brand<string, 'CommandId'>
export type TransactionId = Brand<string, 'TransactionId'>
export type ActorId = Brand<string, 'ActorId'>
export type RequestId = Brand<string, 'RequestId'>
export type SessionId = Brand<string, 'SessionId'>
export type WindowId = Brand<string, 'WindowId'>

const brander = <T, B>(value: T): Brand<T, B> => value as Brand<T, B>

export function createAssetId(): AssetId {
  return brander(uuidv7())
}
export function createCommandId(): CommandId {
  return brander(uuidv7())
}
export function createTransactionId(): TransactionId {
  return brander(uuidv7())
}
export function createActorId(): ActorId {
  return brander(uuidv7())
}
export function createRequestId(): RequestId {
  return brander(uuidv7())
}
export function createSessionId(): SessionId {
  return brander(uuidv7())
}
export function createWindowId(): WindowId {
  return brander(uuidv7())
}

export function parseAssetId(value: string): AssetId {
  return brander(value)
}
export function parseCommandId(value: string): CommandId {
  return brander(value)
}
export function parseTransactionId(value: string): TransactionId {
  return brander(value)
}
export function parseActorId(value: string): ActorId {
  return brander(value)
}
export function parseRequestId(value: string): RequestId {
  return brander(value)
}
export function parseSessionId(value: string): SessionId {
  return brander(value)
}
export function parseWindowId(value: string): WindowId {
  return brander(value)
}

export type AnyId = AssetId | CommandId | TransactionId | ActorId | RequestId | SessionId | WindowId
