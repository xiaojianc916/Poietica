# 磁盘布局

这个应用在用户机器上占了哪些位置。声明处是 `apps/desktop/src-tauri/src/paths.rs`；
本文是它的人类可读版本，用来回答两个问题：卸载该清什么，备份该带走什么。

目录由 Tauri 按 `tauri.conf.json` 的 `identifier` 解析。Windows 上 `app_data_dir`
与 `app_config_dir` 恰好是同一个目录；Linux 上它们分别是 `~/.config` 与
`~/.local/share`，也就是说设置与对话库分居两处。

## Windows

| 位置 | 内容 |
| --- | --- |
| `%APPDATA%\com.poietica.app\settings.json` | 用户设置 |
| `%APPDATA%\com.poietica.app\agents.json` | Agent 接入档案与模型目录缓存（不含密钥） |
| `%APPDATA%\com.poietica.app\.window-state.json` | 窗口几何，由 window-state 插件拥有 |
| `%APPDATA%\com.poietica.app\ai.sqlite3`（含 `-wal`、`-shm`） | 全部对话，SQLCipher 加密 |
| `%APPDATA%\com.poietica.app\agents\<agentId>\home\` | 每个 agent 的受控 HOME，由 agent 自己写 |
| `%APPDATA%\com.poietica.app\logs\poietica.log` | 运行日志 |
| `%APPDATA%\com.poietica.app\logs\last-native-crash.json` | 上一次原生崩溃 |
| `%LOCALAPPDATA%\com.poietica.app\EBWebView\` | WebView2 用户数据（localStorage、IndexedDB、缓存） |
| Windows 凭据管理器 | `poietica / ai-store`（库主密钥）、`poietica / agent:<id>:<var>`（各 provider 凭据） |

## macOS

`~/Library/Application Support/com.poietica.app/` 承载上表前六项，日志在
`~/Library/Logs/com.poietica.app/`，凭据在登录钥匙串。

## Linux

设置与窗口状态在 `~/.config/com.poietica.app/`；对话库、`agents/` 与日志在
`~/.local/share/com.poietica.app/`；凭据在 Secret Service。

## 用户文档

`.draw` 文件保存在用户自己选择的位置，应用不为它们维护任何库或索引：
文档归用户，不归应用目录。

## 备份

对话库必须与它的 `-wal`、`-shm` 一起拷走，且密钥不在其中 —— 换机器后必须
在新机器上重新授予凭据，否则库无法解密。这是加密的代价，不是缺陷。
