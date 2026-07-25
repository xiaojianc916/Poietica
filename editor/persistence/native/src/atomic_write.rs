//! Crash-safe replacement of a document file.
//!
//! The persistence contract has exactly one physical save algorithm:
//!
//! 1. Create a uniquely named temporary file in the destination directory.
//! 2. Write the complete document.
//! 3. Synchronize the temporary file.
//! 4. Atomically replace the destination with the platform primitive.
//! 5. Synchronize the containing directory where the platform supports it.
//!
//! Keeping the temporary file in the destination directory guarantees that the
//! replacement remains on one filesystem.
//!
//! There is deliberately no delete, copy, truncate or non-atomic fallback. If
//! the platform replacement fails, the existing destination remains untouched
//! and the save operation fails.

use crate::{Error, Result};
use std::io::Write;
use std::path::Path;

#[cfg(windows)]
use std::ffi::OsStr;
#[cfg(windows)]
use std::iter::once;
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
#[cfg(windows)]
use std::ptr::{null, null_mut};
#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::{
    MoveFileExW, ReplaceFileW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

#[cfg(not(any(unix, windows)))]
compile_error!(
    "hybrid-canvas-file-native requires an audited atomic replacement implementation for this platform"
);

const TEMPORARY_FILE_PREFIX: &str = ".hybrid-canvas-";
const TEMPORARY_FILE_SUFFIX: &str = ".tmp";

pub fn atomic_write(path: impl AsRef<Path>, content: &[u8]) -> Result<()> {
    let destination = path.as_ref();
    let parent = destination
        .parent()
        .ok_or_else(|| Error::Internal("target path has no parent directory".into()))?;

    std::fs::create_dir_all(parent)?;

    let mut temporary = tempfile::Builder::new()
        .prefix(TEMPORARY_FILE_PREFIX)
        .suffix(TEMPORARY_FILE_SUFFIX)
        .tempfile_in(parent)?;

    temporary.write_all(content)?;
    temporary.as_file().sync_all()?;

    // Windows 的 ReplaceFileW 无法替换仍被当前进程持有句柄的源文件。
    // into_temp_path 会关闭 NamedTempFile 的文件句柄，同时保留 TempPath：
    // - 替换成功后，源路径已被移动；
    // - 替换失败时，TempPath Drop 会清理临时文件。
    let temporary_path = temporary.into_temp_path();

    replace_destination(temporary_path.as_ref(), destination)?;
    sync_directory(parent)?;

    Ok(())
}

/// Atomically replaces destination with source on Unix platforms.
///
/// The temporary file and destination are created in the same directory, so
/// rename remains on one filesystem. POSIX rename replaces an existing regular
/// destination atomically.
#[cfg(unix)]
fn replace_destination(source: &Path, destination: &Path) -> Result<()> {
    std::fs::rename(source, destination)?;
    Ok(())
}

/// Atomically installs or replaces destination on Windows.
///
/// ReplaceFileW is used when a destination already exists. It performs a
/// filesystem replacement rather than a delete-then-move sequence.
///
/// MoveFileExW is used only when creating a new destination. REPLACE_EXISTING
/// also closes the race where another process creates the destination after the
/// existence check. WRITE_THROUGH requests that the move is flushed before the
/// call returns.
///
/// No copy, delete, truncate or non-atomic fallback is allowed.
#[cfg(windows)]
fn replace_destination(source: &Path, destination: &Path) -> Result<()> {
    let source_wide = to_wide_path(source.as_os_str());
    let destination_wide = to_wide_path(destination.as_os_str());

    /*
     * SAFETY:
     *
     * - source_wide and destination_wide are NUL-terminated UTF-16 buffers;
     * - both buffers remain alive for the complete FFI call;
     * - source and destination are local paths selected or retained by Native;
     * - the temporary source is created in the destination directory;
     * - null backup/exclusion/reserved pointers are permitted by the APIs;
     * - the return value is checked before reporting success;
     * - no Rust reference aliases memory owned or mutated by Win32.
     */
    let replaced = unsafe {
        if destination.exists() {
            ReplaceFileW(
                destination_wide.as_ptr(),
                source_wide.as_ptr(),
                null(),
                0,
                null_mut(),
                null_mut(),
            )
        } else {
            MoveFileExW(
                source_wide.as_ptr(),
                destination_wide.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        }
    };

    if replaced == 0 {
        return Err(std::io::Error::last_os_error().into());
    }

    Ok(())
}

#[cfg(windows)]
fn to_wide_path(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(once(0)).collect()
}

/// Synchronizes directory metadata after a successful replacement where
/// supported.
///
/// Unix directory synchronization persists the renamed directory entry.
///
/// Windows does not expose a portable directory fsync through std. The temporary
/// file is synchronized before replacement, ReplaceFileW is a single filesystem
/// operation, and new-file MoveFileExW uses MOVEFILE_WRITE_THROUGH.
fn sync_directory(directory: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        std::fs::File::open(directory)?.sync_all()?;
    }

    #[cfg(not(unix))]
    {
        let _ = directory;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_file_count(directory: &Path) -> usize {
        std::fs::read_dir(directory)
            .expect("temporary directory should be readable")
            .filter_map(std::result::Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(TEMPORARY_FILE_PREFIX)
            })
            .count()
    }

    #[test]
    fn creates_a_new_document() {
        let directory = tempfile::tempdir().expect("temporary directory should be created");
        let destination = directory.path().join("canvas.draw");

        atomic_write(&destination, b"first version").expect("first write should succeed");

        assert_eq!(
            std::fs::read(&destination).expect("destination should be readable"),
            b"first version",
        );
        assert_eq!(temporary_file_count(directory.path()), 0);
    }

    #[test]
    fn replaces_an_existing_document() {
        let directory = tempfile::tempdir().expect("temporary directory should be created");
        let destination = directory.path().join("canvas.draw");

        std::fs::write(&destination, b"old version").expect("fixture should be written");

        atomic_write(&destination, b"new version").expect("replacement write should succeed");

        assert_eq!(
            std::fs::read(&destination).expect("destination should be readable"),
            b"new version",
        );
        assert_eq!(temporary_file_count(directory.path()), 0);
    }

    #[test]
    fn writes_empty_document_without_leaving_temporary_files() {
        let directory = tempfile::tempdir().expect("temporary directory should be created");
        let destination = directory.path().join("empty.draw");

        atomic_write(&destination, b"").expect("empty write should succeed");

        assert_eq!(
            std::fs::read(&destination).expect("destination should be readable"),
            b"",
        );
        assert_eq!(temporary_file_count(directory.path()), 0);
    }

    #[test]
    fn fails_when_destination_parent_is_a_file() {
        let directory = tempfile::tempdir().expect("temporary directory should be created");
        let parent_file = directory.path().join("not-a-directory");

        std::fs::write(&parent_file, b"fixture").expect("fixture should be written");

        let destination = parent_file.join("canvas.draw");
        let result = atomic_write(&destination, b"content");

        assert!(result.is_err());
        assert_eq!(
            std::fs::read(&parent_file).expect("parent fixture should remain readable"),
            b"fixture",
        );
    }
}
