//! Current Hybrid Canvas .draw container codec.
//!
//! This module owns only the physical document container. It treats the tldraw
//! store snapshot as opaque JSON and never constructs, edits or interprets
//! tldraw records.

use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Read, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const DRAW_FORMAT: &str = "hybrid-canvas/draw";
const DRAW_VERSION: u32 = 2;

const MANIFEST_PATH: &str = "manifest.json";
const DOCUMENT_PATH: &str = "document.json";
const ASSET_INDEX_PATH: &str = "assets/index.json";
const APPLICATION_METADATA_PATH: &str = "metadata/application.json";

const MAX_CONTAINER_BYTES: usize = 320 * 1024 * 1024;
const MAX_ENTRY_COUNT: usize = 1_024;
const MAX_ENTRY_BYTES: u64 = 32 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES: u64 = 256 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 200;

#[derive(Clone, Copy, Debug)]
pub struct DrawAssetInput<'a> {
    pub content_hash: &'a str,
    pub content_type: &'a str,
    pub bytes: &'a [u8],
}

#[derive(Clone, Copy, Debug)]
pub struct DrawDocumentInput<'a> {
    pub created_at: &'a str,
    pub saved_at: &'a str,
    pub document_json: &'a [u8],
    pub application_json: &'a [u8],
    pub assets: &'a [DrawAssetInput<'a>],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DrawAssetOutput {
    pub content_hash: String,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DecodedDrawDocument {
    pub created_at: String,
    pub saved_at: String,
    pub document: Value,
    pub application: Value,
    pub assets: Vec<DrawAssetOutput>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format: String,
    version: u32,
    created_at: String,
    saved_at: String,
    document: EntryDescriptor,
    assets_index: EntryDescriptor,
    application: EntryDescriptor,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EntryDescriptor {
    path: String,
    byte_length: u64,
    sha256: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetIndex {
    assets: Vec<AssetDescriptor>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetDescriptor {
    content_hash: String,
    content_type: String,
    byte_length: u64,
    path: String,
}

pub fn encode_draw_document(input: DrawDocumentInput<'_>) -> Result<Vec<u8>> {
    validate_timestamp(input.created_at, "createdAt")?;
    validate_timestamp(input.saved_at, "savedAt")?;

    let document = canonical_object_json(input.document_json, "document")?;
    let application = canonical_object_json(input.application_json, "application metadata")?;

    ensure_entry_size(document.len(), DOCUMENT_PATH)?;
    ensure_entry_size(application.len(), APPLICATION_METADATA_PATH)?;

    let mut assets = input.assets.to_vec();

    assets.sort_unstable_by(|left, right| left.content_hash.cmp(right.content_hash));

    let mut asset_entries = Vec::<(AssetDescriptor, &[u8])>::new();
    let mut previous_hash: Option<&str> = None;

    for asset in assets {
        validate_sha256(asset.content_hash)?;
        validate_content_type(asset.content_type)?;
        ensure_entry_size(asset.bytes.len(), "content-addressed asset")?;

        let actual_hash = sha256(asset.bytes);

        if actual_hash != asset.content_hash {
            return Err(corrupted("asset bytes do not match their SHA-256 identity"));
        }

        if previous_hash == Some(asset.content_hash) {
            return Err(corrupted("asset input contains a duplicate content hash"));
        }

        previous_hash = Some(asset.content_hash);

        let path = format!("assets/{}", asset.content_hash);

        asset_entries.push((
            AssetDescriptor {
                content_hash: asset.content_hash.to_owned(),
                content_type: asset.content_type.to_owned(),
                byte_length: to_u64(asset.bytes.len(), "asset length")?,
                path,
            },
            asset.bytes,
        ));
    }

    let asset_index = canonical_json(&AssetIndex {
        assets: asset_entries
            .iter()
            .map(|(descriptor, _)| AssetDescriptor {
                content_hash: descriptor.content_hash.clone(),
                content_type: descriptor.content_type.clone(),
                byte_length: descriptor.byte_length,
                path: descriptor.path.clone(),
            })
            .collect(),
    })?;

    let manifest = canonical_json(&Manifest {
        format: DRAW_FORMAT.to_owned(),
        version: DRAW_VERSION,
        created_at: input.created_at.to_owned(),
        saved_at: input.saved_at.to_owned(),
        document: descriptor(DOCUMENT_PATH, &document)?,
        assets_index: descriptor(ASSET_INDEX_PATH, &asset_index)?,
        application: descriptor(APPLICATION_METADATA_PATH, &application)?,
    })?;

    let expected_entries = asset_entries
        .len()
        .checked_add(4)
        .ok_or_else(|| corrupted("entry count overflow"))?;

    if expected_entries > MAX_ENTRY_COUNT {
        return Err(corrupted("document contains too many container entries"));
    }

    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);

    write_container_entry(&mut writer, MANIFEST_PATH, &manifest)?;
    write_container_entry(&mut writer, DOCUMENT_PATH, &document)?;
    write_container_entry(&mut writer, ASSET_INDEX_PATH, &asset_index)?;
    write_container_entry(&mut writer, APPLICATION_METADATA_PATH, &application)?;

    for (asset, bytes) in asset_entries {
        write_container_entry(&mut writer, &asset.path, bytes)?;
    }

    let bytes = writer
        .finish()
        .map_err(container_format_error)?
        .into_inner();

    if bytes.len() > MAX_CONTAINER_BYTES {
        return Err(corrupted("encoded container exceeds byte budget"));
    }

    Ok(bytes)
}

pub fn decode_draw_document(bytes: &[u8]) -> Result<DecodedDrawDocument> {
    if bytes.len() > MAX_CONTAINER_BYTES {
        return Err(corrupted("container exceeds byte budget"));
    }

    let cursor = Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor).map_err(container_format_error)?;

    if archive.len() > MAX_ENTRY_COUNT {
        return Err(corrupted("container has too many entries"));
    }

    let mut entries = BTreeMap::<String, Vec<u8>>::new();
    let mut total_uncompressed = 0_u64;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(container_format_error)?;

        if entry.is_dir() {
            return Err(corrupted("container directory entries are not allowed"));
        }

        let path = entry
            .enclosed_name()
            .ok_or_else(|| corrupted("document entry has an unsafe path"))?
            .to_str()
            .ok_or_else(|| corrupted("document entry path is not UTF-8"))?
            .to_owned();

        validate_entry_path(&path)?;

        if entries.contains_key(&path) {
            return Err(corrupted("container has a duplicate entry"));
        }

        let uncompressed = entry.size();
        let compressed = entry.compressed_size();

        if uncompressed > MAX_ENTRY_BYTES {
            return Err(corrupted("document entry exceeds byte budget"));
        }

        total_uncompressed = total_uncompressed
            .checked_add(uncompressed)
            .ok_or_else(|| corrupted("uncompressed size overflow"))?;

        if total_uncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES {
            return Err(corrupted("container exceeds total uncompressed budget"));
        }

        if uncompressed > 0 {
            if compressed == 0 {
                return Err(corrupted("document entry has an invalid compressed size"));
            }

            let ratio = uncompressed.checked_div(compressed).unwrap_or(u64::MAX);

            if ratio > MAX_COMPRESSION_RATIO {
                return Err(corrupted("document entry exceeds compression-ratio limit"));
            }
        }

        let capacity = usize::try_from(uncompressed)
            .map_err(|_| corrupted("document entry size cannot be represented"))?;

        let mut content = Vec::with_capacity(capacity);

        entry.read_to_end(&mut content).map_err(Error::from)?;

        if content.len() as u64 != uncompressed {
            return Err(corrupted("document entry length changed during extraction"));
        }

        entries.insert(path, content);
    }

    let manifest_bytes = require_entry(&entries, MANIFEST_PATH)?;

    let manifest: Manifest = parse_json(manifest_bytes, "manifest")?;

    if manifest.format != DRAW_FORMAT {
        return Err(corrupted("manifest has an unsupported format"));
    }

    if manifest.version != DRAW_VERSION {
        return Err(corrupted("manifest has an unsupported version"));
    }

    validate_timestamp(&manifest.created_at, "createdAt")?;
    validate_timestamp(&manifest.saved_at, "savedAt")?;

    validate_fixed_descriptor(&manifest.document, DOCUMENT_PATH, &entries)?;
    validate_fixed_descriptor(&manifest.assets_index, ASSET_INDEX_PATH, &entries)?;
    validate_fixed_descriptor(&manifest.application, APPLICATION_METADATA_PATH, &entries)?;

    let document_bytes = require_entry(&entries, DOCUMENT_PATH)?;
    let application_bytes = require_entry(&entries, APPLICATION_METADATA_PATH)?;
    let asset_index_bytes = require_entry(&entries, ASSET_INDEX_PATH)?;

    let document = parse_object_json(document_bytes, "document")?;
    let application = parse_object_json(application_bytes, "application metadata")?;

    let asset_index: AssetIndex = parse_json(asset_index_bytes, "asset index")?;

    let mut expected_paths = BTreeSet::from([
        MANIFEST_PATH.to_owned(),
        DOCUMENT_PATH.to_owned(),
        ASSET_INDEX_PATH.to_owned(),
        APPLICATION_METADATA_PATH.to_owned(),
    ]);

    let mut decoded_assets = Vec::new();
    let mut previous_hash: Option<&str> = None;

    for asset in &asset_index.assets {
        validate_sha256(&asset.content_hash)?;
        validate_content_type(&asset.content_type)?;

        if previous_hash == Some(asset.content_hash.as_str()) {
            return Err(corrupted("asset index contains a duplicate hash"));
        }

        if previous_hash.is_some_and(|previous| previous > asset.content_hash.as_str()) {
            return Err(corrupted("asset index is not sorted by content hash"));
        }

        previous_hash = Some(&asset.content_hash);

        let expected_path = format!("assets/{}", asset.content_hash);

        if asset.path != expected_path {
            return Err(corrupted("asset index has a non-canonical path"));
        }

        if !expected_paths.insert(asset.path.clone()) {
            return Err(corrupted("asset index contains a duplicate path"));
        }

        let content = require_entry(&entries, &asset.path)?;

        if content.len() as u64 != asset.byte_length {
            return Err(corrupted("asset length does not match its index"));
        }

        if sha256(content) != asset.content_hash {
            return Err(corrupted("asset digest does not match its index"));
        }

        decoded_assets.push(DrawAssetOutput {
            content_hash: asset.content_hash.clone(),
            content_type: asset.content_type.clone(),
            bytes: content.to_vec(),
        });
    }

    let actual_paths = entries.keys().cloned().collect::<BTreeSet<_>>();

    if actual_paths != expected_paths {
        return Err(corrupted(
            "container has missing or unknown document entries",
        ));
    }

    Ok(DecodedDrawDocument {
        created_at: manifest.created_at,
        saved_at: manifest.saved_at,
        document,
        application,
        assets: decoded_assets,
    })
}

fn write_container_entry<W>(writer: &mut ZipWriter<W>, path: &str, bytes: &[u8]) -> Result<()>
where
    W: Write + std::io::Seek,
{
    validate_entry_path(path)?;
    ensure_entry_size(bytes.len(), path)?;

    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o600);

    writer
        .start_file(path, options)
        .map_err(container_format_error)?;

    writer.write_all(bytes)?;

    Ok(())
}

