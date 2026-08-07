# 磁盘布局

这个应用在用户机器上占的位置只有一个根。它在哪，由两件事决定，顺序固定：

1. 可执行文件旁边的 `data-directory`。安装器按用户在安装期选的位置写下它。
2. 没有这个文件时，平台的本地数据目录下的 `Poietica`（Windows 上是
   `%LOCALAPPDATA%\Poietica`）。

唯一的声明处是 `apps/desktop/src-tauri/src/paths.rs`。没有第二个地方算路径，
渲染层也不算 —— 关于页面显示的那一行来自 `storage_data_directory`，不是前端拼的。

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

`threads.sqlite3` 开在 WAL 模式下，所以磁盘上实际是三个文件：它，加上同名的
`-wal` 与 `-shm`。备份必须三个一起，只拷主文件会丢掉最近一段还没并回去的写入。

## 安装期指定位置

```
Poietica_0.1.5_x64-setup.exe /DATA=D:\Poietica
```

不传就是默认位置，与此前的安装完全一致。实现见
`apps/desktop/src-tauri/installer-hooks.nsh`，它由 `tauri.conf.json` 的
`bundle.windows.nsis.installerHooks` 挂进官方安装器模板。

## 不在这个根里的东西

两处，都是平台或插件的硬约束，不是选择：

- **窗口位置与尺寸**。`tauri-plugin-window-state` 的落点写死在
  `${dataDir}/${bundleIdentifier}/`，插件没有开放这个参数。它是几十字节的窗口
  几何，丢了只是窗口回到默认大小。
- **WebView2 的缓存**（`EBWebView`）。它归 WebView2 运行时管，位置由宿主进程的
  用户数据目录决定。这不是我们的数据，是浏览器内核的缓存，Codex 的目录里也没有
  对应物 —— 它清空只会让下一次启动稍慢。

把这两样硬搬进来，代价是接管两个我们不拥有的生命周期，换回来的只有目录树好看。
