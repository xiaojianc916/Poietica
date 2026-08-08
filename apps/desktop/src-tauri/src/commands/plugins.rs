//! 插件的取用、落盘与账目。
//!
//! 这个模块一个字节都不解释插件清单。唯一解析器是 packages/plugins 的
//! decodePluginManifest：提示词预算、命令描述回落、agent 覆盖规则都在那条管线上，
//! 原生再解析一遍就是第二套规则。installed.json 与 marketplace.json 同理 —— 原生只
//! 保证写入是原子的。于是这里没有任何一个 DTO 与 packages/plugins 的类型重复。

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use poietica_plugin_host_native as host;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, command};

use crate::error::{Error, IpcError, Result};
use crate::paths::{
    marketplace_catalog, plugin_directory, plugins_record, plugins_root, plugins_staging_root,
};

type PluginsCommandResult<T> = std::result::Result<T, IpcError>;

/// 一次下载最多接受这么多字节。没有上限，一个坏掉的直链就能把内存吃光；逐块累加
/// 意味着服务器谎报 Content-Length 也没有用。
const MAX_DOWNLOAD_BYTES: usize = 32 * 1024 * 1024;

/// 一次子树读取的上限。插件是外来内容：一个铺了几千份 Markdown 的目录会把渲染层的
/// 一次刷新变成几十兆字符串，而技能与命令的真实数量是几十条。超了报错，不截断 ——
/// 截断意味着界面上少了几条技能，却没有任何人知道少了。
const MAX_TREE_FILES: usize = 512;

const MAX_TREE_BYTES: usize = 8 * 1024 * 1024;

/// 一次取用从哪里拿字节。
///
/// GitHub 不在这里出现：把仓库地址变成归档 URL 是领域侧的判断，由 packages/plugins
/// 的 planFetch 做，判不出来的（默认分支）当场就说判不出来。
#[derive(Debug, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PluginFetch {
    #[serde(rename_all = "camelCase")]
    Directory { path: String },
    #[serde(rename_all = "camelCase")]
    Archive {
        url: String,
        /// 归档解开之后，插件根在里面的哪一层。目录型市场一个仓库装着多个插件，
        /// 不指名就只能猜。
        subdirectory: Option<String>,
    },
}

/// 已经解到暂存区、还没被认领的一份插件。
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginStaged {
    pub staging_id: String,
    /// 清单原文。这一层不解析它。
    pub manifest_json: String,
}

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommitRequest {
    pub staging_id: String,
    /// 渲染层解码清单之后判定的标识符。这里只验它能不能当目录名。
    pub plugin_id: String,
    /// 取用时用的那一段子目录。认领的是清单所在的那一层，与取用时是同一层。
    pub subdirectory: Option<String>,
}

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginFileRequest {
    pub plugin_id: String,
    /// 相对插件根的路径，例如 systemPromptPath 指到的那份提示词。
    pub relative_path: String,
}

/// 一次子树取用要什么。
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginTreeRequest {
    pub plugin_id: String,
    /// 清单里声明的那条 ./ 路径。它可以指到目录，也可以直接指到一份文件。
    pub relative_path: String,
    /// 只要文件名以这个结尾的。技能与命令都是 .md，但「哪个后缀算数」是清单的语义，
    /// 由渲染层给 —— 这一层不认识技能，也不认识命令。
    pub suffix: String,
}

/// 插件根底下的一份文本文件。
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginFileText {
    /// 相对插件根，不是相对 relative_path —— 回头要重读它，还得从根算起。
    pub relative_path: String,
    pub contents: String,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginPayload {
    pub plugin_id: String,
    pub manifest_json: String,
}

/// 折成 IPC 上那条插件错误，并把真正的原因留在日志里。
///
/// 公共文案是脱敏的固定串（见 error.rs 的 public_message），原因不写进日志就等于
/// 丢了 —— 而排查插件装不上，靠的正是这句原因。
fn plugin_failure(cause: impl std::fmt::Display) -> Error {
    log::warn!("plugin operation failed: {cause}");

    Error::Plugin(cause.to_string())
}

async fn download(url: &str) -> Result<Vec<u8>> {
    let mut response = reqwest::get(url).await.map_err(plugin_failure)?;

    if !response.status().is_success() {
        return Err(plugin_failure(format!(
            "server answered {}",
            response.status()
        )));
    }

    let mut bytes = Vec::new();

    while let Some(chunk) = response.chunk().await.map_err(plugin_failure)? {
        if bytes.len() + chunk.len() > MAX_DOWNLOAD_BYTES {
            return Err(plugin_failure("payload exceeds the size limit"));
        }

        bytes.extend_from_slice(&chunk);
    }

    Ok(bytes)
}

/// 暂存目录填好了，读出清单原文交出去。
///
/// 读不出来就当场丢掉暂存：留着一个永远不会被认领的目录，下次列举时它就是垃圾。
/// 丢弃本身再失败也不能盖掉真正的原因，所以那一步只进日志。
fn finish_staging(staging: host::Staging, subdirectory: Option<&str>) -> Result<PluginStaged> {
    let staging_id = staging.identifier().to_owned();

    let read = host::locate_root(staging.path(), subdirectory)
        .and_then(|root| host::manifest_in(&root).ok_or(host::HostError::ManifestMissing))
        .map_err(plugin_failure)
        .and_then(|manifest| fs::read_to_string(manifest).map_err(Error::from));

    match read {
        Ok(manifest_json) => Ok(PluginStaged {
            staging_id,
            manifest_json,
        }),
        Err(cause) => {
            if let Err(cleanup) = staging.discard() {
                log::warn!("could not discard a failed staging directory: {cleanup}");
            }

            Err(cause)
        }
    }
}

#[command]
#[specta::specta]
pub async fn plugins_list(app: AppHandle) -> PluginsCommandResult<Vec<PluginPayload>> {
    (|| -> Result<Vec<PluginPayload>> {
        let mut found = Vec::new();

        for entry in fs::read_dir(plugins_root(&app)?)? {
            let path = entry?.path();

            let Some(identifier) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };

            // 点开头不是安全路径段，暂存目录就叫 .staging —— 同一条规则既挡住写入
            // 越界，也顺带把暂存区排除在托管副本之外，不需要第二个特例。
            if !path.is_dir() || !host::is_safe_segment(identifier) {
                continue;
            }

            let Some(manifest) = host::manifest_in(&path) else {
                log::warn!("managed plugin copy without a manifest: {identifier}");
                continue;
            };

            found.push(PluginPayload {
                plugin_id: identifier.to_owned(),
                manifest_json: fs::read_to_string(manifest)?,
            });
        }

        found.sort_by(|left, right| left.plugin_id.cmp(&right.plugin_id));

        Ok(found)
    })()
    .map_err(IpcError::from)
}

