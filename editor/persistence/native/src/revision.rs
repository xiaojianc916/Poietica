//! Strong content identity for optimistic document concurrency.
//!
//! A revision is the lowercase SHA-256 identity of the exact bytes stored on
//! disk. It is opaque outside Native and must never be interpreted as a
//! timestamp, path or mutable sequence number.

use sha2::{Digest, Sha256};
use std::io::{self, Read};

const SHA256_BYTES: usize = 32;

/// Chunk size for streaming revision calculation.
///
/// Bounds peak memory during verification to a constant, independent of the
/// container size, and is large enough that syscall overhead stays negligible.
const HASH_CHUNK_BYTES: usize = 64 * 1024;
const SHA256_HEX_LENGTH: usize = SHA256_BYTES * 2;

/// Native-only, validated identity of exact document bytes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DocumentRevision(String);

impl DocumentRevision {
    /// Calculates the revision of an exact byte sequence.
    pub fn from_bytes(content: &[u8]) -> Self {
        let digest = Sha256::digest(content);
        let revision = hex::encode(digest);

        debug_assert_eq!(revision.len(), SHA256_HEX_LENGTH);

        Self(revision)
    }

    /// Calculates the revision of a byte stream without buffering it.
    ///
    /// Verifying that a stored document has not changed requires hashing every
    /// byte, but it never requires holding every byte. Callers that only need
    /// the identity of a file on disk should use this instead of reading the
    /// file into a Vec first: the result is identical and peak memory becomes
    /// constant rather than the length of the file.
    ///
    /// The reader is consumed in fixed-size chunks, so callers should pass the
    /// File directly. Wrapping it in a BufReader would copy every byte through
    /// a second buffer for no benefit.
    pub fn from_reader<R: Read>(mut reader: R) -> io::Result<Self> {
        let mut hasher = Sha256::new();
        let mut buffer = vec![0_u8; HASH_CHUNK_BYTES];

        loop {
            let read = reader.read(&mut buffer)?;

            if read == 0 {
                break;
            }

            hasher.update(&buffer[..read]);
        }

        let revision = hex::encode(hasher.finalize());

        debug_assert_eq!(revision.len(), SHA256_HEX_LENGTH);

        Ok(Self(revision))
    }

    /// Parses an opaque revision received through IPC.
    ///
    /// Only the canonical lowercase SHA-256 representation is accepted.
    pub fn parse(value: &str) -> Option<Self> {
        if value.len() != SHA256_HEX_LENGTH {
            return None;
        }

        if value.bytes().any(|byte| byte.is_ascii_uppercase()) {
            return None;
        }

        let decoded = hex::decode(value).ok()?;

        if decoded.len() != SHA256_BYTES {
            return None;
        }

        Some(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_string(self) -> String {
        self.0
    }
}

/// Calculates the revision of an exact byte sequence.
pub fn document_revision(content: &[u8]) -> DocumentRevision {
    DocumentRevision::from_bytes(content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revision_is_stable_for_identical_bytes() {
        let first = document_revision(b"canvas");
        let second = document_revision(b"canvas");

        assert_eq!(first, second);
        assert_eq!(first.as_str().len(), SHA256_HEX_LENGTH);
    }

    #[test]
    fn revision_changes_when_any_byte_changes() {
        assert_ne!(
            document_revision(b"canvas-a"),
            document_revision(b"canvas-b"),
        );
    }

    #[test]
    fn revision_uses_exact_stored_bytes() {
        assert_ne!(
            document_revision(b"{\"value\":1}"),
            document_revision(b"{ \"value\": 1 }"),
        );
    }

    /*
     * The streaming path exists purely as a memory optimisation, so it is
     * worthless unless it is byte-for-byte equivalent to the in-memory path.
     * The chunk boundary is the interesting case: inputs shorter than, equal
     * to, and longer than one chunk must all agree.
     */
    #[test]
    fn streaming_revision_matches_in_memory_revision() {
        for length in [
            0,
            1,
            HASH_CHUNK_BYTES - 1,
            HASH_CHUNK_BYTES,
            HASH_CHUNK_BYTES + 1,
            HASH_CHUNK_BYTES * 3 + 7,
        ] {
            let content = (0..length).map(|index| index as u8).collect::<Vec<u8>>();

            let streamed = DocumentRevision::from_reader(content.as_slice())
                .expect("slice reader cannot fail");

            assert_eq!(streamed, document_revision(&content), "length {length}");
        }
    }

    #[test]
    fn parses_canonical_revision() {
        let revision = document_revision(b"canvas");

        let parsed =
            DocumentRevision::parse(revision.as_str()).expect("canonical revision should parse");

        assert_eq!(parsed, revision);
    }

    #[test]
    fn rejects_malformed_revision() {
        assert!(DocumentRevision::parse("revision").is_none());
        assert!(DocumentRevision::parse(&"0".repeat(63)).is_none());
        assert!(DocumentRevision::parse(&"0".repeat(65)).is_none());
        assert!(DocumentRevision::parse(&"A".repeat(64)).is_none());
        assert!(DocumentRevision::parse(&"z".repeat(64)).is_none());
    }
}
