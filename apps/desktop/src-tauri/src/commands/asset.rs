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

#[derive(Clone, Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssetImportRequest {
    pub session_token: String,
    pub paths: Vec<String>,
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

/// Opens an asset session and returns its opaque token.
///
/// # Errors
///
/// Returns an error when the registry refuses to open the session. The caller
/// receives the redacted IPC message, never native detail.
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

/// Hashes one payload and stores it inside an open asset session.
///
/// # Errors
///
/// Returns an error when the payload length exceeds `u32`, when the hashing
/// task is cancelled, when the registry rejects the asset, or when the asset
/// protocol URL cannot be built — in that last case the stored asset is rolled
/// back before the error is returned.
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

/// Stores files the operating system handed us, named by path.
///
/// 字节不过 IPC。拖放与文件对话框交出来的都是路径，读盘因此发生在这一侧 ——
/// 让渲染层先把文件读进 webview、编码、再送回来，是为一个不存在的前提付三份
/// 代价（一次读、一次编码、一次比原文大三分之一的传输）。
///
/// 内容类型也由这里判定，判据是文件头而不是渲染层报的 `File.type` —— 后者来自
/// 扩展名，把 .svg 改名成 .png 就能骗过去，而资产协议是带 nosniff 投递的。认不
/// 出来的一律拒绝，白名单之外的格式在这一步就停住，不会走到界面上再报错。
///
/// # Errors
///
/// Returns an error when a file cannot be read, when its bytes are not one of
/// the deliverable image formats, when the payload length exceeds `u32`, when
/// the registry rejects the asset, or when the asset protocol URL cannot be
/// built — in that last case the stored asset is rolled back first.
#[tauri::command]
#[specta::specta]
pub async fn asset_import(
    request: AssetImportRequest,
    assets: State<'_, AssetProtocolRegistry>,
) -> CommandResult<Vec<AssetUploadResult>> {
    let AssetImportRequest {
        session_token,
        paths,
    } = request;

    /*
     * 读盘与哈希都是阻塞的，整批一次搬到阻塞执行器上 —— 与 asset_upload 里
     * 那段说明同一个理由，不是第二套做法。注册表写入留在这条线程上：State
     * 过不了边界，而那是一把短锁，不是一次扫描。
     */
    let read = async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|path| {
                let bytes = std::fs::read(&path)
                    .map_err(|_| Error::NotFound("file could not be read".into()))?;

                let content_type = sniff(&bytes)
                    .ok_or_else(|| Error::Validation("unsupported image format".into()))?;

                let content_hash = hex::encode(Sha256::digest(&bytes));

                Ok((content_hash, content_type, bytes))
            })
            .collect::<Result<Vec<_>, Error>>()
    })
    .await
    .map_err(|_| Error::Internal("asset import task failed".into()))??;

    let mut imported = Vec::with_capacity(read.len());

    for (content_hash, content_type, bytes) in read {
        let byte_length =
            u32::try_from(bytes.len()).map_err(|_| Error::Asset("asset length overflow".into()))?;

        let asset_token = content_hash.clone();

        assets
            .insert(
                &session_token,
                &asset_token,
                &content_hash,
                content_type,
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

        imported.push(AssetUploadResult {
            asset_token,
            content_hash,
            source,
            byte_length,
            content_type: content_type.to_owned(),
        });
    }

    Ok(imported)
}

/// 认文件头，不认扩展名。认不出来就是不投递。
///
/// 只列资产协议白名单里的静态图片格式：这个函数的返回值会被原样交给注册表，
/// 所以它认得的每一种，注册表都必须收得下。两边一旦分居，多出来的那一种会在
/// insert 处被拒，而不是在这里 —— 那时错误消息说的就不是真正的原因了。
fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }

    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }

    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }

    if bytes.starts_with(b"BM") {
        return Some("image/bmp");
    }

    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP".as_slice()) {
        return Some("image/webp");
    }

    if bytes.get(4..12) == Some(b"ftypavif".as_slice()) {
        return Some("image/avif");
    }

    None
}

/// Removes one asset from an open session.
///
/// # Errors
///
/// Returns an error when the registry rejects the request, and when the asset
/// is not present in that session.
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

/// Closes an asset session and releases everything it still holds.
///
/// # Errors
///
/// Returns an error only when the registry itself fails. A session that is
/// already gone is a success, not a failure: document close may have released
/// it first, and no caller should have to tell the two apart.
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
    #![allow(
        clippy::expect_used,
        clippy::unwrap_used,
        clippy::panic,
        clippy::indexing_slicing,
        clippy::shadow_unrelated,
        reason = "tests operate on known-good fixtures; a broken assumption must fail the test loudly"
    )]

    use super::*;

    #[test]
    fn content_hash_is_canonical_sha256() {
        let hash = hex::encode(Sha256::digest(b"asset"));

        assert_eq!(hash.len(), 64);
        assert!(
            hash.bytes()
                .all(|byte| { byte.is_ascii_digit() || matches!(byte, b'a'..=b'f') })
        );
    }

    #[test]
    fn content_type_comes_from_the_bytes_not_the_name() {
        assert_eq!(
            sniff(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"),
            Some("image/png")
        );
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(sniff(b"RIFF\x00\x00\x00\x00WEBPVP8 "), Some("image/webp"));

        /* 改名成 .png 的 SVG。扩展名骗得过，文件头骗不过。 */
        assert_eq!(sniff(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"), None);
        assert_eq!(sniff(b""), None);
    }

    #[test]
    fn asset_errors_do_not_expose_internal_details() {
        let ipc = map_asset_error(AssetProtocolError::RegistryBudgetExceeded);

        assert_eq!(ipc.message, "资源处理失败");
    }
}
