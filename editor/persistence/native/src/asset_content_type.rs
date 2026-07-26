//! The vocabulary of content types a .draw container admits.
//!
//! This is the single place where a content type becomes legal. It lives in
//! the persistence crate because the container format is what ultimately has
//! to be able to carry the bytes: a type the codec cannot write is a type no
//! other layer may accept.
//!
//! Before this module the same eleven-arm list existed three times: once in
//! the codec's validator, once in the desktop delivery protocol's validator,
//! and as a nine-arm subset in the compression table. Nothing tied them
//! together. Adding a type to the protocol but not to the codec produced an
//! asset the user could place on the canvas and then could not save; adding
//! it to the codec but not to the protocol produced a document that saved and
//! then would not reopen. Both failures surface only at the moment they cost
//! the user work.
//!
//! Now a content type is one row, and the row carries the compression
//! decision as a field rather than as a second list, so a type cannot be
//! added without answering that question.

/// One content type the container admits.
#[derive(Clone, Copy, Debug)]
pub struct AssetContentType {
    /// The exact MIME string.
    ///
    /// Matching is exact and case-sensitive. This is a closed vocabulary, not
    /// a parser for the Content-Type header grammar: a parameter or a
    /// different case is a different string and is rejected.
    pub mime: &'static str,

    /// Whether the payload is already entropy coded by its own format.
    ///
    /// True means Deflate would walk every byte on every save to save
    /// approximately nothing, so the container stores it verbatim. False means
    /// the payload is genuinely compressible: audio/wav is linear PCM, and
    /// application/pdf may embed uncompressed streams.
    pub entropy_coded: bool,
}

/// Every content type a .draw container admits.
///
/// SVG is deliberately absent. It is active content and requires a dedicated
/// sanitizer and CSP policy before it may enter either the container or the
/// delivery protocol.
pub const ASSET_CONTENT_TYPES: &[AssetContentType] = &[
    AssetContentType {
        mime: "image/png",
        entropy_coded: true,
    },
    AssetContentType {
        mime: "image/jpeg",
        entropy_coded: true,
    },
    AssetContentType {
        mime: "image/webp",
        entropy_coded: true,
    },
    AssetContentType {
        mime: "image/gif",
        entropy_coded: true,
    },
    AssetContentType {
        mime: "application/pdf",
        entropy_coded: false,
    },
    AssetContentType {
        mime: "video/mp4",
        entropy_coded: true,
    },
    AssetContentType {
        mime: "video/webm",
        entropy_coded: true,
    },
    AssetContentType {
        mime: "audio/mpeg",
        entropy_coded: true,
    },
    AssetContentType {
        mime: "audio/mp4",
        entropy_coded: true,
    },
    AssetContentType {
        mime: "audio/ogg",
        entropy_coded: true,
    },
    AssetContentType {
        mime: "audio/wav",
        entropy_coded: false,
    },
];

/// Looks up a content type by its exact MIME string.
///
/// A linear scan over eleven entries. This runs once per asset per save and
/// per open, never per byte, so an index would buy nothing measurable and
/// would cost a lazily initialised static.
pub fn asset_content_type(mime: &str) -> Option<&'static AssetContentType> {
    ASSET_CONTENT_TYPES.iter().find(|entry| entry.mime == mime)
}

/// Whether a .draw container may carry this content type.
pub fn is_supported_asset_content_type(mime: &str) -> bool {
    asset_content_type(mime).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    /*
     * A duplicate row would make one of the two unreachable and would make the
     * table quietly self-contradictory about compression.
     */
    #[test]
    fn every_content_type_appears_exactly_once() {
        for (index, entry) in ASSET_CONTENT_TYPES.iter().enumerate() {
            assert!(
                !ASSET_CONTENT_TYPES[..index]
                    .iter()
                    .any(|earlier| earlier.mime == entry.mime),
                "duplicate content type: {}",
                entry.mime,
            );
        }
    }

    /// Active content must never become admissible by accident.
    #[test]
    fn active_and_unknown_content_is_not_admitted() {
        for mime in [
            "image/svg+xml",
            "text/html",
            "application/javascript",
            "application/octet-stream",
            "",
        ] {
            assert!(
                !is_supported_asset_content_type(mime),
                "must be rejected: {mime}",
            );
        }
    }

    /*
     * Exactness is a security property, not a style choice. A tolerant match
     * would let a caller smuggle an unreviewed type past the whitelist by
     * decorating a reviewed one.
     */
    #[test]
    fn matching_is_exact() {
        assert!(is_supported_asset_content_type("image/png"));

        assert!(!is_supported_asset_content_type("Image/PNG"));
        assert!(!is_supported_asset_content_type(
            "image/png; charset=binary"
        ));
        assert!(!is_supported_asset_content_type(" image/png"));
        assert!(!is_supported_asset_content_type("image/png "));
    }

    /*
     * The two entries that must not be stored are the reason the flag exists
     * at all, so they are pinned rather than left to the table's honesty.
     */
    #[test]
    fn compressible_entries_are_marked_compressible() {
        for mime in ["audio/wav", "application/pdf"] {
            let entry = asset_content_type(mime).expect("entry should exist");

            assert!(!entry.entropy_coded, "{mime} must stay compressible");
        }
    }
}
