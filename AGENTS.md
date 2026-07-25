# AGENTS.md

## 使命 

项目软件是tldraw画图软件，核心是这个，不要忘记，以 tldraw-native canvas application 为唯一核心。

守住 Poietica 的长期架构地基：**tldraw-first、本地优先、安全、高性能、可演进**。

tldraw Editor 和 TLStore 是画布文档的事实标准；React、Tauri、WASM 及云服务均为平台层。编辑器内核不可替换，但扩展、平台和 UI 均可替换。

## Editor Architecture

- tldraw Editor and TLStore are the canonical runtime for canvas documents.
- TLStore document records are the single source of truth for persistable editor state.
- Shapes, bindings, assets, pages, and custom records must not be mirrored into a second document model.
- tldraw History is the sole undo and redo implementation.
- All document mutations must occur through Editor or Store transactions.
- Features extend the editor through registered shapes, bindings, tools, assets, custom records, commands, panels, importers, and exporters.
- Large binary payloads and runtime-only objects must remain outside TLStore.
- `@tldraw/sync` is the default and sole canvas synchronization protocol.
- Client, server, and extension schemas are released in lockstep.
- Backward compatibility is limited to an explicitly defined version window.
- The project must not maintain a parallel document kernel solely to preserve hypothetical tldraw replaceability.

## 包结构

```
poietica/
├── apps/               # 应用入口
├── editor/             # 编辑器内核与扩展 API
│   ├── core/           #   tldraw Editor Runtime, TLSchema, TLStore, ExtensionRegistry
│   ├── assets/         #   TLAssetStore, 资产引用与存取
│   ├── persistence/    #   TLStore snapshot, .draw container, 文件格式
│   ├── document/       #   文档会话、保存状态与生命周期
│   ├── collaboration/  #   @tldraw/sync 配置, Presence, Auth
│   └── extensions/     #   插件声明与生命周期管理
├── features/           # 产品功能——tldraw-native Editor Extensions
│   ├── flowchart/      #   流程图 Shape/Binding/Tool/Layout
│   ├── scientific-plot/#   科学图表 Shape/Dataset/Worker
│   ├── freehand/       #   自定义笔刷（如需要）
│   ├── import-export/  #   语义/视觉导入导出
│   ├── workspace/      #   产品 UI Shell, 文件树, 面板
│   └── settings/       #   设置（通过 Tauri IPC → tauri-plugin-store）
├── platforms/          # 平台适配
│   ├── desktop-ipc/    #   Tauri IPC 包装
│   └── desktop-runtime/#   桌面平台适配器（文件、对话框、剪贴板等）
├── foundations/        # 共享基础设施
│   ├── design-system/
│   ├── geometry/
│   ├── kernel/
│   ├── observability/
│   ├── serialization/
│   └── test-kit/
├── tooling/
└── tests/
```

## 依赖方向

```
apps ───────────────► editor + features + platforms

editor/core ─────────► foundations

features ───────────► editor/core

platforms ──────────► editor + features (through ports)

foundations ───────── no dependencies on editor/features/platforms
```

- `editor/core` 是唯一可以创建 TLSchema、TLStore、控制 Editor 生命周期的包。
- `editor/document` 拥有文档会话、文件路径、revision、保存状态和关闭计划。
- `editor/document` 不得依赖 Workspace、React、Tauri 或平台 adapter。
- 跨 editor 与 workspace 的协调只能位于 apps composition root。
- Feature 只能贡献 `EditorExtension`（shapes, bindings, tools, records, commands, panels 等）。
- `platforms/*` 只实现平台能力，不拥有业务规则或编辑器状态。
- `foundations/*` 只接收无业务语义、已被多个包稳定复用的基础能力。
- 跨包只能依赖 `public-api.ts`；禁止 deep import、循环依赖和共享可变 Store。
- 禁止根级 `components`、`services`、`utils`、`stores`、`types`、`managers`。
- 不为假想需求创建抽象、兼容层或第二套实现。
- 允许通过 architecture.scaffolds.json 登记预留脚手架；每项必须声明所有者、激活条件、删除条件和依赖约束。

## 状态与写入

- TLStore records 是可持久化编辑器状态的唯一事实来源。
- Editor/Store transaction 是唯一的文档写入路径。
- tldraw History 是唯一的 Undo/Redo。
- `@tldraw/sync` 是唯一的画布同步协议。
- 大型二进制负载和运行时对象不得进入 TLStore。
- React 组件直接通过 `useValue`/`editor` 读取状态；不得维护第二套 selection/tool/zoom 状态。
- 文件、缓存、协作状态与 UI 状态必须有明确且唯一的所有者。
- 保存、同步、投影和索引不得产生用户历史。

