use crate::asset_protocol::{AssetProtocolError, AssetProtocolRegistry, AssetSessionSnapshotEntry};
use crate::error::{Error, IpcError, Result};
use poietica_file_native::{
    DocumentRevision, DrawAssetInput, DrawDocumentInput, atomic_write, decode_draw_document,
    document_revision, encode_draw_document,
};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock, RwLockReadGuard, RwLockWriteGuard};
use tauri::{AppHandle, State, command};
use tauri_plugin_dialog::{DialogExt, FilePath};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

const MAX_LOGICAL_DOCUMENT_BYTES: u64 = 32 * 1024 * 1024;
const MAX_CONTAINER_BYTES: u64 = 320 * 1024 * 1024;
const DRAW_EXTENSION: &str = "draw";
const DEFAULT_DOCUMENT_NAME: &str = "untitled.draw";

type DocumentCommandResult<T> = std::result::Result<T, IpcError>;

/// Opaque document identity exposed to the renderer.
///
/// The renderer never receives or submits filesystem paths. The native process
/// owns the mapping between this ID and the selected local file.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, Type)]
#[serde(transparent)]
pub struct DocumentId(Uuid);

impl DocumentId {
    fn new() -> Self {
        Self(Uuid::now_v7())
    }
}

/// Native-only document handle.
///
/// This type deliberately does not implement Serialize or Type. A filesystem
/// path is an implementation detail and must not cross the IPC boundary.
#[derive(Clone, Debug)]
struct DocumentHandle {
    path: PathBuf,
    revision: DocumentRevision,
    /// Length of the container as this session last wrote or read it.
    ///
    /// A stored file of a different length cannot hash to the same revision,
    /// so this settles the common external-edit case without reading the file.
    /// It filters; the revision still decides.
    container_len: u64,
    created_at: String,
    asset_session_token: Option<String>,
    /// Serialises saves of this document without serialising the registry.
    save_lock: Arc<Mutex<()>>,
}

/// What a save copies out of the registry before touching the disk.
struct SavePlan {
    path: PathBuf,
    created_at: String,
    container_len: u64,
}

#[derive(Clone, Debug, Default)]
pub struct DocumentRegistry {
    documents: Arc<RwLock<HashMap<DocumentId, DocumentHandle>>>,
}

