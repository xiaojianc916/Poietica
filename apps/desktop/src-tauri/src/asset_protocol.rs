//! Native delivery boundary for document-owned binary assets.
//!
//! Asset bytes are addressed only by opaque session and asset tokens. The
//! protocol never accepts filesystem paths, archive entry names or renderer
//! supplied MIME response headers.

use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tauri::http::{
    Request, Response, StatusCode,
    header::{CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE, X_CONTENT_TYPE_OPTIONS},
};

pub const ASSET_PROTOCOL_SCHEME: &str = "poietica-asset";

const ASSET_PROTOCOL_HOST: &str = "asset";
const MAX_ASSET_BYTES: usize = 32 * 1024 * 1024;
const MAX_REGISTRY_BYTES: usize = 256 * 1024 * 1024;
const MAX_TOKEN_BYTES: usize = 128;

/// One content-addressed asset whose bytes are known to match their declared
/// SHA-256 identity.
///
/// The fields are private because that guarantee is the whole value of this
/// type. Every construction site has to say how it establishes the guarantee,
/// either by paying for the digest or by naming the check that already did.
///
/// Bytes are held as Arc<Vec<u8>> rather than Arc<[u8]>. Arc stores a refcount
/// ahead of its payload, so `Arc::from(vec)` cannot adopt the Vec's allocation
/// and copies every byte; `Arc::new` boxes the Vec that already exists. The cost
/// is one extra pointer hop per access, not per byte, and nothing here needs
/// the cheap subslicing that would justify a `bytes::Bytes` dependency.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetSessionSnapshotEntry {
    content_hash: String,
    content_type: String,
    #[allow(
        clippy::rc_buffer,
        reason = "the payload is produced as a Vec and shared read-only; Arc<[u8]> would force an extra copy"
    )]
    bytes: Arc<Vec<u8>>,
}

impl AssetSessionSnapshotEntry {
    /// Builds an entry by hashing the bytes and comparing them to the declared
    /// identity.
    ///
    /// This is the constructor to reach for unless the digest has demonstrably
    /// already been computed over these exact bytes.
    ///
    /// # Errors
    ///
    /// Returns an error when the underlying operation fails; the message handed
    /// to the caller is the redacted IPC message, never native detail.
    pub fn verify(
        content_hash: String,
        content_type: String,
        #[allow(
            clippy::rc_buffer,
            reason = "the payload is produced as a Vec and shared read-only; Arc<[u8]> would force an extra copy"
        )]
        bytes: Arc<Vec<u8>>,
    ) -> Result<Self, AssetProtocolError> {
        validate_content_hash(&content_hash)?;
        validate_content_type(&content_type)?;

        if hex::encode(Sha256::digest(bytes.as_slice())) != content_hash {
            return Err(AssetProtocolError::InvalidContentHash);
        }

        Ok(Self {
            content_hash,
            content_type,
            bytes,
        })
    }

    /// Builds an entry from bytes a container decoder has just verified against
    /// this exact identity, without hashing them a second time.
    ///
    /// Contract for the caller: a SHA-256 digest of exactly these bytes must
    /// already have been compared against exactly this content hash, in this
    /// process, with no opportunity for the bytes to change in between. The
    /// .draw decoder satisfies this by rejecting the entire container when any
    /// asset digest disagrees with its index.
    ///
    /// Without this, opening a document hashes every asset twice: once in the
    /// decoder and once again on the way into the registry. The obligation is
    /// discharged once at the construction site instead of on every call.
    ///
    /// Identity format and content type are still validated. Only the digest,
    /// the one check whose cost scales with the asset, is skipped.
    ///
    /// # Errors
    ///
    /// Returns an error when the underlying operation fails; the message handed
    /// to the caller is the redacted IPC message, never native detail.
    pub fn from_verified_container(
        content_hash: String,
        content_type: String,
        #[allow(
            clippy::rc_buffer,
            reason = "the payload is produced as a Vec and shared read-only; Arc<[u8]> would force an extra copy"
        )]
        bytes: Arc<Vec<u8>>,
    ) -> Result<Self, AssetProtocolError> {
        validate_content_hash(&content_hash)?;
        validate_content_type(&content_type)?;

        Ok(Self {
            content_hash,
            content_type,
            bytes,
        })
    }

    pub fn content_hash(&self) -> &str {
        &self.content_hash
    }

    pub fn content_type(&self) -> &str {
        &self.content_type
    }

    #[allow(
        clippy::rc_buffer,
        reason = "the payload is produced as a Vec and shared read-only; Arc<[u8]> would force an extra copy"
    )]
    pub fn bytes(&self) -> &Arc<Vec<u8>> {
        &self.bytes
    }
}

