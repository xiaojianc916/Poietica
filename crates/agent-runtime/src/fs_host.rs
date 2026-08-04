//! 客户端侧的文件宿主：ACP 的 fs/read_text_file 与 fs/write_text_file。
//!
//! 协议把文件读写定为**客户端**方法：agent 不自己碰盘，它请客户端去碰。这不是
//! 多绕一趟，这是把"人正在看的那一版"当成事实来源 —— 编辑器里未保存的缓冲区,
//! 以及我们自己的边界与审计，都只在这一侧存在。
//!
//! 声明这项能力才有意义，因为上游是逐条按能力分流的：
//! packages/acp-server/src/acp-fs/acpFsService.ts 的 readText 首行逐字
//! if (!this.connection.fsReadTextFile) return this.inner.readText(path, options)，
//! 而 acpConnection.ts 的 bindFsCapabilities 判据逐字 fs?.readTextFile === true。
//! 也就是说：不声明这一格，acp-v2 的引擎会退回它自己进程里的本地盘 —— 换了子
//! 命令、换了引擎，v2 多出来的这一块整块白装。
//!
//! 边界不是可选项。agent 的输出是不可信输入（见根 AGENTS.md），路径由它给出。
//! 这里只认这条会话工作目录之下的绝对路径，并且把 .. 按**词法**消掉之后再比对 ——
//! 不能先 canonicalize 再比：一个还不存在的文件没有 canonical 形式，而写入这条
//! 路径上必然遇到的就是还不存在的文件。

use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

use agent_client_protocol::Error;

/// JSON-RPC 的 internal error。
///
/// 用数字而不是找一个构造函数：这一格是标准钉死的，而构造函数的名字不是。
const INTERNAL_ERROR: i32 = -32603;

/// 协议的 resource not found。
///
/// 上游据此把"客户端那边还没有这个文件"与"读失败了"分开：acpFsService.ts 的
/// isResourceNotFound 逐字 error instanceof RequestError && error.code === -32002，
/// 它的 appendText 靠这一条把缺席当成空文件。回错别的码，追加写会整个失败。
const RESOURCE_NOT_FOUND: i32 = -32002;

/// agent 要读的那一段。协议里两格都是可选的。
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Window {
    line: Option<u64>,
    limit: Option<u64>,
}

impl Window {
    /// 从请求的线上形态里取这两格。
    ///
    /// 取自序列化而不是读结构体字段，理由与本 crate 读停止原因、造图片块两处
    /// 相同：线上形态才是契约。这里还多一层 —— 这两格的 Rust 表示（整数宽度、
    /// Option 还是 MaybeUndefined）是 SDK 自己的事，而线上形态由协议钉死成从 1
    /// 起算的整数。读不成就当两格都缺席：那与"读整份"同义，不是猜。
    pub(crate) fn of(request: &impl serde::Serialize) -> Self {
        let Ok(value) = serde_json::to_value(request) else {
            return Self::default();
        };

        Self {
            line: value.get("line").and_then(serde_json::Value::as_u64),
            limit: value.get("limit").and_then(serde_json::Value::as_u64),
        }
    }

    /// 两格都缺席时原样交回，一个字节都不动。
    ///
    /// 给了行窗口时按行重组，行尾统一成 \n —— 交回去的是一段引文，不是原文件,
    /// 这一点由协议自己的语义决定（它给的是 line 与 limit，不是字节区间）。
    fn apply(self, text: &str) -> String {
        if self.line.is_none() && self.limit.is_none() {
            return text.to_owned();
        }

        // 协议的 line 从 1 起算。缺席即从头，所以回落到 1 而不是 0。
        let skip = usize::try_from(self.line.unwrap_or(1).saturating_sub(1)).unwrap_or(usize::MAX);
        let take = self
            .limit
            .map_or(usize::MAX, |limit| usize::try_from(limit).unwrap_or(usize::MAX));

        let mut selected = String::new();

        for line in text.lines().skip(skip).take(take) {
            selected.push_str(line);
            selected.push('\n');
        }

        selected
    }
}

/// 这条会话允许 agent 读写的范围。
#[derive(Clone, Debug)]
pub(crate) struct FsRoots {
    root: PathBuf,
}

impl FsRoots {
    /// 边界就是这条会话的工作目录，与 session/new 交给 agent 的 cwd 是同一个值。
    pub(crate) fn new(root: PathBuf) -> Self {
        Self { root }
    }