impl DocumentRegistry {
    fn read(&self) -> Result<RwLockReadGuard<'_, HashMap<DocumentId, DocumentHandle>>> {
        self.documents
            .read()
            .map_err(|_| Error::Internal("document registry read lock poisoned".into()))
    }

    fn write(&self) -> Result<RwLockWriteGuard<'_, HashMap<DocumentId, DocumentHandle>>> {
        self.documents
            .write()
            .map_err(|_| Error::Internal("document registry write lock poisoned".into()))
    }

    fn handle(
        documents: &HashMap<DocumentId, DocumentHandle>,
        document_id: DocumentId,
    ) -> Result<&DocumentHandle> {
        documents
            .get(&document_id)
            .ok_or_else(|| Error::NotFound("document session does not exist".into()))
    }

    /// Hands out the save lock of one document and releases the registry.
    fn save_lock(&self, document_id: DocumentId) -> Result<Arc<Mutex<()>>> {
        let documents = self.read()?;

        Ok(Arc::clone(&Self::handle(&documents, document_id)?.save_lock))
    }

    /// Publishes the outcome of a completed write.
    ///
    /// Callers hold this document's save lock, so no other save can have moved
    /// the handle. A missing entry therefore means the session was closed while
    /// the bytes were being written; the file is already durable and the caller
    /// is told the session no longer exists.
    fn commit(
        &self,
        document_id: DocumentId,
        path: &Path,
        revision: DocumentRevision,
        container_len: u64,
        asset_session_token: Option<String>,
    ) -> Result<()> {
        let mut documents = self.write()?;

        let handle = documents.get_mut(&document_id).ok_or_else(|| {
            Error::NotFound("document session was closed while saving".into())
        })?;

        handle.path = path.to_owned();
        handle.revision = revision;
        handle.container_len = container_len;
        handle.asset_session_token = asset_session_token;

        Ok(())
    }

    fn insert(
        &self,
        path: PathBuf,
        revision: DocumentRevision,
        container_len: u64,
        created_at: String,
        asset_session_token: Option<String>,
    ) -> Result<DocumentId> {
        let document_id = DocumentId::new();
        let mut documents = self.write()?;

        documents.insert(
            document_id,
            DocumentHandle {
                path,
                revision,
                container_len,
                created_at,
                asset_session_token,
                save_lock: Arc::new(Mutex::new(())),
            },
        );

        Ok(document_id)
    }

    fn path(&self, document_id: DocumentId) -> Result<PathBuf> {
        let documents = self.read()?;

        Ok(Self::handle(&documents, document_id)?.path.clone())
    }

    /// Moves an existing session to a newly selected file.
    ///
    /// Shares the per-document save lock with save_existing, so a Save As and a
    /// Save of the same document cannot interleave, while leaving the registry
    /// available to every other document throughout.
    fn save_as_existing(
        &self,
        document_id: DocumentId,
        path: PathBuf,
        content: &str,
        asset_session_token: Option<String>,
        assets: &[AssetSessionSnapshotEntry],
    ) -> Result<DocumentRevision> {
        ensure_draw_document_path(&path)?;

        let save_lock = self.save_lock(document_id)?;
        let _save_guard = save_lock
            .lock()
            .map_err(|_| Error::Internal("document save lock poisoned".into()))?;

        let created_at = {
            let documents = self.read()?;
            let handle = Self::handle(&documents, document_id)?;

            validate_asset_session_transition(
                handle.asset_session_token.as_deref(),
                asset_session_token.as_deref(),
            )?;

            handle.created_at.clone()
        };

        let encoded = encode_document(content, &created_at, assets)?;
        atomic_write(&path, &encoded)?;

        let revision = document_revision(&encoded);

        self.commit(
            document_id,
            &path,
            revision.clone(),
            encoded.len() as u64,
            asset_session_token,
        )?;

        Ok(revision)
    }

    /// Compare-and-swap the stored document.
    ///
    /// The registry lock is a guard over a map of sessions. It is deliberately
    /// not held across any filesystem operation here: doing so would make an
    /// unrelated document's open, close or path lookup wait behind this
    /// document's fsync, and would serialise saves that share nothing.
    ///
    /// Atomicity of the compare-and-swap is provided instead by a lock owned by
    /// this document, so exactly the operations that must not interleave are
    /// the operations that contend.
    fn save_existing(
        &self,
        document_id: DocumentId,
        expected_revision: &str,
        content: &str,
        asset_session_token: Option<String>,
        assets: &[AssetSessionSnapshotEntry],
    ) -> Result<DocumentRevision> {
        let expected_revision = DocumentRevision::parse(expected_revision).ok_or_else(|| {
            Error::Validation("expected revision must be canonical SHA-256".into())
        })?;

        let save_lock = self.save_lock(document_id)?;
        let _save_guard = save_lock
            .lock()
            .map_err(|_| Error::Internal("document save lock poisoned".into()))?;

        // Everything the write needs is copied out here so that the registry is
        // unlocked for the duration of the disk work below.
        let plan = {
            let documents = self.read()?;
            let handle = Self::handle(&documents, document_id)?;

            if handle.revision != expected_revision {
                return Err(Error::FileConflict(
                    "renderer document revision is stale".into(),
                ));
            }

            validate_asset_session_transition(
                handle.asset_session_token.as_deref(),
                asset_session_token.as_deref(),
            )?;

            ensure_draw_document_path(&handle.path)?;

            SavePlan {
                path: handle.path.clone(),
                created_at: handle.created_at.clone(),
                container_len: handle.container_len,
            }
        };

        verify_unchanged_on_disk(&plan.path, plan.container_len, &expected_revision)?;

        let encoded = encode_document(content, &plan.created_at, assets)?;
        atomic_write(&plan.path, &encoded)?;

        let next_revision = document_revision(&encoded);

        self.commit(
            document_id,
            &plan.path,
            next_revision.clone(),
            encoded.len() as u64,
            asset_session_token,
        )?;

        Ok(next_revision)
    }

    fn remove(&self, document_id: DocumentId) -> Result<DocumentHandle> {
        self.write()?
            .remove(&document_id)
            .ok_or_else(|| Error::NotFound("document session does not exist".into()))
    }

    fn restore(&self, document_id: DocumentId, handle: DocumentHandle) -> Result<()> {
        self.write()?.insert(document_id, handle);

        Ok(())
    }
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DocumentOpenResult {
    pub document_id: DocumentId,
    pub display_name: String,
    pub content: String,
    pub revision: String,
    pub asset_session_token: Option<String>,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DocumentOpenResponse {
    pub document: Option<DocumentOpenResult>,
}

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSaveRequest {
    pub document_id: DocumentId,
    pub expected_revision: String,
    pub content: String,
    pub asset_session_token: Option<String>,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSaveResult {
    pub revision: String,
}

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSaveAsRequest {
    /// None creates a new native document session.
    ///
    /// Some(document_id) moves the existing session to the newly selected file.
    pub document_id: Option<DocumentId>,
    pub content: String,
    pub asset_session_token: Option<String>,
    pub suggested_name: Option<String>,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSaveAsResult {
    pub document: Option<DocumentDescriptor>,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDescriptor {
    pub document_id: DocumentId,
    pub display_name: String,
    pub revision: String,
}

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DocumentCloseRequest {
    pub document_id: DocumentId,
}

/// Opens one .draw file selected by the native file dialog.
///
/// No caller-controlled path is accepted.
#[command]
#[specta::specta]
pub async fn document_open(
    app: AppHandle,
    documents: State<'_, DocumentRegistry>,
    assets: State<'_, AssetProtocolRegistry>,
) -> DocumentCommandResult<DocumentOpenResponse> {
    let selected = select_open_document(&app).await?;

    let Some(selected) = selected else {
        return Ok(DocumentOpenResponse { document: None });
    };

    let path = selected_native_path(selected)?;
    ensure_draw_document_path(&path)?;

    let (decoded, revision, container_len) = read_document(path.clone()).await?;

    let asset_session_token = if decoded.assets.is_empty() {
        None
    } else {
        let token = Uuid::now_v7().simple().to_string();

        assets
            .restore_session(&token, decoded.assets)
            .map_err(map_asset_error)?;

        Some(token)
    };

    let document_id = match documents.insert(
        path.clone(),
        revision.clone(),
        container_len,
        decoded.created_at,
        asset_session_token.clone(),
    ) {
        Ok(document_id) => document_id,
        Err(error) => {
            if let Some(token) = &asset_session_token {
                let _ = assets.remove_session(token);
            }
            return Err(error.into());
        }
    };

    Ok(DocumentOpenResponse {
        document: Some(DocumentOpenResult {
            document_id,
            display_name: display_name(&path),
            content: decoded.content,
            revision: revision.into_string(),
            asset_session_token,
        }),
    })
}

/// Creates a new document session or moves an existing session through a native
/// Save As dialog. No filesystem path is accepted from the renderer.
#[command]
#[specta::specta]
pub async fn document_save_as(
    app: AppHandle,
    documents: State<'_, DocumentRegistry>,
    assets: State<'_, AssetProtocolRegistry>,
    request: DocumentSaveAsRequest,
) -> DocumentCommandResult<DocumentSaveAsResult> {
    ensure_logical_document_size(request.content.len() as u64)?;

    if let Some(document_id) = request.document_id {
        let _ = documents.path(document_id)?;
    }

    let asset_snapshot = snapshot_assets(&assets, request.asset_session_token.as_deref())?;

    let suggested_name = normalize_suggested_name(request.suggested_name.as_deref())?;

    let selected = select_save_document(&app, suggested_name).await?;

    let Some(selected) = selected else {
        return Ok(DocumentSaveAsResult { document: None });
    };

    let path = selected_native_path(selected)?;
    ensure_draw_document_path(&path)?;

    let (document_id, revision) = match request.document_id {
        Some(document_id) => {
            let registry = documents.inner().clone();
            let save_path = path.clone();
            let content = request.content;
            let asset_session_token = request.asset_session_token;

            let revision = tokio::task::spawn_blocking(move || {
                registry.save_as_existing(
                    document_id,
                    save_path,
                    &content,
                    asset_session_token,
                    &asset_snapshot,
                )
            })
            .await
            .map_err(|_| {
                Error::Internal("document Save As task terminated unexpectedly".into())
            })??;

            (document_id, revision)
        }
        None => {
            let created_at = now_timestamp()?;

            let (revision, container_len) = write_document(
                path.clone(),
                request.content,
                created_at.clone(),
                asset_snapshot,
            )
            .await?;

            let document_id = documents.insert(
                path.clone(),
                revision.clone(),
                container_len,
                created_at,
                request.asset_session_token,
            )?;

            (document_id, revision)
        }
    };

    Ok(DocumentSaveAsResult {
        document: Some(DocumentDescriptor {
            document_id,
            display_name: display_name(&path),
            revision: revision.into_string(),
        }),
    })
}

/// Saves content to the document already selected by a native dialog.
///
/// The renderer supplies an opaque document ID, never a local path.
#[command]
#[specta::specta]
pub async fn document_save(
    documents: State<'_, DocumentRegistry>,
    assets: State<'_, AssetProtocolRegistry>,
    request: DocumentSaveRequest,
) -> DocumentCommandResult<DocumentSaveResult> {
    let asset_snapshot = snapshot_assets(&assets, request.asset_session_token.as_deref())?;

    let registry = documents.inner().clone();

    let revision = tokio::task::spawn_blocking(move || {
        registry.save_existing(
            request.document_id,
            &request.expected_revision,
            &request.content,
            request.asset_session_token,
            &asset_snapshot,
        )
    })
    .await
    .map_err(|_| Error::Internal("document CAS save task terminated unexpectedly".into()))??;

    Ok(DocumentSaveResult {
        revision: revision.into_string(),
    })
}

/// Ends the native document session and releases its private file handle.
#[command]
#[specta::specta]
pub fn document_close(
    documents: State<'_, DocumentRegistry>,
    assets: State<'_, AssetProtocolRegistry>,
    request: DocumentCloseRequest,
) -> DocumentCommandResult<()> {
    let handle = documents.remove(request.document_id)?;

    if let Some(token) = &handle.asset_session_token {
        if let Err(error) = assets.remove_session(token) {
            documents.restore(request.document_id, handle)?;
            return Err(map_asset_error(error).into());
        }
    }

    Ok(())
}

async fn select_open_document(app: &AppHandle) -> Result<Option<FilePath>> {
    let (sender, receiver) = tokio::sync::oneshot::channel();

    app.dialog()
        .file()
        .add_filter("Poietica document", &[DRAW_EXTENSION])
        .pick_file(move |selected| {
            let _ = sender.send(selected);
        });

    receiver
        .await
        .map_err(|_| Error::Internal("document open dialog callback was dropped".into()))
}

async fn select_save_document(app: &AppHandle, suggested_name: String) -> Result<Option<FilePath>> {
    let (sender, receiver) = tokio::sync::oneshot::channel();

    app.dialog()
        .file()
        .add_filter("Poietica document", &[DRAW_EXTENSION])
        .set_file_name(suggested_name)
        .save_file(move |selected| {
            let _ = sender.send(selected);
        });

    receiver
        .await
        .map_err(|_| Error::Internal("document save dialog callback was dropped".into()))
}

struct DecodedDocument {
    content: String,
    created_at: String,
    assets: Vec<AssetSessionSnapshotEntry>,
}

/*
 * Both size checks are load bearing. The first rejects an oversized container
 * from its metadata before a byte is read; the second catches a file that grew
 * between the metadata call and the read. They are not duplicates.
 */
async fn read_document(path: PathBuf) -> Result<(DecodedDocument, DocumentRevision, u64)> {
    let metadata = tokio::fs::metadata(&path).await?;
    ensure_container_size(metadata.len())?;

    let bytes = tokio::fs::read(&path).await?;
    ensure_container_size(bytes.len() as u64)?;

    tokio::task::spawn_blocking(move || {
        let container_len = bytes.len() as u64;
        let revision = document_revision(&bytes);
        let decoded = decode_document(&bytes)?;

        Ok((decoded, revision, container_len))
    })
    .await
    .map_err(|_| Error::Internal("document decode task terminated unexpectedly".into()))?
}

async fn write_document(
    path: PathBuf,
    content: String,
    created_at: String,
    assets: Vec<AssetSessionSnapshotEntry>,
) -> Result<(DocumentRevision, u64)> {
    tokio::task::spawn_blocking(move || {
        let encoded = encode_document(&content, &created_at, &assets)?;

        atomic_write(&path, &encoded)?;

        Ok((document_revision(&encoded), encoded.len() as u64))
    })
    .await
    .map_err(|_| Error::Internal("document save task terminated unexpectedly".into()))?
}

fn decode_document(bytes: &[u8]) -> Result<DecodedDocument> {
    if !bytes.starts_with(b"PK\x03\x04") {
        return Err(Error::Validation(
            "selected .draw file uses an unsupported internal format".into(),
        ));
    }

    let decoded = decode_draw_document(bytes)?;

    /*
     * decode_draw_document rejects the whole container unless every asset digest
     * matches its index, so the guarantee the entry type asks for has already
     * been established over these exact bytes, in this call, with nothing in
     * between. Rebuilding it here hashed every asset in the document a second
     * time; Arc::from copied every one of them a second time.
     */
    let assets = decoded
        .assets
        .into_iter()
        .map(|asset| {
            AssetSessionSnapshotEntry::from_verified_container(
                asset.content_hash,
                asset.content_type,
                asset.bytes,
            )
        })
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(map_asset_error)?;

    Ok(DecodedDocument {
        content: serde_json::to_string(&decoded.document)?,
        created_at: decoded.created_at,
        assets,
    })
}

fn encode_document(
    content: &str,
    created_at: &str,
    assets: &[AssetSessionSnapshotEntry],
) -> Result<Vec<u8>> {
    ensure_logical_document_size(content.len() as u64)?;

    let saved_at = now_timestamp()?;

    let asset_inputs = assets
        .iter()
        .map(|asset| DrawAssetInput {
            content_hash: asset.content_hash(),
            content_type: asset.content_type(),
            bytes: asset.bytes().as_slice(),
        })
        .collect::<Vec<_>>();

    Ok(encode_draw_document(DrawDocumentInput {
        created_at,
        saved_at: &saved_at,
        document_json: content.as_bytes(),
        application_json: br#"{}"#,
        assets: &asset_inputs,
    })?)
}

/// Confirms the stored container still carries the revision this session last
/// saw, without loading it and without holding the registry lock.
///
/// Length is checked first only because a container of a different length
/// cannot hash to the same revision: that case is decided having read zero
/// bytes. When the length matches, the exact bytes decide. Length filters,
/// the hash rules.
fn verify_unchanged_on_disk(
    path: &Path,
    expected_len: u64,
    expected_revision: &DocumentRevision,
) -> Result<()> {
    let stored = match std::fs::File::open(path) {
        Ok(stored) => stored,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(Error::FileConflict(
                "document was removed outside Canvas".into(),
            ));
        }
        Err(error) => return Err(error.into()),
    };

    let actual_len = stored.metadata()?.len();

    // Runs against metadata, so an oversized container is rejected before any
    // byte is read rather than after it has been allocated.
    ensure_container_size(actual_len)?;

    if actual_len != expected_len {
        return Err(Error::FileConflict(
            "document changed outside Canvas".into(),
        ));
    }

    // Streamed in fixed chunks: peak memory is constant rather than the length
    // of the container, which may embed every asset in the document.
    if DocumentRevision::from_reader(stored)? != *expected_revision {
        return Err(Error::FileConflict(
            "document changed outside Canvas".into(),
        ));
    }

    Ok(())
}

fn snapshot_assets(
    assets: &AssetProtocolRegistry,
    token: Option<&str>,
) -> Result<Vec<AssetSessionSnapshotEntry>> {
    match token {
        Some(token) => assets.snapshot_session(token).map_err(map_asset_error),
        None => Ok(Vec::new()),
    }
}

fn validate_asset_session_transition(current: Option<&str>, next: Option<&str>) -> Result<()> {
    if current.is_some() && current != next {
        return Err(Error::Validation(
            "document asset-session capability changed unexpectedly".into(),
        ));
    }

    Ok(())
}

fn map_asset_error(error: AssetProtocolError) -> Error {
    match error {
        AssetProtocolError::NotFound => Error::NotFound("asset session does not exist".into()),
        AssetProtocolError::Internal => Error::Internal("asset registry unavailable".into()),
        _ => Error::Asset("asset registry rejected document resources".into()),
    }
}

fn now_timestamp() -> Result<String> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|_| Error::Internal("failed to format document timestamp".into()))
}

fn selected_native_path(selected: FilePath) -> Result<PathBuf> {
    match selected {
        FilePath::Path(path) => Ok(path),
        FilePath::Url(_) => Err(Error::Validation(
            "selected document must be a local filesystem path".into(),
        )),
    }
}

fn ensure_logical_document_size(size: u64) -> Result<()> {
    if size <= MAX_LOGICAL_DOCUMENT_BYTES {
        return Ok(());
    }

    Err(Error::Validation(
        "document exceeds the supported size limit".into(),
    ))
}

fn ensure_container_size(size: u64) -> Result<()> {
    if size <= MAX_CONTAINER_BYTES {
        return Ok(());
    }

    Err(Error::Validation(
        "document container exceeds the supported size limit".into(),
    ))
}

fn ensure_draw_document_path(path: &Path) -> Result<()> {
    let is_draw_document = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(DRAW_EXTENSION));

    if is_draw_document {
        return Ok(());
    }

    Err(Error::Validation(
        "selected file must use the .draw extension".into(),
    ))
}

