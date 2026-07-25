//! Native IPC boundary for document-session binary assets.
//!
//! The renderer provides bytes and MIME metadata. Native owns validation,
//! content hashing, opaque delivery identities and protocol registration.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use tauri::{State, async_runtime};
use uuid::Uuid;

use crate::asset_protocol::{AssetProtocolError, AssetProtocolRegistry, asset_protocol_url};
use crate::error::{Error, IpcError};

type CommandResult<T> = Result<T, IpcError>;

#[derive(Clone, Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssetUploadRequest {
    pub session_token: String,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssetSessionResult {
    pub session_token: String,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssetUploadResult {
    pub asset_token: String,
    pub content_hash: String,
    pub source: String,
    pub byte_length: u32,
    pub content_type: String,
}

#[derive(Clone, Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssetRemoveRequest {
    pub session_token: String,
    pub asset_token: String,
}

#[derive(Clone, Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssetSessionCloseRequest {
    pub session_token: String,
}

#[tauri::command]
#[specta::specta]
pub async fn asset_session_open(
    assets: State<'_, AssetProtocolRegistry>,
) -> CommandResult<AssetSessionResult> {
    let session_token = Uuid::now_v7().simple().to_string();

    assets
        .open_session(&session_token)
        .map_err(map_asset_error)?;

    Ok(AssetSessionResult { session_token })
}

#[tauri::command]
#[specta::specta]
pub async fn asset_upload(
    request: AssetUploadRequest,
    assets: State<'_, AssetProtocolRegistry>,
) -> CommandResult<AssetUploadResult> {
    let AssetUploadRequest {
        session_token,
        content_type,
        bytes,
    } = request;

    let byte_length =
        u32::try_from(bytes.len()).map_err(|_| Error::Asset("asset length overflow".into()))?;

    /*
     * A command body runs on the async runtime's worker threads. Hashing is
     * CPU-bound over up to MAX_ASSET_BYTES, so doing it here occupied a worker
     * that every other pending command was queued behind, in a function that
     * awaited nothing at all.
     *
     * Only the digest moves. The registry write stays on this thread because
     * State cannot cross the boundary, and it is a short lock, not a scan.
     */
    let (content_hash, bytes) = async_runtime::spawn_blocking(move || {
        let content_hash = hex::encode(Sha256::digest(&bytes));

        (content_hash, bytes)
    })
    .await
    .map_err(|_| Error::Internal("asset hashing task failed".into()))?;

    let asset_token = content_hash.clone();

    assets
        .insert(
            &session_token,
            &asset_token,
            &content_hash,
            &content_type,
            bytes,
        )
        .map_err(map_asset_error)?;

    let source = match asset_protocol_url(&session_token, &asset_token) {
        Ok(source) => source,
        Err(error) => {
            let _ = assets.remove(&session_token, &asset_token);

            return Err(map_asset_error(error));
        }
    };

    Ok(AssetUploadResult {
        asset_token,
        content_hash,
        source,
        byte_length,
        content_type,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn asset_remove(
    request: AssetRemoveRequest,
    assets: State<'_, AssetProtocolRegistry>,
) -> CommandResult<()> {
    let removed = assets
        .remove(&request.session_token, &request.asset_token)
        .map_err(map_asset_error)?;

    if !removed {
        return Err(Error::NotFound("asset does not exist in session".into()).into());
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn asset_session_close(
    request: AssetSessionCloseRequest,
    assets: State<'_, AssetProtocolRegistry>,
) -> CommandResult<()> {
    /*
     * Document close may already have released a restored asset session, so a
     * session that is not there is a success rather than a failure. The
     * returned flag distinguishes the two cases and no caller needs to.
     */
    assets
        .remove_session(&request.session_token)
        .map_err(map_asset_error)?;

    Ok(())
}

fn map_asset_error(error: AssetProtocolError) -> IpcError {
    let error = match error {
        AssetProtocolError::InvalidToken
        | AssetProtocolError::InvalidContentHash
        | AssetProtocolError::UnsupportedContentType
        | AssetProtocolError::AssetTooLarge => Error::Validation("invalid asset request".into()),

        AssetProtocolError::NotFound => Error::NotFound("asset session or asset not found".into()),

        AssetProtocolError::RegistryBudgetExceeded
        | AssetProtocolError::DuplicateAsset
        | AssetProtocolError::ReferenceOverflow => {
            Error::Asset("asset registry rejected resource".into())
        }

        AssetProtocolError::Internal => Error::Internal("asset registry unavailable".into()),
    };

    error.into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_hash_is_canonical_sha256() {
        let hash = hex::encode(Sha256::digest(b"canvas"));

        assert_eq!(hash.len(), 64);
        assert!(
            hash.bytes()
                .all(|byte| { byte.is_ascii_digit() || matches!(byte, b'a'..=b'f') })
        );
    }

    #[test]
    fn asset_errors_do_not_expose_internal_details() {
        let ipc = map_asset_error(AssetProtocolError::RegistryBudgetExceeded);

        assert_eq!(ipc.message, "资源处理失败");
    }
}
