//! 起子进程时的那一处平台细节。
//!
//! Windows 上一个 GUI 进程起控制台程序会闪一个黑窗，唯一的解法是 `CREATE_NO_WINDOW`。
//! 这件事此前只写在 `agent_cli.rs` 里。安装那条管线同样要起子进程，照抄一遍就会有
//! 第二个说法；同一个平台细节只该有一处。

use std::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub(crate) fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        command.creation_flags(CREATE_NO_WINDOW);
    }

    #[cfg(not(windows))]
    {
        let _unused = command;
    }
}