fn canonical_object_json(bytes: &[u8], description: &str) -> Result<Vec<u8>> {
    let value = parse_object_json(bytes, description)?;
    canonical_json(&value)
}

fn parse_object_json(bytes: &[u8], description: &str) -> Result<Value> {
    let value: Value = parse_json(bytes, description)?;

    if !value.is_object() {
        return Err(corrupted(&format!("{description} root must be an object")));
    }

    Ok(value)
}

fn parse_json<T>(bytes: &[u8], description: &str) -> Result<T>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_slice(bytes)
        .map_err(|error| corrupted(&format!("{description} is invalid JSON: {error}")))
}

fn canonical_json<T>(value: &T) -> Result<Vec<u8>>
where
    T: Serialize,
{
    serde_json::to_vec(value)
        .map_err(|error| corrupted(&format!("JSON serialization failed: {error}")))
}

fn descriptor(path: &str, bytes: &[u8]) -> Result<EntryDescriptor> {
    Ok(EntryDescriptor {
        path: path.to_owned(),
        byte_length: to_u64(bytes.len(), "entry length")?,
        sha256: sha256(bytes),
    })
}

fn validate_fixed_descriptor(
    descriptor: &EntryDescriptor,
    expected_path: &str,
    entries: &BTreeMap<String, Vec<u8>>,
) -> Result<()> {
    if descriptor.path != expected_path {
        return Err(corrupted("manifest contains a non-canonical entry path"));
    }

    validate_sha256(&descriptor.sha256)?;

    let bytes = require_entry(entries, expected_path)?;

    if bytes.len() as u64 != descriptor.byte_length {
        return Err(corrupted(
            "manifest entry length does not match container data",
        ));
    }

    if sha256(bytes) != descriptor.sha256 {
        return Err(corrupted(
            "manifest entry digest does not match container data",
        ));
    }

    Ok(())
}