    /// 读一份文本。
    ///
    /// # Errors
    ///
    /// 路径不在边界内、或者读盘失败时报错；文件不存在时报协议的 resource
    /// not found，那一条上游要按它自己的语义处理，不是普通失败。
    pub(crate) fn read_text(&self, path: &Path, window: Window) -> Result<String, Error> {
        let resolved = self.resolve(path)?;

        match fs::read_to_string(&resolved) {
            Ok(text) => Ok(window.apply(&text)),
            Err(error) if error.kind() == ErrorKind::NotFound => Err(Error::new(
                RESOURCE_NOT_FOUND,
                "这台电脑上没有这个文件",
            )
            .data(path.display().to_string())),
            Err(error) => {
                Err(Error::new(INTERNAL_ERROR, "读不了这个文件").data(error.to_string()))
            }
        }
    }

    /// 写一份文本。
    ///
    /// 父目录不存在就建出来：agent 新建文件时给的往往是一条还不存在的目录里的
    /// 路径，而它已经在边界内被验过了。
    ///
    /// # Errors
    ///
    /// 路径不在边界内、或者写盘失败时报错。
    pub(crate) fn write_text(&self, path: &Path, content: &str) -> Result<(), Error> {
        let resolved = self.resolve(path)?;

        if let Some(parent) = resolved.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                Error::new(INTERNAL_ERROR, "建不了这个目录").data(error.to_string())
            })?;
        }

        fs::write(&resolved, content)
            .map_err(|error| Error::new(INTERNAL_ERROR, "写不了这个文件").data(error.to_string()))
    }

    /// 把 agent 给的路径收成一条边界内的路径，或者说清为什么不收。
    fn resolve(&self, path: &Path) -> Result<PathBuf, Error> {
        if !path.is_absolute() {
            return Err(refused(path, "路径必须是绝对路径"));
        }

        let Some(asked) = lexically_normalize(path) else {
            return Err(refused(path, "路径用 .. 越出了根"));
        };

        let Some(root) = lexically_normalize(&self.root) else {
            return Err(refused(path, "这条会话的工作目录读不成一条路径"));
        };

        if !asked.starts_with(&root) {
            return Err(refused(path, "路径不在这条会话的工作目录之下"));
        }

        Ok(asked)
    }
}

/// 拒绝一条路径，并说清是哪一条、为什么。
///
/// 用 invalid params 而不是自造一个码：给出这条路径的是 agent，这就是一次参数
/// 不合法，不是我们这边出了故障。
fn refused(path: &Path, reason: &str) -> Error {
    Error::invalid_params().data(format!("{reason}：{}", path.display()))
}

/// 按词法消掉 . 与 ..，不碰磁盘。
///
/// 交回 None 只有一种由来：.. 把路径带到了根之上。那种路径没有边界内的解释,
/// 所以不交一条"尽力而为"的结果出去。
fn lexically_normalize(path: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();

    for part in path.components() {
        match part {
            Component::Prefix(_) | Component::RootDir => normalized.push(part.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
            Component::Normal(part) => normalized.push(part),
        }
    }

    Some(normalized)
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::{FsRoots, Window, lexically_normalize};

    fn roots() -> FsRoots {
        FsRoots::new(PathBuf::from(if cfg!(windows) {
            r"C:\work\project"
        } else {
            "/work/project"
        }))
    }

    fn inside(name: &str) -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(format!(r"C:\work\project\{name}"))
        } else {
            PathBuf::from(format!("/work/project/{name}"))
        }
    }

    #[test]
    fn a_path_inside_the_working_directory_is_accepted() {
        assert!(roots().resolve(&inside("src/main.rs")).is_ok());
    }

    #[test]
    fn a_path_that_climbs_out_with_dot_dot_is_refused() {
        let climbing = inside("../../etc/passwd");

        assert!(roots().resolve(&climbing).is_err());
    }

    #[test]
    fn a_sibling_directory_sharing_a_name_prefix_is_refused() {
        let sibling = if cfg!(windows) {
            PathBuf::from(r"C:\work\project-secrets\key")
        } else {
            PathBuf::from("/work/project-secrets/key")
        };

        assert!(roots().resolve(&sibling).is_err());
    }

    #[test]
    fn a_relative_path_is_refused_rather_than_joined() {
        assert!(roots().resolve(Path::new("src/main.rs")).is_err());
    }

    #[test]
    fn dot_dot_above_the_root_has_no_normal_form() {
        assert!(lexically_normalize(Path::new("/../etc")).is_none());
    }

    #[test]
    fn an_absent_window_returns_the_text_byte_for_byte() {
        let text = "one\ntwo\n\nfour";

        assert_eq!(Window::default().apply(text), text);
    }

    #[test]
    fn a_window_counts_lines_from_one() {
        let text = "one\ntwo\nthree\nfour\n";
        let window = Window {
            line: Some(2),
            limit: Some(2),
        };

        assert_eq!(window.apply(text), "two\nthree\n");
    }

    #[test]
    fn a_window_read_from_the_wire_form_takes_both_fields() {
        let window = Window::of(&serde_json::json!({ "line": 3, "limit": 7 }));

        assert_eq!(window.line, Some(3));
        assert_eq!(window.limit, Some(7));
    }
}
