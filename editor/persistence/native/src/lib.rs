#![deny(unsafe_code)]

//! Native file capability.
//!
//! Current responsibility:
//! - current .draw container encoding and decoding
//! - content-addressed binary asset storage
//! - atomic replacement of an already-validated document container
//!
//! Advisory locking, external-change watching and recovery journals remain
//! separate native lifecycle concerns.

// Windows atomic replacement requires direct calls to ReplaceFileW and
// MoveFileExW. Keep that unsafe boundary confined to this module.
#[allow(
    unsafe_code,
    reason = "Win32 atomic file replacement requires audited FFI"
)]
mod atomic_write;

mod asset_content_type;
mod draw_document_codec;
mod error;
mod revision;

pub use asset_content_type::is_supported_asset_content_type;
pub use atomic_write::atomic_write;
pub use draw_document_codec::{
    DecodedDrawDocument, DrawAssetInput, DrawAssetOutput, DrawDocumentInput, decode_draw_document,
    encode_draw_document,
};
pub use error::{Error, Result};
pub use revision::{DocumentRevision, document_revision};