#[derive(Clone, Debug)]
struct RegisteredAsset {
    #[allow(
        clippy::rc_buffer,
        reason = "the payload is produced as a Vec and shared read-only; Arc<[u8]> would force an extra copy"
    )]
    bytes: Arc<Vec<u8>>,
    content_type: String,
    references: u32,
}

#[derive(Debug, Default)]
struct RegistryState {
    sessions: HashMap<String, HashMap<String, RegisteredAsset>>,
    total_bytes: usize,
}

/// Process-local delivery registry for opened document sessions.
///
/// The `DocumentCodec` owns durable bytes. This registry owns only the bounded
/// runtime delivery cache used by the `WebView` custom protocol.
#[derive(Clone, Debug, Default)]
pub struct AssetProtocolRegistry {
    state: Arc<RwLock<RegistryState>>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AssetProtocolError {
    InvalidToken,
    InvalidContentHash,
    UnsupportedContentType,
    AssetTooLarge,
    RegistryBudgetExceeded,
    DuplicateAsset,
    ReferenceOverflow,
    NotFound,
    Internal,
}

impl AssetProtocolRegistry {
    /// # Errors
    ///
    /// Returns an error when the underlying operation fails; the message handed
    /// to the caller is the redacted IPC message, never native detail.
    pub fn open_session(&self, session_token: &str) -> Result<(), AssetProtocolError> {
        validate_token(session_token)?;

        let mut state = self
            .state
            .write()
            .map_err(|_| AssetProtocolError::Internal)?;

        if state.sessions.contains_key(session_token) {
            return Err(AssetProtocolError::DuplicateAsset);
        }

        state
            .sessions
            .insert(session_token.to_owned(), HashMap::new());

        Ok(())
    }

    /// # Errors
    ///
    /// Returns an error when the underlying operation fails; the message handed
    /// to the caller is the redacted IPC message, never native detail.
    pub fn insert(
        &self,
        session_token: &str,
        asset_token: &str,
        content_hash: &str,
        content_type: &str,
        bytes: Vec<u8>,
    ) -> Result<(), AssetProtocolError> {
        validate_token(session_token)?;
        validate_token(asset_token)?;
        validate_content_hash(content_hash)?;
        validate_content_type(content_type)?;

        /*
         * Runtime asset identity is the canonical lowercase SHA-256 digest.
         * Session tokens remain opaque, but asset tokens are deliberately
         * content-addressed so the same binary has one Native identity.
         */
        if asset_token != content_hash {
            return Err(AssetProtocolError::InvalidContentHash);
        }

        if bytes.len() > MAX_ASSET_BYTES {
            return Err(AssetProtocolError::AssetTooLarge);
        }

        let mut state = self
            .state
            .write()
            .map_err(|_| AssetProtocolError::Internal)?;

        /*
         * Read before the session borrow so the whole insert needs one map
         * lookup. Previously the borrow was released to reach total_bytes and
         * the session had to be looked up a second time to store the asset.
         */
        let current_total = state.total_bytes;

        let session = state
            .sessions
            .get_mut(session_token)
            .ok_or(AssetProtocolError::NotFound)?;

        if let Some(existing) = session.get_mut(asset_token) {
            if existing.content_type != content_type
                || existing.bytes.as_slice() != bytes.as_slice()
            {
                /*
                 * A SHA-256 identity must never resolve to different bytes or
                 * metadata within one session.
                 */
                return Err(AssetProtocolError::DuplicateAsset);
            }

            existing.references = existing
                .references
                .checked_add(1)
                .ok_or(AssetProtocolError::ReferenceOverflow)?;

            return Ok(());
        }

        let next_total = current_total
            .checked_add(bytes.len())
            .ok_or(AssetProtocolError::RegistryBudgetExceeded)?;

        if next_total > MAX_REGISTRY_BYTES {
            return Err(AssetProtocolError::RegistryBudgetExceeded);
        }

        // Arc::new adopts the Vec the IPC layer already allocated. Arc::from
        // would reallocate and copy the asset in full.
        session.insert(
            asset_token.to_owned(),
            RegisteredAsset {
                bytes: Arc::new(bytes),
                content_type: content_type.to_owned(),
                references: 1,
            },
        );

        state.total_bytes = next_total;

        Ok(())
    }

