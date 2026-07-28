import type { AssetId } from '@poietica/agent-timeline'
import type { AssetHash, AssetReference, MimeType } from '@poietica/editor-assets'
import type { Result } from '@poietica/foundations-kernel'

export interface AssetStore {
  store(
    id: AssetId,
    hash: AssetHash,
    mimeType: MimeType,
    bytes: Uint8Array,
  ): Promise<Result<AssetReference, string>>
  load(id: AssetId): Promise<Result<{ bytes: Uint8Array; mimeType: MimeType }, string>>
  delete(id: AssetId): Promise<Result<void, string>>
  list(): Promise<AssetReference[]>
}
