//! 把档案里写的程序名解析成一条真的能启动的路径。

use std::path::PathBuf;

use crate::error::{AcpError, Result};

/// 在这台机器上找出该启动哪个文件。
///
/// 一个裸名字不是一条可启动的路径。Windows 上 agent 通常是包管理器装出来的
/// `kimi.CMD`：`CreateProcess` 只会替你补 `.exe`，**不读 PATHEXT**，于是
/// `Command::new("kimi")` 直接 `NotFound` —— 明明装了，却报找不到。
///
/// 所以这里不写死任何路径，也不自己遍历 PATH × PATHEXT。那是 which 这个
/// crate 的既有职责，Zed 解析外部 agent 的可执行文件用的也是它。解析发生在
/// 运行的那台机器上，换机器、换包管理器都不需要改配置；`agents.json` 里直接
/// 写绝对路径同样成立，which 会原样交还它。
///
/// 这个函数是唯一的解析处。ACP 会话与 provider CLI 起的是同一个程序，两处
/// 各解析一次，迟早解析出两个结果 —— 上一版就是这么坏的：会话那条会解析，
/// CLI 那条不会。
///
/// # Errors
///
/// 在这台机器的搜索路径上找不到这个程序时返回 [`AcpError::Spawn`]。
pub fn resolve_program(program: &str) -> Result<PathBuf> {
    which::which(program).map_err(|error| AcpError::Spawn {
        message: error.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::resolve_program;

    #[test]
    fn a_name_on_no_search_path_is_reported_rather_than_guessed() {
        assert!(resolve_program("poietica-no-such-program-4f1a").is_err());
    }

    #[test]
    fn an_existing_absolute_path_is_accepted_as_is() {
        // 当前测试二进制本身就是一条已存在的绝对路径，不需要造文件。
        if let Ok(here) = std::env::current_exe() {
            assert!(resolve_program(&here.to_string_lossy()).is_ok());
        }
    }
}
