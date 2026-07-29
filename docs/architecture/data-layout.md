# 磁盘布局

这个应用在用户机器上占了哪些位置。声明处是 `apps/desktop/src-tauri/src/paths.rs`，
本文是它的人类可读版本，用来回答两个问题：卸载该清什么，备份该带走什么。

目录名来自 `tauri.conf.json` 的 `identifier`（`com.poietica.Poietica`）。reverse-DNS
是必须的：它同时是 macOS 的 bundle identifier。第三段是产品名，不是 `app`。

## 两类落点

| 类别 | 判据 | 内容 |
| --- | --- | --- |
| 可漫游 `app_config_dir` | 小、跟人走 | 设置、agent 档案、窗口几何 |
| 机器本地 `app_local_data_dir` | 大、与这台机器绑定 | 对话库、受控 home、日志、WebView2 缓存 |

对话库必须在本地一侧：Windows 的漫游配置文件会整份同步 `%APPDATA%`，而库开在
WAL 模式下，被同步意味着登录变慢加上损坏风险。

## Windows

| 位置 | 内容 |
| --- | --- |
| `%APPDATA%\com.poietica.Poietica\settings.json` | 用户设置 |
| `%APPDATA%\com.poietica.Poietica\agents.json` | Agent 接入档案与模型目录缓存（不含密钥） |
| `%APPDATA%\com.poietica.Poietica\.window-state.json` | 窗口几何。文件名与位置由 tauri-plugin-window-state 拥有，不是本仓的命名 |
| `%LOCALAPPDATA%\com.poietica.Poietica\agent.sqlite3`（含 `-wal`、`-shm`） | 全部对话，SQLCipher 加密 |
| `%LOCALAPPDATA%\com.poietica.Poietica\agents\<agentId>\home\` | 每个 agent 的受控 HOME，由 agent 自己写 |
| `%LOCALAPPDATA%\com.poietica.Poietica\logs\poietica.log` | 运行日志 |
| `%LOCALAPPDATA%\com.poietica.Poietica\logs\last-native-crash.json` | 上一次原生崩溃 |
| `%LOCALAPPDATA%\com.poietica.Poietica\EBWebView\` | WebView2 用户数据（localStorage、IndexedDB、缓存） |
| Windows 凭据管理器 | `poietica / agent-store`（库主密钥）、`poietica / agent:<id>:<var>`（各 provider 凭据） |

用户主目录下没有任何东西。点目录（`~/.poietica` 之类）是 Unix 命令行工具的约定，
Windows 不按点号隐藏文件，而主目录是用户文档的空间。

## macOS

`~/Library/Application Support/com.poietica.Poietica/` 承载配置与数据两侧（这个平台上
它们本就是同一个目录），日志在 `~/Library/Logs/com.poietica.Poietica/`，凭据在登录钥匙串。

## Linux

配置在 `~/.config/com.poietica.Poietica/`，数据与日志在
`~/.local/share/com.poietica.Poietica/`，凭据在 Secret Service。这是 XDG 的语义，
不是分裂。

## 用户文档

`.draw` 文件保存在用户自己选择的位置，应用不为它们维护任何库或索引：文档归用户，
不归应用目录。

## 备份

对话库必须与它的 `-wal`、`-shm` 一起拷走，且密钥不在其中 —— 换机器后必须重新
授予凭据，否则库无法解密。这是加密的代价，不是缺陷。