#[command]
#[specta::specta]
pub async fn plugins_read_text(
    app: AppHandle,
    request: PluginFileRequest,
) -> PluginsCommandResult<String> {
    (|| -> Result<String> {
        let directory = plugin_directory(&app, &request.plugin_id)?;
        let target =
            host::resolve_inside(&directory, &request.relative_path).map_err(plugin_failure)?;

        Ok(fs::read_to_string(target)?)
    })()
    .map_err(IpcError::from)
}

/// 相对插件根的那条路径，一律用 '/' 分隔。
///
/// Path 在 Windows 上给出的是 '\\'，而这串字符要回到渲染层、再原样传回
/// resolve_inside；Linux 不把它当分隔符，于是同一份插件在两个平台上会得到两种读不
/// 通的路径。
fn join_relative(declared: &str, tail: &Path) -> String {
    let segments: Vec<&str> = tail
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect();

    if segments.is_empty() {
        return declared.to_owned();
    }

    format!("{}/{}", declared.trim_end_matches('/'), segments.join("/"))
}

/// 一条声明路径底下的文本文件，一次读齐。
///
/// 返回 None 表示这条路径不在盘上 —— 清单声明了 ./commands 而目录没跟着发布是常事，
/// 那是一条诊断，不是一次失败。空数组表示路径在，里面没有匹配后缀的文件。两者要分得
/// 开，界面上一个说「没装全」，一个说「这里是空的」。
#[command]
#[specta::specta]
pub async fn plugins_read_tree(
    app: AppHandle,
    request: PluginTreeRequest,
) -> PluginsCommandResult<Option<Vec<PluginFileText>>> {
    (|| -> Result<Option<Vec<PluginFileText>>> {
        let root = plugin_directory(&app, &request.plugin_id)?;
        let declared =
            host::resolve_inside(&root, &request.relative_path).map_err(plugin_failure)?;

        let Ok(metadata) = fs::metadata(&declared) else {
            return Ok(None);
        };

        // 声明直接指到一份文件时，那份文件自己就是整棵树。
        let tails = if metadata.is_file() {
            vec![PathBuf::new()]
        } else {
            host::list_files(&declared)?
        };

        let mut found = Vec::new();
        let mut bytes = 0usize;

        for tail in tails {
            let absolute = declared.join(&tail);

            let matched = absolute
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(&request.suffix));

            if !matched {
                continue;
            }

            if found.len() == MAX_TREE_FILES {
                return Err(plugin_failure(format!(
                    "{} holds more than {MAX_TREE_FILES} files",
                    request.relative_path
                )));
            }

            let contents = fs::read_to_string(&absolute)?;

            bytes += contents.len();

            if bytes > MAX_TREE_BYTES {
                return Err(plugin_failure(format!(
                    "{} exceeds {MAX_TREE_BYTES} bytes",
                    request.relative_path
                )));
            }

            found.push(PluginFileText {
                relative_path: join_relative(&request.relative_path, &tail),
                contents,
            });
        }

        Ok(Some(found))
    })()
    .map_err(IpcError::from)
}