## Rust、Tauri 与 IPC

- Rust 负责原子文件操作、资源流、系统集成、安全边界和崩溃恢复。
- TypeScript 负责编辑器扩展、产品语义与交互编排。
- 禁止在 Rust 与 TypeScript 中重复实现迁移、布局或导出语义。
- IPC 使用生成式、显式、可验证的 DTO。
- 禁止 `serde_json::Value`、任意路径、第三方对象和原始堆栈穿透 IPC。
- 每个命令必须定义 capability、错误码、超时、取消、幂等及重试语义。
- WebView、Worker 和插件不得获得任意原生能力。

## 文件与兼容性

- 用户文件以 TLStore Snapshot 为核心；`.draw` 容器是唯一持久格式。
- Schema 变更必须提供确定性迁移、兼容策略和 round-trip fixture。
- 未知字段与未知扩展必须无损保留。
- 无法安全理解的新格式只能只读；禁止静默降级后覆盖原文件。
- 保存必须采用 `serialize → temp → fsync → atomic replace`，并支持崩溃恢复。
- 大型数据、资源及运行时实例不得进入 Shape props、React state 或 JSON IPC。

## 安全与插件

- 文件、ZIP、SVG、字体、图片、CSV、剪贴板、插件和协作消息一律视为不可信输入。
- 所有边界输入必须校验 schema、权限、大小、路径和资源预算。
- 插件只能通过声明式贡献或受控 RPC 使用显式 capability。
- 插件不得直接访问 Editor、Tauri、文件系统、网络或宿主 Store。
- 插件或单个 Shape 失败必须局部降级，不得阻止文档保存。
- 生产 CSP 必须限制 `script-src 'self'`（禁止 `unsafe-eval`），`connect-src` 只允许已知端点。
- 未经基准与威胁模型证明，不引入 WASM、原生重写或更宽权限。

## 性能与并发

- 布局、数据处理、导入导出及重计算不得阻塞主线程。
- 长任务必须可取消、可超时、可诊断，并使用不可变输入和版本化输出。
- 大规模画布必须采用视口剔除、LOD、增量投影和有界缓存。
- 性能决策必须基于固定 fixture、目标设备和可重复基准。
- 不以未经验证的性能假设增加架构复杂度。

## 修改准则

修改前：

1. 确认事实所有者、目标包和依赖方向。
2. 搜索现有模型和写入路径，避免重复实现。
3. 判断是否影响文件格式、IPC、插件 API、权限或跨包依赖。

修改时：

1. 先定义扩展接口和语义，再实现内部细节。
2. 保持单一事实来源和单一写入路径。
3. 替换旧路径时同步删除旧实现，不保留无期限双轨。
4. 新依赖必须说明必要性、边界位置和退出策略。
5. 持久格式、IPC、权限、插件 API 或依赖方向变更必须进入 ADR/RFC。

禁止：

- 用兼容层掩盖错误边界。
- 绕过公开 API 或架构测试。
- 空 `catch`、隐式副作用、万能 Store、万能 Manager。
- 未经请求扩大改动范围。
- 未验证即宣称完成。

## 文档一致性

- README.md 负责项目入口、当前架构概览和开发方式。
- AGENTS.md 是强制性的架构约束与修改规则。
- docs/rfcs 只描述尚未接受的提案，不得伪装成当前实现。
- docs/adr 记录已经接受的重要决策。
- architecture.scaffolds.json 只登记有明确所有者、激活条件和删除条件的预留结构。
- README、AGENTS、ADR、代码和测试不得同时声明不同的文档内核、同步协议、目录结构或依赖方向。
- 已废弃的架构描述必须与旧实现、旧测试、旧导出和旧配置一起删除。
- 目录和契约的存在不代表功能已经完成；完成状态必须由实现和验证结果证明。

## 验证

至少执行：

```
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --check
cargo clippy --workspace --all-targets --all-features
cargo test --workspace
```

并执行所有受影响的架构、契约、E2E、性能、安全及兼容性测试。

## 完成标准

只有同时满足以下条件才算完成：

- 事实来源唯一，写入路径唯一。
- 依赖方向合法，无 deep import、循环依赖或跨包越权。
- 正常、失败、取消、恢复及兼容路径明确。
- 测试覆盖不变量和边界契约。
- 无死代码、双轨逻辑、临时绕过或无主抽象。
- 文档、契约、实现与测试一致。
