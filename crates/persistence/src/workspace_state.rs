//! 按仓库分域的工作台状态存储。
//!
//! 写入走「临时文件 + 同目录 rename」：rename 在同一文件系统内是原子的，
//! 崩溃时要么是旧内容要么是新内容，不会留下截断的半个 JSON。
//! 直接 File::create + write 做不到这一点，那是此前工作台状态根本没有落盘
//! 之外的第二个坑。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// 工作台状态的传输/落盘形状。
///
/// 刻意不含 is_active：活动标签由 active_index 单独表达，
/// 存两份必然分叉。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PersistedTab {
    #[serde(rename_all = "camelCase")]
    Conversation { thread_id: String, title: String },
    #[serde(rename_all = "camelCase")]
    Workspace { surface_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedWorkbenchState {
    pub version: u32,
    pub active_index: usize,
    pub tabs: Vec<PersistedTab>,
}

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceStateError {
    #[error("workspace state io failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("workspace state is not valid json: {0}")]
    Decode(#[from] serde_json::Error),
    #[error("repository id must be a non-empty hex token")]
    InvalidRepositoryId,
}

/// 仓库 id 必须是纯 hex：它会成为文件名的一部分，
/// 未校验就拼路径等于把路径穿越交给调用方。
fn validate_repository_id(repository_id: &str) -> Result<(), WorkspaceStateError> {
    let valid = !repository_id.is_empty()
        && repository_id.len() <= 32
        && repository_id.bytes().all(|byte| byte.is_ascii_hexdigit());

    if valid {
        Ok(())
    } else {
        Err(WorkspaceStateError::InvalidRepositoryId)
    }
}

fn state_path(base_dir: &Path, repository_id: &str) -> PathBuf {
    base_dir
        .join("workbench")
        .join(format!("{repository_id}.json"))
}

pub fn read_workbench_state(
    base_dir: &Path,
    repository_id: &str,
) -> Result<Option<PersistedWorkbenchState>, WorkspaceStateError> {
    validate_repository_id(repository_id)?;

    let path = state_path(base_dir, repository_id);

    match fs::read(&path) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub fn write_workbench_state(
    base_dir: &Path,
    repository_id: &str,
    state: &PersistedWorkbenchState,
) -> Result<(), WorkspaceStateError> {
    validate_repository_id(repository_id)?;

    let path = state_path(base_dir, repository_id);
    let parent = path.parent().expect("state path always has a parent");
    fs::create_dir_all(parent)?;

    let temp_path = parent.join(format!(".{repository_id}.json.tmp"));

    {
        let mut file = fs::File::create(&temp_path)?;
        file.write_all(&serde_json::to_vec(state)?)?;
        // rename 之前必须落到设备上，否则原子性只存在于页缓存里。
        file.sync_all()?;
    }

    fs::rename(&temp_path, &path)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_traversal_in_repository_id() {
        let error = validate_repository_id("../etc").unwrap_err();
        assert!(matches!(error, WorkspaceStateError::InvalidRepositoryId));
    }

    #[test]
    fn missing_state_reads_as_none() {
        let dir = std::env::temp_dir().join("poietica-workbench-test-none");
        let state = read_workbench_state(&dir, "deadbeef").unwrap();
        assert!(state.is_none());
    }
}