    /// # Errors
    ///
    /// Returns an error when the underlying operation fails; the message handed
    /// to the caller is the redacted IPC message, never native detail.
    pub fn remove(
        &self,
        session_token: &str,
        asset_token: &str,
    ) -> Result<bool, AssetProtocolError> {
        validate_token(session_token)?;
        validate_token(asset_token)?;

        let mut state = self
            .state
            .write()
            .map_err(|_| AssetProtocolError::Internal)?;

        let Some(session) = state.sessions.get_mut(session_token) else {
            return Ok(false);
        };

        let Some(asset) = session.get_mut(asset_token) else {
            return Ok(false);
        };

        if asset.references > 1 {
            asset.references -= 1;
            return Ok(true);
        }

        let removed = session
            .remove(asset_token)
            .ok_or(AssetProtocolError::Internal)?;

        state.total_bytes = state.total_bytes.saturating_sub(removed.bytes.len());

        Ok(true)
    }

    /// # Errors
    ///
    /// Returns an error when the underlying operation fails; the message handed
    /// to the caller is the redacted IPC message, never native detail.
    pub fn remove_session(&self, session_token: &str) -> Result<bool, AssetProtocolError> {
        validate_token(session_token)?;

        let mut state = self
            .state
            .write()
            .map_err(|_| AssetProtocolError::Internal)?;

        let Some(assets) = state.sessions.remove(session_token) else {
            return Ok(false);
        };

        let removed_bytes = assets
            .values()
            .map(|asset| asset.bytes.len())
            .sum::<usize>();

        state.total_bytes = state.total_bytes.saturating_sub(removed_bytes);

        Ok(true)
    }

    /// Restores one complete document-owned asset session atomically.
    ///
    /// Every asset is materialized in private temporary state before the
    /// registry write lock is acquired. The session becomes visible only after
    /// the complete resource set and global byte budget have been accepted.
    ///
    /// Failure never publishes an empty or partially restored session.
    ///
    /// Content identity, content type and digest are guaranteed by the entry
    /// type and are deliberately not rechecked. Re-hashing here meant every
    /// asset in a document was hashed twice on open: once by the container
    /// decoder that produced these entries, and once again on arrival. Only the
    /// registry's own budgets, which the entry knows nothing about, are
    /// enforced below.
    ///
    /// # Errors
    ///
    /// Returns an error when the underlying operation fails; the message handed
    /// to the caller is the redacted IPC message, never native detail.
    pub fn restore_session(
        &self,
        session_token: &str,
        assets: Vec<AssetSessionSnapshotEntry>,
    ) -> Result<(), AssetProtocolError> {
        validate_token(session_token)?;

        let mut restored_assets = HashMap::<String, RegisteredAsset>::new();
        let mut restored_bytes = 0_usize;

        for asset in assets {
            if asset.bytes.len() > MAX_ASSET_BYTES {
                return Err(AssetProtocolError::AssetTooLarge);
            }

            restored_bytes = restored_bytes
                .checked_add(asset.bytes.len())
                .ok_or(AssetProtocolError::RegistryBudgetExceeded)?;

            if restored_bytes > MAX_REGISTRY_BYTES {
                return Err(AssetProtocolError::RegistryBudgetExceeded);
            }

            let AssetSessionSnapshotEntry {
                content_hash,
                content_type,
                bytes,
            } = asset;

            let registered = RegisteredAsset {
                bytes,
                content_type,
                references: 1,
            };

            if restored_assets.insert(content_hash, registered).is_some() {
                return Err(AssetProtocolError::DuplicateAsset);
            }
        }

        let mut state = self
            .state
            .write()
            .map_err(|_| AssetProtocolError::Internal)?;

        if state.sessions.contains_key(session_token) {
            return Err(AssetProtocolError::DuplicateAsset);
        }

        let next_total = state
            .total_bytes
            .checked_add(restored_bytes)
            .ok_or(AssetProtocolError::RegistryBudgetExceeded)?;

        if next_total > MAX_REGISTRY_BYTES {
            return Err(AssetProtocolError::RegistryBudgetExceeded);
        }

        state
            .sessions
            .insert(session_token.to_owned(), restored_assets);

        state.total_bytes = next_total;

        Ok(())
    }