fn normalize_suggested_name(value: Option<&str>) -> Result<String> {
    let name = value.unwrap_or(DEFAULT_DOCUMENT_NAME).trim();

    if name.is_empty() {
        return Ok(DEFAULT_DOCUMENT_NAME.to_owned());
    }

    if name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
        || Path::new(name).components().count() != 1
    {
        return Err(Error::Validation(
            "suggested document name must not contain a path".into(),
        ));
    }

    if name
        .rsplit_once('.')
        .is_some_and(|(_, extension)| extension.eq_ignore_ascii_case(DRAW_EXTENSION))
    {
        return Ok(name.to_owned());
    }

    Ok(format!("{name}.{DRAW_EXTENSION}"))
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("untitled.draw")
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn logical_store_snapshot(marker: &str) -> String {
        serde_json::json!({
            "schema": {},
            "store": {
                "marker": marker
            }
        })
        .to_string()
    }

    #[test]
    fn rejects_non_container_documents() {
        let legacy = serde_json::json!({
            "header": {
                "format": "poietica/draw",
                "version": 1,
                "createdAt": "2026-07-23T00:00:00.000Z"
            },
            "content": {
                "document": {
                    "schema": {},
                    "store": {
                        "marker": "legacy"
                    }
                },
                "session": {}
            }
        })
        .to_string()
        .into_bytes();

        let result = decode_document(&legacy);

        assert!(matches!(result, Err(Error::Validation(_))));
    }

    #[test]
    fn writer_emits_draw_container() {
        let bytes = encode_document(
            &logical_store_snapshot("container"),
            "2026-07-23T00:00:00.000Z",
            &[],
        )
        .expect("encode should succeed");

        assert!(bytes.starts_with(b"PK\x03\x04"));

        let decoded = decode_draw_document(&bytes).expect("written document should decode");

        assert_eq!(decoded.document["store"]["marker"], "container");
    }

    #[test]
    fn save_writes_draw_container_and_advances_revision() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("cas.draw");
        let created_at = "2026-07-23T00:00:00.000Z";

        let original = encode_document(&logical_store_snapshot("original"), created_at, &[])
            .expect("fixture should encode");

        std::fs::write(&path, &original).expect("fixture should write");

        let original_revision = document_revision(&original);

        let registry = DocumentRegistry::default();
        let document_id = registry
            .insert(
                path.clone(),
                original_revision.clone(),
                original.len() as u64,
                created_at.to_owned(),
                None,
            )
            .expect("document should register");

        let next_revision = registry
            .save_existing(
                document_id,
                &original_revision.clone().into_string(),
                &logical_store_snapshot("replacement"),
                None,
                &[],
            )
            .expect("CAS save should succeed");

        assert_ne!(next_revision, original_revision);

        let stored = std::fs::read(&path).expect("stored document should read");
        assert!(stored.starts_with(b"PK\x03\x04"));
        assert_eq!(document_revision(&stored), next_revision);
    }

    #[test]
    fn cas_rejects_external_change_without_overwriting() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("conflict.draw");
        let created_at = "2026-07-23T00:00:00.000Z";

        let original = encode_document(&logical_store_snapshot("original"), created_at, &[])
            .expect("fixture should encode");

        std::fs::write(&path, &original).expect("fixture should write");

        let original_revision = document_revision(&original);

        let registry = DocumentRegistry::default();
        let document_id = registry
            .insert(
                path.clone(),
                original_revision.clone(),
                original.len() as u64,
                created_at.to_owned(),
                None,
            )
            .expect("document should register");

        std::fs::write(&path, b"external change").expect("external edit should write");

        let result = registry.save_existing(
            document_id,
            &original_revision.clone().into_string(),
            &logical_store_snapshot("replacement"),
            None,
            &[],
        );

        assert!(matches!(result, Err(Error::FileConflict(_))));
        assert_eq!(
            std::fs::read(&path).expect("file should remain"),
            b"external change",
        );
    }

    /*
     * The length fast path would be a silent data-loss bug if length were ever
     * treated as the verdict. This tampers with the stored container in place,
     * leaving its length identical, so the only thing that can reject the save
     * is the hash of the exact bytes.
     */
    #[test]
    fn cas_rejects_same_length_external_change() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("tampered.draw");
        let created_at = "2026-07-23T00:00:00.000Z";

        let original = encode_document(&logical_store_snapshot("original"), created_at, &[])
            .expect("fixture should encode");

        std::fs::write(&path, &original).expect("fixture should write");

        let original_revision = document_revision(&original);

        let registry = DocumentRegistry::default();
        let document_id = registry
            .insert(
                path.clone(),
                original_revision.clone(),
                original.len() as u64,
                created_at.to_owned(),
                None,
            )
            .expect("document should register");

        let mut tampered = original.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 0xFF;

        assert_eq!(tampered.len(), original.len(), "tampering must preserve length");
        assert_ne!(tampered, original, "tampering must change the bytes");

        std::fs::write(&path, &tampered).expect("external edit should write");

        let result = registry.save_existing(
            document_id,
            &original_revision.clone().into_string(),
            &logical_store_snapshot("replacement"),
            None,
            &[],
        );

        assert!(matches!(result, Err(Error::FileConflict(_))));
        assert_eq!(
            std::fs::read(&path).expect("file should remain"),
            tampered,
            "a rejected save must not overwrite",
        );
    }

    /*
     * The registry must stay usable while a document is being written. If the
     * save ever reacquires the registry lock for the duration of its disk work
     * again, an unrelated lookup taken mid-save will deadlock this test rather
     * than merely slow the application down.
     */
    #[test]
    fn saving_one_document_leaves_the_registry_available() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let created_at = "2026-07-23T00:00:00.000Z";

        let registry = DocumentRegistry::default();

        let busy_path = directory.path().join("busy.draw");
        let busy = encode_document(&logical_store_snapshot("busy"), created_at, &[])
            .expect("fixture should encode");
        std::fs::write(&busy_path, &busy).expect("fixture should write");

        let busy_id = registry
            .insert(
                busy_path.clone(),
                document_revision(&busy),
                busy.len() as u64,
                created_at.to_owned(),
                None,
            )
            .expect("document should register");

        let idle_path = directory.path().join("idle.draw");
        let idle_id = registry
            .insert(
                idle_path.clone(),
                document_revision(b""),
                0,
                created_at.to_owned(),
                None,
            )
            .expect("document should register");

        // Held for the whole save: an unrelated document's save lock must not
        // be reachable from the busy document's write path.
        let idle_guard = registry.save_lock(idle_id).expect("idle save lock");
        let _idle_held = idle_guard.lock().expect("idle save lock should be free");

        registry
            .save_existing(
                busy_id,
                document_revision(&busy).as_str(),
                &logical_store_snapshot("replacement"),
                None,
                &[],
            )
            .expect("an unrelated held save lock must not block this save");

        assert_eq!(
            registry.path(idle_id).expect("registry should stay readable"),
            idle_path,
        );
    }

    #[test]
    fn suggested_name_never_accepts_path() {
        assert!(normalize_suggested_name(Some("../secret.draw")).is_err());
        assert!(normalize_suggested_name(Some("folder/document.draw")).is_err());
        assert!(normalize_suggested_name(Some("folder\\document.draw")).is_err());
    }
}
