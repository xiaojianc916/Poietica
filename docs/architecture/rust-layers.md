# Rust Three-Layer Architecture

## Layer 1: `domains/*/native/` — 能力实现

负责可测试、不绑定 Tauri 的领域原生能力。

| Crate | 职责 |
|-------|------|
| `editor/assets/native` | 内容寻址、完整性校验、存储后端 |
| `editor/persistence/native` | 原子写入、容器解析、文件锁、崩溃恢复、变更监听 |
| `editor/extensions/native` | 包解析、签名验证、完整性、信任存储 |

规则：
- 不依赖 `tauri` crate
- 只依赖纯 Rust 库（`serde`、`blake3`、`zip`、`chrono` 等）
- 可通过普通 `cargo test` 运行单元测试
- 不引用 IPC DTO、Tauri Command、AppState

## Layer 2: `crates/desktop-runtime/` — 桌面平台能力

负责通用桌面平台能力，与具体业务领域无关。

| 模块 | 职责 |
|------|------|
| `window.rs` | 窗口管理（最小化/最大化/关闭） |
| `opener.rs` | 外部打开文件/URI |
| `lifecycle.rs` | 应用生命周期 |
| `theme.rs` | 系统主题检测 |
| `runtime_info.rs` | 平台/架构/版本信息 |

规则：
- 可以依赖 `tauri`（因为 Windows 操作需要 `webview` 句柄）
- 不依赖任何 `domains/*/native` crate
- 不被 `domains/*/native` 依赖（单向：平台→领域禁止）

## Layer 3: `apps/desktop/src-tauri/` — 组合根

只负责：
- 初始化 Tauri 和全部插件
- 创建窗口（main / settings / recovery）
- 注册 Tauri Command（薄封装）
- 用 AppState 持有 native crate 服务
- 把 IPC DTO 转为领域类型
- 把错误映射为稳定 IPC Error

规则：
- Command 函数不得超过 10 行实质性逻辑
- 禁止在 Command 中直接实现业务算法
- 禁止 Command 绕过 native crate 直接调用 OS API
- 不在 src-tauri 中定义领域实体（领域实体在 domains/*/native 中）

## 依赖方向

```
apps/desktop/src-tauri
  ├── domains/*/native
  └── crates/desktop-runtime

domains/*/native
  └── pure Rust libraries

crates/desktop-runtime
  └── tauri (limited)
```

禁止：
- `domains/*/native → tauri`
- `domains/*/native → crates/desktop-runtime`
- `crates/desktop-runtime → domains/*/native`
- `src-tauri commands` 包含业务分支（应委托给 native crate）
