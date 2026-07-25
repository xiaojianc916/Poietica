import type { Result } from '@poietica/foundations-kernel'
import type { FileReference } from '../domain/file'

export interface AtomicDocumentStorage {
  create(archive: ArchivePayload): Promise<Result<FileReference, StorageError>>
  open(ref: FileReference): Promise<Result<OpenedArchive, StorageError>>
  commit(request: CommitRequest): Promise<Result<CommitResult, StorageError>>
  createRecoverySnapshot(request: RecoveryRequest): Promise<Result<void, StorageError>>
  watch(ref: FileReference, listener: ExternalChangeListener): Unwatch
}

export interface ArchivePayload {
  readonly documentJson: Uint8Array
  readonly assets: Record<string, Uint8Array>
  readonly migrations: readonly string[]
}

export interface OpenedArchive {
  readonly ref: FileReference
  readonly documentJson: Uint8Array
  readonly assets: Record<string, Uint8Array>
}

export interface CommitRequest {
  readonly ref: FileReference
  readonly expectedRevision: string
  readonly documentJson: Uint8Array
  readonly assets: Record<string, Uint8Array>
}

export interface CommitResult {
  readonly ref: FileReference
  readonly revision: string
}

export interface RecoveryRequest {
  readonly ref: FileReference
  readonly reason: string
}

export type ExternalChangeListener = (event: ExternalChangeEvent) => void

export interface ExternalChangeEvent {
  readonly type: 'modified' | 'deleted' | 'conflict'
}

export type Unwatch = () => void

export type StorageError =
  | { type: 'not-found'; path: string }
  | { type: 'file-conflict'; expectedRevision: string; actualRevision: string }
  | { type: 'permission-denied' }
  | { type: 'io-error'; message: string }
  | { type: 'corrupted'; detail: string }
  | { type: 'resource-limit'; limit: number }