fn require_entry<'a>(entries: &'a BTreeMap<String, Vec<u8>>, path: &str) -> Result<&'a [u8]> {
    entries
        .get(path)
        .map(Vec::as_slice)
        .ok_or_else(|| corrupted(&format!("required document entry is missing: {path}")))
}

fn validate_entry_path(path: &str) -> Result<()> {
    if path.is_empty()
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.contains('\\')
        || path
            .split('/')
            .any(|component| component.is_empty() || component == "." || component == "..")
        || !path.is_ascii()
    {
        return Err(corrupted("document entry path is not canonical"));
    }

    Ok(())
}

fn validate_timestamp(value: &str, field: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > 64 {
        return Err(corrupted(&format!("{field} is missing or invalid")));
    }

    Ok(())
}

fn validate_sha256(value: &str) -> Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(corrupted("content hash is not canonical SHA-256"));
    }

    Ok(())
}

fn validate_content_type(value: &str) -> Result<()> {
    match value {
        "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "application/pdf"
        | "video/mp4" | "video/webm" | "audio/mpeg" | "audio/mp4" | "audio/ogg" | "audio/wav" => {
            Ok(())
        }
        _ => Err(corrupted("asset has an unsupported content type")),
    }
}

fn ensure_entry_size(size: usize, description: &str) -> Result<()> {
    if size as u64 > MAX_ENTRY_BYTES {
        return Err(corrupted(&format!(
            "{description} exceeds entry byte budget"
        )));
    }

    Ok(())
}