#[command]
#[specta::specta]
pub async fn plugins_stage(
    app: AppHandle,
    fetch: PluginFetch,
) -> PluginsCommandResult<PluginStaged> {
    let bytes = match &fetch {
        PluginFetch::Archive { url, .. } => match download(url).await {
            Ok(payload) => Some(payload),
            Err(cause) => return Err(cause.into()),
        },
        PluginFetch::Directory { .. } => None,
    };

    let subdirectory = match &fetch {
        PluginFetch::Archive { subdirectory, .. } => subdirectory.as_deref(),
        PluginFetch::Directory { .. } => None,
    };

    (|| -> Result<PluginStaged> {
        let staging =
            host::Staging::create(&plugins_staging_root(&app)?).map_err(plugin_failure)?;

        let filled = match (&fetch, bytes.as_deref()) {
            (PluginFetch::Directory { path }, _) => {
                host::copy_tree(Path::new(path), staging.path())
            }
            (PluginFetch::Archive { .. }, Some(payload)) => {
                host::extract_zip(payload, staging.path())
            }
            (PluginFetch::Archive { url, .. }, None) => {
                return Err(plugin_failure(format!("no bytes for {url}")));
            }
        };

        if let Err(cause) = filled {
            if let Err(cleanup) = staging.discard() {
                log::warn!("could not discard a failed staging directory: {cleanup}");
            }

            return Err(plugin_failure(cause));
        }

        finish_staging(staging, subdirectory)
    })()
    .map_err(IpcError::from)
}

#[command]
#[specta::specta]
pub async fn plugins_commit(
    app: AppHandle,
    request: PluginCommitRequest,
) -> PluginsCommandResult<()> {
    (|| -> Result<()> {
        let staging = host::Staging::open(&plugins_staging_root(&app)?, &request.staging_id)
            .map_err(plugin_failure)?;

        // 解出来的东西可能套在 <repo>-<ref>/ 一层里，认领的是清单所在的那一层。
        let root = host::locate_root(staging.path(), request.subdirectory.as_deref())
            .map_err(plugin_failure)?;
        let destination = plugin_directory(&app, &request.plugin_id)?;

        staging.promote(&root, &destination).map_err(plugin_failure)
    })()
    .map_err(IpcError::from)
}

#[command]
#[specta::specta]
pub async fn plugins_discard(app: AppHandle, staging_id: String) -> PluginsCommandResult<()> {
    (|| -> Result<()> {
        host::Staging::open(&plugins_staging_root(&app)?, &staging_id)
            .and_then(host::Staging::discard)
            .map_err(plugin_failure)
    })()
    .map_err(IpcError::from)
}

/// 删掉不在保留清单里的托管副本，返回真的删掉了哪些。
///
/// 上游卸载只删记录、留副本，托管目录于是只增不减。保留清单由渲染层给出 ——
/// 「哪些插件还算装着」是记录的语义，而那份记录的解码器在 TS 那边。
#[command]
#[specta::specta]
pub async fn plugins_prune(app: AppHandle, keep: Vec<String>) -> PluginsCommandResult<Vec<String>> {
    (|| -> Result<Vec<String>> {
        let kept: BTreeSet<&str> = keep.iter().map(String::as_str).collect();
        let mut removed = Vec::new();

        for entry in fs::read_dir(plugins_root(&app)?)? {
            let path = entry?.path();

            let Some(identifier) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };

            if !path.is_dir() || !host::is_safe_segment(identifier) || kept.contains(identifier) {
                continue;
            }

            let removing = identifier.to_owned();

            fs::remove_dir_all(&path)?;
            removed.push(removing);
        }

        removed.sort();

        Ok(removed)
    })()
    .map_err(IpcError::from)
}

#[command]
#[specta::specta]
pub async fn plugins_state_read(app: AppHandle) -> PluginsCommandResult<Option<String>> {
    (|| -> Result<Option<String>> {
        host::read_optional(&plugins_record(&app)?).map_err(plugin_failure)
    })()
    .map_err(IpcError::from)
}

#[command]
#[specta::specta]
pub async fn plugins_state_write(app: AppHandle, contents: String) -> PluginsCommandResult<()> {
    (|| -> Result<()> {
        host::write_atomic(&plugins_record(&app)?, &contents).map_err(plugin_failure)
    })()
    .map_err(IpcError::from)
}

#[command]
#[specta::specta]
pub async fn plugins_catalog_read(app: AppHandle) -> PluginsCommandResult<Option<String>> {
    (|| -> Result<Option<String>> {
        host::read_optional(&marketplace_catalog(&app)?).map_err(plugin_failure)
    })()
    .map_err(IpcError::from)
}

/// 拉一次市场目录，覆盖本地那一份，并把它交回去。
///
/// 这条命令不判断该不该拉 —— 那个判断是 packages/plugins 的 shouldFetchOnOpen，
/// 属于状态机。这里只负责「拉了就覆盖」。
#[command]
#[specta::specta]
pub async fn plugins_catalog_refresh(app: AppHandle, url: String) -> PluginsCommandResult<String> {
    let fetched = download(&url).await.and_then(|bytes| {
        String::from_utf8(bytes)
            .map_err(|cause| plugin_failure(format!("catalog is not utf-8: {cause}")))
    });

    fetched
        .and_then(|contents| {
            host::write_atomic(&marketplace_catalog(&app)?, &contents)
                .map_err(plugin_failure)
                .map(|()| contents)
        })
        .map_err(IpcError::from)
}