    /// # Errors
    ///
    /// Returns an error when the underlying operation fails; the message handed
    /// to the caller is the redacted IPC message, never native detail.
    pub fn snapshot_session(
        &self,
        session_token: &str,
    ) -> Result<Vec<AssetSessionSnapshotEntry>, AssetProtocolError> {
        validate_token(session_token)?;

        let state = self
            .state
            .read()
            .map_err(|_| AssetProtocolError::Internal)?;

        let session = state
            .sessions
            .get(session_token)
            .ok_or(AssetProtocolError::NotFound)?;

        let mut snapshot = session
            .iter()
            .map(|(content_hash, asset)| AssetSessionSnapshotEntry {
                content_hash: content_hash.clone(),
                content_type: asset.content_type.clone(),
                bytes: Arc::clone(&asset.bytes),
            })
            .collect::<Vec<_>>();

        /*
         * Hash ordering makes the handoff deterministic for the v2 ZIP writer
         * regardless of HashMap iteration order.
         */
        snapshot.sort_unstable_by(|left, right| left.content_hash.cmp(&right.content_hash));

        Ok(snapshot)
    }

    /// # Errors
    ///
    /// Returns an error when the underlying operation fails; the message handed
    /// to the caller is the redacted IPC message, never native detail.
    pub fn contains(
        &self,
        session_token: &str,
        asset_token: &str,
    ) -> Result<bool, AssetProtocolError> {
        validate_token(session_token)?;
        validate_token(asset_token)?;

        let state = self
            .state
            .read()
            .map_err(|_| AssetProtocolError::Internal)?;

        Ok(state
            .sessions
            .get(session_token)
            .is_some_and(|assets| assets.contains_key(asset_token)))
    }

    pub fn response<B>(&self, request: &Request<B>) -> Response<Vec<u8>> {
        match self.resolve_request(request) {
            Ok(asset) => asset_response(&asset),
            Err(AssetProtocolError::NotFound) => empty_response(StatusCode::NOT_FOUND),
            Err(
                AssetProtocolError::InvalidToken
                | AssetProtocolError::InvalidContentHash
                | AssetProtocolError::UnsupportedContentType
                | AssetProtocolError::AssetTooLarge
                | AssetProtocolError::RegistryBudgetExceeded
                | AssetProtocolError::DuplicateAsset
                | AssetProtocolError::ReferenceOverflow,
            ) => empty_response(StatusCode::BAD_REQUEST),
            Err(AssetProtocolError::Internal) => empty_response(StatusCode::INTERNAL_SERVER_ERROR),
        }
    }

