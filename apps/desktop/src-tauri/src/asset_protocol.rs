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
    header::{
        ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE,
        X_CONTENT_TYPE_OPTIONS,
    },
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

        /*
         * 摘要在这里付一次，而且在拿写锁之前付。
         *
         * 这条入口此前只核对了 asset_token 与 content_hash 两个字符串相等，从未对
         * 字节本身做过摘要 —— 身份完全由调用方声明。而 snapshot_session 用结构体
         * 字面量直接产出 AssetSessionSnapshotEntry，绕开了 verify，于是一个谎报的
         * 身份会原样写进保存的文档：容器索引说这段字节是 A，它其实是 B。
         *
         * AssetSessionSnapshotEntry 的文档说"字段私有是因为这个保证就是这个类型的
         * 全部价值"。那个保证此前在这条路径上并不成立，现在成立。
         */
        if hex::encode(Sha256::digest(bytes.as_slice())) != content_hash {
            return Err(AssetProtocolError::InvalidContentHash);
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
            /*
             * 只比 content_type。字节不必再比：两侧的摘要都已经对着各自的字节验过，
             * 相同的 SHA-256 就是相同的字节 —— 这本来就是整套内容寻址的前提。
             *
             * 此前这里在持有写锁的情况下做一次最多 32 MB 的 memcmp，每一次重复插入
             * 都要付，而它试图给出的保证，上面那次摘要已经给了。
             */
            if existing.content_type != content_type {
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
            Ok(asset) => asset_response(&asset, requested_range(request)),
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

/// 这条资源在 webview 里的地址。
///
/// 形状随平台变，因为 WebView2 不解析自定义 scheme：Windows 上 Tauri 把注册的
/// 协议挂在 `http://<scheme>.localhost` 上，官方的 convertFileSrc 生成的正是
/// 这一条；macOS 与 Linux 用真正的 scheme。
///
/// 此前两个平台都发 `poietica-asset://`。resolve_request 一直认得
/// `poietica-asset.localhost` 这个 host，tauri.conf.json 的 CSP 也一直放行着
/// 它 —— 而全仓没有一处生成过它。于是 Windows 上每一条附件 URL 都指向一个取
/// 不到东西的地址，重启之后整条对话的图片全是破图标；实时那条路看起来正常，
/// 只是因为它走的是另一种 URL（见 transcript-store 的 data:）。
pub fn asset_protocol_url(
    session_token: &str,
    asset_token: &str,
) -> Result<String, AssetProtocolError> {
    validate_token(session_token)?;
    validate_token(asset_token)?;

    if cfg!(windows) {
        return Ok(format!(
            "http://{ASSET_PROTOCOL_SCHEME}.localhost/{ASSET_PROTOCOL_HOST}/{session_token}/{asset_token}"
        ));
    }

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

/// 这个字符串是不是一个规范的 SHA-256 摘要。
///
/// 判定本身在 attachments.rs：那里是字节落盘的地方，而磁盘上的目录名就是摘要，
/// 一个宽一格的判定在那边等于一次路径穿越。两处各写一份，迟早只有一处会被改。
fn validate_content_hash(content_hash: &str) -> Result<(), AssetProtocolError> {
    if crate::attachments::is_content_hash(content_hash) {
        return Ok(());
    }

    Err(AssetProtocolError::InvalidContentHash)
}

/// Whether the delivery protocol may serve this content type.
///
/// Allowlist of inert binary formats. Active content (SVG, HTML, JavaScript)
/// is excluded: serving it from the custom URI scheme would allow injected
/// markup to run with the same-origin privileges as the application shell.
/// 这个类型交付得了吗。
///
/// 判定留在这个文件，因为允许清单在这个文件。收件的那一侧必须在门口就问它：
/// 一份存得下、交付不了的附件（SVG、HEIC…）会让这条对话此后再也打不开 ——
/// deliver_attachments 里的 verify 会为它把整批交付判失败。
pub fn is_deliverable(content_type: &str) -> bool {
    validate_content_type(content_type).is_ok()
}

fn validate_content_type(content_type: &str) -> Result<(), AssetProtocolError> {
    const ALLOWED: &[&str] = &[
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/avif",
        "image/bmp",
        "video/mp4",
        "video/webm",
        "audio/mpeg",
        "audio/wav",
        "audio/ogg",
        "audio/webm",
        "application/pdf",
    ];

    if ALLOWED.contains(&content_type) {
        return Ok(());
    }

    Err(AssetProtocolError::UnsupportedContentType)
}

/// 请求里那个字节区间，以 `bytes=` 的两个端点原样交回；没提 Range 就是 None。
///
/// 只认单区间。多区间要回 multipart/byteranges，而没有任何浏览器会对
/// <video> 或 <img> 发多区间请求 —— 支持它等于为一条不存在的路径写一个解析器。
/// 认不出的写法退成 None，也就是整份交付：这是 RFC 9110 允许的行为
/// （`An origin server MUST ignore a Range header field that contains a
/// range unit it does not understand`），比回 416 更不容易把一个本来能播的
/// 资源变成播不了。
fn requested_range<B>(request: &Request<B>) -> Option<(Option<u64>, Option<u64>)> {
    let value = request.headers().get(RANGE)?.to_str().ok()?;
    let spec = value.trim().strip_prefix("bytes=")?.trim();

    if spec.contains(',') {
        return None;
    }

    let (first, last) = spec.split_once('-')?;

    let start = match first.trim() {
        "" => None,
        text => Some(text.parse::<u64>().ok()?),
    };

    let end = match last.trim() {
        "" => None,
        text => Some(text.parse::<u64>().ok()?),
    };

    // `bytes=-` 两端都空，不是一个区间。
    if start.is_none() && end.is_none() {
        return None;
    }

    /*
     * last-pos 小于 first-pos 的 range-spec 是无效的（RFC 9110 §14.1.1），按本文件
     * 一贯的做法退成整份交付。此前它会一路走到 asset_response，在那里
     * `bytes.get(5..=2)` 取不到切片，回一个 500 —— 一个畸形的请求头不该被报成
     * 服务端内部错误。
     */
    if let (Some(start), Some(end)) = (start, end)
        && start > end
    {
        return None;
    }

    Some((start, end))
}

/// 把请求的区间落到这份资源的实际长度上，得到一个闭区间 `[start, end]`。
///
/// 三种写法都要认，因为浏览器三种都会发：`bytes=500-999` 取一段、
/// `bytes=500-` 从某处到末尾（seek 之后的续播）、`bytes=-500` 取末尾若干字节
/// （取容器尾部的索引，mp4 的 moov 在尾部时就是这样）。
///
/// 落不到有效区间时返回 None，由调用方回 416 并带上真实长度。
fn resolve_range(requested: (Option<u64>, Option<u64>), length: u64) -> Option<(u64, u64)> {
    if length == 0 {
        return None;
    }

    let last = length - 1;

    match requested {
        (Some(start), Some(end)) if start <= last => Some((start, end.min(last))),
        (Some(start), None) if start <= last => Some((start, last)),
        (None, Some(suffix)) if suffix > 0 => Some((length.saturating_sub(suffix), last)),
        _unsatisfiable => None,
    }
}

/// 交付这份资源，整份或其中一段。
///
/// 无论对方有没有提 Range，都发 Accept-Ranges：那是「可以对我发 Range」这件事
/// 唯一的宣告方式，媒体元素据此决定进度条能不能拖。
fn asset_response(
    asset: &RegisteredAsset,
    requested: Option<(Option<u64>, Option<u64>)>,
) -> Response<Vec<u8>> {
    let length = asset.bytes.len() as u64;

    let common = Response::builder()
        .header(CONTENT_TYPE, asset.content_type.as_str())
        .header(ACCEPT_RANGES, "bytes")
        .header(X_CONTENT_TYPE_OPTIONS, "nosniff")
        // 身份是内容摘要，所以同一条 URL 的字节永远不会变。
        .header(CACHE_CONTROL, "private, max-age=31536000, immutable");

    let Some(requested) = requested else {
        return common
            .status(StatusCode::OK)
            .header(CONTENT_LENGTH, length.to_string())
            .body(asset.bytes.as_ref().clone())
            .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR));
    };

    let Some((start, end)) = resolve_range(requested, length) else {
        /*
         * 416 必须带上真实长度，否则对方无从修正自己的请求。RFC 9110 为这个
         * 状态码规定的 Content-Range 形式就是 `bytes * /<length>`。
         */
        return Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(CONTENT_RANGE, format!("bytes */{length}"))
            .header(ACCEPT_RANGES, "bytes")
            .header(CONTENT_LENGTH, "0")
            .header(X_CONTENT_TYPE_OPTIONS, "nosniff")
            .header(CACHE_CONTROL, "no-store")
            .body(Vec::new())
            .unwrap_or_else(|_| empty_response(StatusCode::RANGE_NOT_SATISFIABLE));
    };

    /*
     * 这里是唯一一次拷贝，而且只拷对方要的那一段。此前出口处是
     * `asset.bytes.as_ref().clone()`：一次完整的 memcpy，上限 MAX_ASSET_BYTES
     * （32 MB），每个请求一次。
     */
    let slice = asset
        .bytes
        .get(usize::try_from(start).unwrap_or(usize::MAX)..=usize::try_from(end).unwrap_or(0))
        .map(<[u8]>::to_vec);

    let Some(slice) = slice else {
        return empty_response(StatusCode::INTERNAL_SERVER_ERROR);
    };

    common
        .status(StatusCode::PARTIAL_CONTENT)
        .header(CONTENT_RANGE, format!("bytes {start}-{end}/{length}"))
        .header(CONTENT_LENGTH, slice.len().to_string())
        .body(slice)
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

    fn range_request(uri: &str, range: &str) -> Request<()> {
        Request::builder()
            .uri(uri)
            .header(RANGE, range)
            .body(())
            .expect("request should be valid")
    }

    /*
     * 允许清单里有 video/mp4 与 application/pdf，而媒体元素靠 206 做 seek。
     * 这几条用例把「可以对我发 Range」从一句注释变成一个会失败的断言。
     */
    #[test]
    fn serves_the_three_range_forms_browsers_actually_send() {
        let registry = AssetProtocolRegistry::default();

        registry
            .open_session("session-1")
            .expect("session should open");

        let bytes: Vec<u8> = (0..10_u8).collect();
        let asset = insert(&registry, "session-1", "video/mp4", &bytes);
        let uri = format!("poietica-asset://asset/session-1/{asset}");

        for (spec, expected_body, expected_content_range) in [
            ("bytes=2-4", vec![2, 3, 4], "bytes 2-4/10"),
            ("bytes=7-", vec![7, 8, 9], "bytes 7-9/10"),
            ("bytes=-3", vec![7, 8, 9], "bytes 7-9/10"),
            // 越界的上端点收敛到最后一个字节，不是一个错误。
            ("bytes=8-100", vec![8, 9], "bytes 8-9/10"),
        ] {
            let response = registry.response(&range_request(&uri, spec));

            assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT, "{spec}");
            assert_eq!(response.body(), &expected_body, "{spec}");
            assert_eq!(
                response.headers().get(CONTENT_RANGE),
                Some(&expected_content_range.parse().expect("header value")),
                "{spec}",
            );
        }
    }

    #[test]
    fn announces_range_support_even_without_a_range_header() {
        let registry = AssetProtocolRegistry::default();

        registry
            .open_session("session-1")
            .expect("session should open");

        let asset = insert(&registry, "session-1", "video/mp4", &[1, 2, 3]);

        let response = registry.response(&request(&format!(
            "poietica-asset://asset/session-1/{asset}"
        )));

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(ACCEPT_RANGES),
            Some(&"bytes".parse().expect("header value")),
        );
    }

    #[test]
    fn an_unsatisfiable_range_reports_the_real_length() {
        let registry = AssetProtocolRegistry::default();

        registry
            .open_session("session-1")
            .expect("session should open");

        let asset = insert(&registry, "session-1", "video/mp4", &[1, 2, 3]);

        let response = registry.response(&range_request(
            &format!("poietica-asset://asset/session-1/{asset}"),
            "bytes=99-",
        ));

        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(
            response.headers().get(CONTENT_RANGE),
            Some(&"bytes */3".parse().expect("header value")),
        );
    }

    /*
     * 认不出的 Range 退成整份交付，不是 416：RFC 9110 要求源服务器忽略它读不懂
     * 的 range unit。回 416 会把一个本来能播的资源变成播不了的。
     */
    #[test]
    fn an_unreadable_range_falls_back_to_the_whole_asset() {
        let registry = AssetProtocolRegistry::default();

        registry
            .open_session("session-1")
            .expect("session should open");

        let asset = insert(&registry, "session-1", "video/mp4", &[1, 2, 3]);
        let uri = format!("poietica-asset://asset/session-1/{asset}");

        for spec in [
            "items=0-1",
            "bytes=0-1,5-6",
            "bytes=-",
            "bytes=abc-",
            "bytes=5-2",
        ] {
            let response = registry.response(&range_request(&uri, spec));

            assert_eq!(response.status(), StatusCode::OK, "{spec}");
            assert_eq!(response.body(), &vec![1, 2, 3], "{spec}");
        }
    }

    /*
     * 生成器与解析器必须对得上，而且要按平台对。
     *
     * 上面那些用例手拼 URI，所以它们绕过了 asset_protocol_url —— 那道缝正是
     * Windows 上整条对话破图的地方。这一条从生成器出发，走完整条解析路径。
     */
    #[test]
    fn the_url_it_hands_out_resolves_on_this_platform() {
        let registry = AssetProtocolRegistry::default();

        registry
            .open_session("session-1")
            .expect("session should open");

        let asset = insert(&registry, "session-1", "image/png", &[1, 2, 3]);
        let url = asset_protocol_url("session-1", &asset).expect("url should build");

        /* 逐字比，不比前缀：上一版这里是 starts_with，而生成器把 format! 的
        大括号转义写错时吐出的是 "{http://poietica-asset}.localhost/..." ——
        一个畸形 URL，前缀断言在非 Windows 宿主上根本不会跑到。 */
        let expected = if cfg!(windows) {
            format!("http://poietica-asset.localhost/asset/session-1/{asset}")
        } else {
            format!("poietica-asset://asset/session-1/{asset}")
        };

        assert_eq!(url, expected, "生成器与解析器必须逐字对得上");

        let response = registry.response(&request(&url));

        assert_eq!(response.status(), StatusCode::OK, "{url}");
        assert_eq!(response.body(), &vec![1, 2, 3]);
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

    /*
     * 这条路径此前只比对两个字符串，字节从未被摘要过：谎报身份的插入会成功，
     * 并经 snapshot_session 原样写进保存的文档。
     */
    #[test]
    fn rejects_bytes_that_do_not_match_their_declared_identity() {
        let registry = AssetProtocolRegistry::default();

        registry
            .open_session("session-1")
            .expect("session should open");

        let declared = hash(&[1, 2, 3]);

        let result = registry.insert(
            "session-1",
            &declared,
            &declared,
            "image/png",
            vec![9, 9, 9],
        );

        assert_eq!(result, Err(AssetProtocolError::InvalidContentHash));
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
