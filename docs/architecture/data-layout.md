# 磁盘布局

这个应用在用户机器上占的位置只有一个根。它在哪，由两件事决定，顺序固定：

1. 可执行文件旁边的 `data-directory`。安装器按用户在安装期选的位置写下它。
2. 没有这个文件时，`app_local_data_dir()`。

唯一的声明处是 `apps/desktop/src-tauri/src/paths.rs`。没有第二个地方算路径，
渲染层也不算 —— 关于页面显示的那一行来自 `storage_data_directory`。

## 目录名归 identifier 管，只有一处声明

`paths.rs` 不写死目录名。它问 Tauri 要 `app_local_data_dir()`，这个 API 返回的
就是本地数据目录拼上 identifier，而 identifier 归配置管：

| 怎么跑起来 | 生效的配置 | identifier | Windows 上的数据根 |
| --- | --- | --- | --- |
| `pnpm tauri dev` | `tauri.conf.json` 叠加 `tauri.dev.conf.json` | `com.poietica.Poietica.dev` | `%LOCALAPPDATA%\\com.poietica.Poietica.dev` |
| 安装版 | `tauri.conf.json` | `com.poietica.Poietica` | `%LOCALAPPDATA%\\com.poietica.Poietica` |

叠加那份开发配置的是 `scripts/tauri.mjs`：只有 dev 子命令自动补上
`--config src-tauri/tauri.dev.conf.json`，别的子命令一个字不动。开发与安装版
因此不会同时打开同一个 WAL 库，也不会互相覆盖 settings.json 与 agent 凭据。

数据根不能叫 `Poietica`：Tauri 的 NSIS 模板在 currentUser 模式下把安装目录默认
成本地数据目录下以 productName 命名的那个文件夹，两者同名会让用户数据摊进安装
目录。数据根也不应该另起一个新名字：卸载器上「删除应用数据」那个复选框删的正是
以 identifier 命名的目录，改名等于让那个复选框不做事。跟着 identifier 走，这两
件事自动对齐。

程序本体装在 `%LOCALAPPDATA%\\Poietica`，那是安装目录，跟数据根是两个不同的
目录，不要弄混。

## 根下面有什么

| 位置 | 是什么 | 删掉会怎样 |
| --- | --- | --- |
| `settings.json` | 主题、语言、快捷键、隐私开关 | 回到默认设置 |
| `agents.json` | agent 接入档案与安装状态缓存 | 内置档案下次启动重新落盘 |
| `automations.json` | 自动化定义 | 自动化全部消失 |
| `threads.sqlite3` | 对话索引 | 对话列表清空 |
| `attachments/` | 附件字节，内容寻址 | 历史对话里的附件打不开 |
| `agents/<id>/home/` | 各 agent 自己的配置，含 API 密钥 | 需要重新配置 provider |
| `logs/` | 运行日志与上一次原生崩溃报告 | 无影响 |

`threads.sqlite3` 开在 WAL 模式下，磁盘上实际是三个文件：它，加上同名的
`-wal` 与 `-shm`。备份要带上 `-wal`，只拷主文件会丢掉最近一段还没并回去的
写入；`-shm` 不必带，无连接时可安全删除并会被重建。

## 安装期指定位置

```
Poietica_0.1.5_x64-setup.exe /DATA=D:\\Poietica
```

不传就是默认位置。实现见 `apps/desktop/src-tauri/installer-hooks.nsh`。

已知缺口：卸载器的「删除应用数据」只清以 identifier 命名的那两个目录，装到自定义
位置的数据它清不掉。需要在 `NSIS_HOOK_PREUNINSTALL` 里把 `data-directory` 读进
变量，在 `NSIS_HOOK_POSTUNINSTALL` 里按 `$DeleteAppDataCheckboxState` 处置。
尚未实现。

## 不在这个根里的东西

两处，都是平台或插件的硬约束，不是选择：

- **窗口位置与尺寸**。`tauri-plugin-window-state` 的落点写死在
  `${dataDir}/${bundleIdentifier}/`，插件没有开放这个参数。
- **WebView2 的缓存**（`EBWebView`）。它归 WebView2 运行时管，位置由宿主进程
  的用户数据目录决定。这不是我们的数据，是浏览器内核的缓存。