    fn resolve_request<B>(
        &self,
        request: &Request<B>,
    ) -> Result<RegisteredAsset, AssetProtocolError> {
        let uri = request.uri();

        if uri.query().is_some() {
            return Err(AssetProtocolError::InvalidToken);
        }

        let host = uri.host().unwrap_or(ASSET_PROTOCOL_HOST);

        let mut components = uri
            .path()
            .split('/')
            .filter(|component| !component.is_empty());

        if host == "poietica-asset.localhost" || host == "localhost" {
            if components.next() != Some(ASSET_PROTOCOL_HOST) {
                return Err(AssetProtocolError::InvalidToken);
            }
        } else if host != ASSET_PROTOCOL_HOST {
            return Err(AssetProtocolError::InvalidToken);
        }

        let session_token = components.next().ok_or(AssetProtocolError::InvalidToken)?;

        let asset_token = components.next().ok_or(AssetProtocolError::InvalidToken)?;

        if components.next().is_some() {
            return Err(AssetProtocolError::InvalidToken);
        }

        validate_token(session_token)?;
        validate_token(asset_token)?;

        let state = self
            .state
            .read()
            .map_err(|_| AssetProtocolError::Internal)?;

        state
            .sessions
            .get(session_token)
            .and_then(|assets| assets.get(asset_token))
            .cloned()
            .ok_or(AssetProtocolError::NotFound)
    }
}

/// # Errors
///
/// Returns an error when the underlying operation fails; the message handed
/// to the caller is the redacted IPC message, never native detail.
pub fn asset_protocol_url(
    session_token: &str,
    asset_token: &str,
) -> Result<String, AssetProtocolError> {
    validate_token(session_token)?;
    validate_token(asset_token)?;

    Ok(format!(
        "{ASSET_PROTOCOL_SCHEME}://{ASSET_PROTOCOL_HOST}/{session_token}/{asset_token}"
    ))
}

fn validate_token(value: &str) -> Result<(), AssetProtocolError> {
    if value.is_empty() || value.len() > MAX_TOKEN_BYTES {
        return Err(AssetProtocolError::InvalidToken);
    }

    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(AssetProtocolError::InvalidToken);
    }

    Ok(())
}

fn validate_content_hash(content_hash: &str) -> Result<(), AssetProtocolError> {
    if content_hash.len() != 64
        || !content_hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(AssetProtocolError::InvalidContentHash);
    }

    Ok(())
}

/// Whether the delivery protocol may serve this content type.
///
/// The vocabulary itself is owned by the persistence crate, because the
/// container format is what ultimately has to be able to carry the bytes. A
/// type this protocol accepted but the codec did not would produce an asset
/// the user can place on the canvas and then cannot save, which is the worst
/// possible moment to find out.
///
/// SVG's exclusion, and the reason for it, now live with the list.
fn validate_content_type(content_type: &str) -> Result<(), AssetProtocolError> {
    if poietica_editor_persistence_native::is_supported_asset_content_type(content_type) {
        return Ok(());
    }

    Err(AssetProtocolError::UnsupportedContentType)
}

fn asset_response(asset: &RegisteredAsset) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, asset.content_type.as_str())
        .header(CONTENT_LENGTH, asset.bytes.len().to_string())
        .header(X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(CACHE_CONTROL, "private, max-age=31536000, immutable")
        .body(asset.bytes.as_ref().clone())
        .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR))
}

