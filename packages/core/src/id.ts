import { v7 as uuidv7 } from 'uuid'

export type Brand<T, B> = T & { readonly __brand: B }

export type AssetId = Brand<string, 'AssetId'>
export type CommandId = Brand<string, 'CommandId'>
export type TransactionId = Brand<string, 'TransactionId'>
export type ActorId = Brand<string, 'ActorId'>
export type RequestId = Brand<string, 'RequestId'>
export type SessionId = Brand<string, 'SessionId'>
export type WindowId = Brand<string, 'WindowId'>
export type AutomationId = Brand<string, 'AutomationId'>

export type AnyId =
  | AssetId
  | CommandId
  | TransactionId
  | ActorId
  | RequestId
  | SessionId
  | WindowId
  | AutomationId

/**
 * 所有 id 的生成与还原是同一件事，只有品牌不同。
 *
 * 之前是十四个函数体逐字相同的副本 —— 那不是"显式"，那是十四个各自会漂移的
 * 复制品。类型上的区分靠品牌，运行时只需要一份实现。
 */
const newId =
  <T extends string>(): (() => T) =>
  () =>
    uuidv7() as T
const asId =
  <T extends string>(): ((value: string) => T) =>
  (value) =>
    value as T

export const createAssetId = newId<AssetId>()
export const createCommandId = newId<CommandId>()
export const createTransactionId = newId<TransactionId>()
export const createActorId = newId<ActorId>()
export const createRequestId = newId<RequestId>()
export const createSessionId = newId<SessionId>()
export const createWindowId = newId<WindowId>()
export const createAutomationId = newId<AutomationId>()

export const parseAssetId = asId<AssetId>()
export const parseCommandId = asId<CommandId>()
export const parseTransactionId = asId<TransactionId>()
export const parseActorId = asId<ActorId>()
export const parseRequestId = asId<RequestId>()
export const parseSessionId = asId<SessionId>()
export const parseWindowId = asId<WindowId>()
export const parseAutomationId = asId<AutomationId>()
