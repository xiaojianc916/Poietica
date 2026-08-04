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

/// 状态文件都住在这一层目录下。
///
/// 它是被算出来的，不是从路径里反推的：此前写入侧问 path.parent()，
/// 拿到一个永远是 Some 的 Option 再 expect —— 那个问句本身就不该存在。
fn state_dir(base_dir: &Path) -> PathBuf {
    base_dir.join("workbench")
}

fn state_path(base_dir: &Path, repository_id: &str) -> PathBuf {
    state_dir(base_dir).join(format!("{repository_id}.json"))
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
    let dir = state_dir(base_dir);
    fs::create_dir_all(&dir)?;

    let temp_path = dir.join(format!(".{repository_id}.json.tmp"));

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
    #![allow(
        clippy::expect_used,
        clippy::unwrap_used,
        reason = "a test proves itself by panicking, so a failed step must fail the test"
    )]

    use super::*;

    #[test]
    fn rejects_path_traversal_in_repository_id() {
        let error = validate_repository_id("../etc").unwrap_err();
        assert!(matches!(error, WorkspaceStateError::InvalidRepositoryId));
    }

    #[test]
    fn missing_state_reads_as_none() {
        // 写死名字的共享临时目录会被并发的另一次测试和上一次的残留同时踩中。
        let dir = tempfile::tempdir().unwrap();
        let state = read_workbench_state(dir.path(), "deadbeef").unwrap();
        assert!(state.is_none());
    }

    #[test]
    fn a_written_state_reads_back_and_leaves_no_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let state = PersistedWorkbenchState {
            version: 1,
            active_index: 1,
            tabs: vec![
                PersistedTab::Workspace {
                    surface_id: "ai".to_owned(),
                },
                PersistedTab::Conversation {
                    thread_id: "thread-1".to_owned(),
                    title: "One".to_owned(),
                },
            ],
        };

        write_workbench_state(dir.path(), "deadbeef", &state).unwrap();

        let read = read_workbench_state(dir.path(), "deadbeef")
            .unwrap()
            .expect("状态刚写过，应当读得回来");

        assert_eq!(read.active_index, 1);
        assert!(matches!(
            read.tabs.first(),
            Some(PersistedTab::Workspace { surface_id }) if surface_id == "ai"
        ));

        // rename 成功之后目录里只该剩那一个文件，临时文件不许留下。
        let entries = fs::read_dir(dir.path().join("workbench")).unwrap().count();
        assert_eq!(entries, 1);
    }

    #[test]
    fn a_tab_is_the_tagged_camel_case_json_the_frontend_parses() {
        /*
         * 这串 JSON 是跨进程契约：界面侧的 valibot schema 按同一形状校验。
         * 两边各写一份形状而没有一处把它钉住，就是这一版分叉的由来 ——
         * 界面侧曾经校验的是一个扁平形状，与这里写出的判别联合并不相认。
         */
        let json = serde_json::to_string(&PersistedTab::Conversation {
            thread_id: "thread-1".to_owned(),
            title: "One".to_owned(),
        })
        .unwrap();

        assert_eq!(
            json,
            r#"{"kind":"conversation","threadId":"thread-1","title":"One"}"#
        );
    }
}