fn empty_response(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(CONTENT_LENGTH, "0")
        .header(X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(CACHE_CONTROL, "no-store")
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::expect_used,
        clippy::unwrap_used,
        clippy::panic,
        clippy::indexing_slicing,
        clippy::missing_panics_doc,
        clippy::missing_errors_doc,
        clippy::too_many_lines,
        clippy::shadow_unrelated,
        reason = "tests operate on known-good fixtures; a broken assumption must fail the test loudly"
    )]

    use super::*;
    use sha2::{Digest, Sha256};

    fn request(uri: &str) -> Request<()> {
        Request::builder()
            .uri(uri)
            .body(())
            .expect("request should be valid")
    }

    fn hash(bytes: &[u8]) -> String {
        hex::encode(Sha256::digest(bytes))
    }

    fn insert(
        registry: &AssetProtocolRegistry,
        session: &str,
        content_type: &str,
        bytes: &[u8],
    ) -> String {
        let content_hash = hash(bytes);

        registry
            .insert(
                session,
                &content_hash,
                &content_hash,
                content_type,
                bytes.to_vec(),
            )
            .expect("asset should register");

        content_hash
    }

    #[test]
    fn serves_content_addressed_asset_without_exposing_a_path() {
        let registry = AssetProtocolRegistry::default();

        registry
            .open_session("session-1")
            .expect("session should open");

        let asset = insert(&registry, "session-1", "image/png", &[1, 2, 3, 4]);

        let response = registry.response(&request(&format!(
            "poietica-asset://asset/session-1/{asset}"
        )));

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(CONTENT_TYPE),
            Some(&"image/png".parse().expect("header value")),
        );
        assert_eq!(response.body(), &vec![1, 2, 3, 4]);
    }

    #[test]
    fn rejects_path_traversal_and_extra_components() {
        let registry = AssetProtocolRegistry::default();

        for uri in [
            "poietica-asset://asset/../asset",
            "poietica-asset://asset/session/asset/extra",
            "poietica-asset://asset/session\\escape/asset",
            "poietica-asset://asset/session/asset?path=secret",
        ] {
            let response = registry.response(&request(uri));

            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        }
    }

    #[test]
    fn removing_session_invalidates_all_urls() {
        let registry = AssetProtocolRegistry::default();

        registry
            .open_session("session-1")
            .expect("session should open");

        let asset = insert(&registry, "session-1", "image/png", &[1, 2, 3]);

        assert!(
            registry
                .remove_session("session-1")
                .expect("session should close")
        );

        let response = registry.response(&request(&format!(
            "poietica-asset://asset/session-1/{asset}"
        )));

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn deduplicates_equal_content_and_tracks_references() {
        let registry = AssetProtocolRegistry::default();

        registry
            .open_session("session-1")
            .expect("session should open");

        let asset = insert(&registry, "session-1", "image/png", &[1, 2, 3]);

        let duplicate = insert(&registry, "session-1", "image/png", &[1, 2, 3]);

        assert_eq!(asset, duplicate);

        let snapshot = registry
            .snapshot_session("session-1")
            .expect("snapshot should succeed");

        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot[0].content_hash(), asset);

        assert!(
            registry
                .remove("session-1", &asset)
                .expect("first reference should be removed")
        );

        assert!(
            registry
                .contains("session-1", &asset)
                .expect("asset should remain")
        );

        assert!(
            registry
                .remove("session-1", &asset)
                .expect("final reference should be removed")
        );

        assert!(
            !registry
                .contains("session-1", &asset)
                .expect("asset should be gone")
        );
    }

    #[test]
    fn rejects_non_canonical_content_identity() {
        let registry = AssetProtocolRegistry::default();

        registry
            .open_session("session-1")
            .expect("session should open");

        let bytes = vec![1, 2, 3];
        let content_hash = hash(&bytes);

        let result = registry.insert(
            "session-1",
            "different-token",
            &content_hash,
            "image/png",
            bytes,
        );

        assert_eq!(result, Err(AssetProtocolError::InvalidContentHash),);
    }

    #[test]
    fn snapshot_is_sorted_by_content_hash() {
        let registry = AssetProtocolRegistry::default();

        registry
            .open_session("session-1")
            .expect("session should open");

        insert(&registry, "session-1", "image/png", &[3]);
        insert(&registry, "session-1", "image/png", &[1]);
        insert(&registry, "session-1", "image/png", &[2]);

        let snapshot = registry
            .snapshot_session("session-1")
            .expect("snapshot should succeed");

        let hashes = snapshot
            .iter()
            .map(AssetSessionSnapshotEntry::content_hash)
            .collect::<Vec<_>>();

        assert!(hashes.windows(2).all(|pair| { pair[0] < pair[1] }));
    }

    #[allow(
        clippy::rc_buffer,
        reason = "the payload is produced as a Vec and shared read-only; Arc<[u8]> would force an extra copy"
    )]
    fn entry(bytes: &Arc<Vec<u8>>) -> AssetSessionSnapshotEntry {
        AssetSessionSnapshotEntry::verify(
            hash(bytes.as_slice()),
            "image/png".to_owned(),
            Arc::clone(bytes),
        )
        .expect("fixture entry should verify")
    }

    #[test]
    fn restores_complete_content_addressed_session() {
        let registry = AssetProtocolRegistry::default();

        let first_bytes = Arc::new(vec![1, 2, 3]);
        let second_bytes = Arc::new(vec![4, 5, 6]);

        let first_hash = hash(first_bytes.as_slice());
        let second_hash = hash(second_bytes.as_slice());

        registry
            .restore_session(
                "restored-session",
                vec![entry(&second_bytes), entry(&first_bytes)],
            )
            .expect("session should restore");

        assert!(
            registry
                .contains("restored-session", &first_hash,)
                .expect("first asset should resolve")
        );

        assert!(
            registry
                .contains("restored-session", &second_hash,)
                .expect("second asset should resolve")
        );

        let snapshot = registry
            .snapshot_session("restored-session")
            .expect("restored session should snapshot");

        assert_eq!(snapshot.len(), 2);

        assert!(
            snapshot
                .windows(2)
                .all(|pair| { pair[0].content_hash() < pair[1].content_hash() })
        );

        let first_response = registry.response(&request(&format!(
            "poietica-asset://asset/restored-session/{first_hash}"
        )));

        assert_eq!(first_response.status(), StatusCode::OK,);

        assert_eq!(first_response.body(), first_bytes.as_ref(),);
    }

    /*
     * The digest check did not disappear, it moved to the only place that can
     * establish it once. An entry claiming an identity its bytes do not have
     * can no longer be built, so no session can be restored from one.
     */
    #[test]
    fn an_entry_cannot_claim_an_identity_its_bytes_do_not_have() {
        let result = AssetSessionSnapshotEntry::verify(
            "0".repeat(64),
            "image/png".to_owned(),
            Arc::new(vec![9, 9, 9]),
        );

        assert_eq!(result, Err(AssetProtocolError::InvalidContentHash));
    }

    #[test]
    fn an_entry_cannot_carry_an_active_content_type() {
        let bytes = Arc::new(vec![1, 2, 3]);

        let result = AssetSessionSnapshotEntry::verify(
            hash(bytes.as_slice()),
            "image/svg+xml".to_owned(),
            bytes,
        );

        assert_eq!(result, Err(AssetProtocolError::UnsupportedContentType));
    }

    /*
     * Atomicity is a property of restore_session itself, so it is now exercised
     * through a rejection restore_session still owns: its own byte budget.
     */
    #[test]
    fn rejected_restore_does_not_publish_partial_session() {
        let registry = AssetProtocolRegistry::default();

        let small = Arc::new(vec![1, 2, 3]);
        let oversized = Arc::new(vec![0_u8; MAX_ASSET_BYTES + 1]);

        let result =
            registry.restore_session("failed-session", vec![entry(&small), entry(&oversized)]);

        assert_eq!(result, Err(AssetProtocolError::AssetTooLarge));

        assert!(matches!(
            registry.snapshot_session("failed-session"),
            Err(AssetProtocolError::NotFound),
        ));
    }

    #[test]
    fn duplicate_restore_hash_does_not_publish_session() {
        let registry = AssetProtocolRegistry::default();

        let bytes = Arc::new(vec![1, 2, 3]);

        let result =
            registry.restore_session("duplicate-session", vec![entry(&bytes), entry(&bytes)]);

        assert_eq!(result, Err(AssetProtocolError::DuplicateAsset),);

        assert!(matches!(
            registry.snapshot_session("duplicate-session",),
            Err(AssetProtocolError::NotFound),
        ));
    }

    #[test]
    fn rejects_active_or_unknown_content_types() {
        let registry = AssetProtocolRegistry::default();

        registry
            .open_session("session")
            .expect("session should open");

        for content_type in [
            "image/svg+xml",
            "text/html",
            "application/javascript",
            "application/octet-stream",
        ] {
            let bytes = vec![1];
            let content_hash = hash(&bytes);

            let result =
                registry.insert("session", &content_hash, &content_hash, content_type, bytes);

            assert_eq!(result, Err(AssetProtocolError::UnsupportedContentType),);
        }
    }
}