fn to_u64(value: usize, description: &str) -> Result<u64> {
    u64::try_from(value).map_err(|_| corrupted(&format!("{description} cannot be represented")))
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn corrupted(message: &str) -> Error {
    Error::CorruptedContainer(message.to_owned())
}

fn container_format_error(error: zip::result::ZipError) -> Error {
    corrupted(&format!("invalid document container: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset<'a>(bytes: &'a [u8]) -> (String, DrawAssetInput<'a>) {
        let hash = sha256(bytes);

        (
            hash.clone(),
            DrawAssetInput {
                content_hash: Box::leak(hash.into_boxed_str()),
                content_type: "image/png",
                bytes,
            },
        )
    }

    fn encode_fixture_document() -> Vec<u8> {
        let (_, first) = asset(&[1, 2, 3]);
        let (_, second) = asset(&[4, 5, 6]);

        encode_draw_document(DrawDocumentInput {
            created_at: "2026-07-23T00:00:00.000Z",
            saved_at: "2026-07-23T01:00:00.000Z",
            document_json: br#"{"schema":{},"store":{}}"#,
            application_json: br#"{"title":"fixture"}"#,
            assets: &[second, first],
        })
        .expect("fixture should encode")
    }

    #[test]
    fn round_trips_draw_document_and_assets() {
        let encoded = encode_fixture_document();

        let decoded = decode_draw_document(&encoded).expect("fixture should decode");

        assert_eq!(
            decoded.document,
            serde_json::json!({
                "schema": {},
                "store": {}
            }),
        );

        assert_eq!(
            decoded.application,
            serde_json::json!({
                "title": "fixture"
            }),
        );

        assert_eq!(decoded.assets.len(), 2);
        assert!(decoded
            .assets
            .windows(2)
            .all(|pair| { pair[0].content_hash < pair[1].content_hash }));
    }

    #[test]
    fn rejects_asset_with_false_digest() {
        let result = encode_draw_document(DrawDocumentInput {
            created_at: "2026-07-23T00:00:00.000Z",
            saved_at: "2026-07-23T01:00:00.000Z",
            document_json: br#"{"store":{}}"#,
            application_json: br#"{}"#,
            assets: &[DrawAssetInput {
                content_hash: "0".repeat(64).leak(),
                content_type: "image/png",
                bytes: &[1, 2, 3],
            }],
        });

        assert!(result.is_err());
    }

    #[test]
    fn rejects_raw_or_non_object_document_json() {
        for document in [b"not-json".as_slice(), b"[]".as_slice(), b"null".as_slice()] {
            let result = encode_draw_document(DrawDocumentInput {
                created_at: "2026-07-23T00:00:00.000Z",
                saved_at: "2026-07-23T01:00:00.000Z",
                document_json: document,
                application_json: br#"{}"#,
                assets: &[],
            });

            assert!(result.is_err());
        }
    }

    #[test]
    fn rejects_duplicate_container_entry() {
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);

        write_container_entry(&mut writer, MANIFEST_PATH, br#"{}"#)
            .expect("first entry should write");

        let duplicate_result = write_container_entry(&mut writer, MANIFEST_PATH, br#"{}"#);

        // Newer zip versions reject duplicate names while writing. Older
        // versions may allow construction, in which case the decoder must
        // still reject the resulting container.
        if duplicate_result.is_err() {
            return;
        }

        let bytes = writer
            .finish()
            .expect("container should finish")
            .into_inner();

        assert!(decode_draw_document(&bytes).is_err());
    }

    #[test]
    fn rejects_unknown_container_entry() {
        let encoded = encode_fixture_document();
        let cursor = Cursor::new(encoded);

        let mut source = ZipArchive::new(cursor).expect("fixture container");

        let output = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(output);

        for index in 0..source.len() {
            let mut entry = source.by_index(index).expect("entry");

            let mut bytes = Vec::new();

            entry.read_to_end(&mut bytes).expect("entry bytes");

            write_container_entry(&mut writer, entry.name(), &bytes).expect("copied entry");
        }

        write_container_entry(&mut writer, "unknown.bin", b"unexpected").expect("unknown entry");

        let bytes = writer
            .finish()
            .expect("container should finish")
            .into_inner();

        assert!(decode_draw_document(&bytes).is_err());
    }

    #[test]
    fn rejects_future_container_manifest_version() {
        let manifest = canonical_json(&Manifest {
            format: DRAW_FORMAT.to_owned(),
            version: DRAW_VERSION + 1,
            created_at: "2026-07-23T00:00:00.000Z".to_owned(),
            saved_at: "2026-07-23T01:00:00.000Z".to_owned(),
            document: descriptor(DOCUMENT_PATH, br#"{}"#).expect("descriptor"),
            assets_index: descriptor(ASSET_INDEX_PATH, br#"{"assets":[]}"#).expect("descriptor"),
            application: descriptor(APPLICATION_METADATA_PATH, br#"{}"#).expect("descriptor"),
        })
        .expect("manifest");

        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);

        write_container_entry(&mut writer, MANIFEST_PATH, &manifest).expect("manifest");
        write_container_entry(&mut writer, DOCUMENT_PATH, br#"{}"#).expect("document");
        write_container_entry(&mut writer, ASSET_INDEX_PATH, br#"{"assets":[]}"#).expect("index");
        write_container_entry(&mut writer, APPLICATION_METADATA_PATH, br#"{}"#).expect("metadata");

        let bytes = writer
            .finish()
            .expect("container should finish")
            .into_inner();

        assert!(decode_draw_document(&bytes).is_err());
    }
}
