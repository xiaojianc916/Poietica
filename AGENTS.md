# Poietica 工程与 AI 协作指南

## 项目使命

Poietica 是一个本地优先、由 AI 辅助的思考与创作工具。

它帮助人们描述想法、收集素材、在空间中组织关系、获得 AI 启发，并将不确定的思绪逐步发展为创作成果。画布是重要工具之一，但不是产品唯一或绝对的核心；描述、AI、笔记、素材和整理能力都应服务于创造过程。

修改仓库时，必须守住：

- **创作优先**：功能应帮助用户思考、探索、表达与完成作品。
- **用户主导**：AI 扩展可能性，不能静默替用户决定。
- **多元入口**：不将画布或任何单一界面视为唯一创作中心。
- **本地优先**：用户作品应可靠保存，并具有可预测的文件行为。
- **边界清晰**：状态、产品规则和平台能力必须有明确所有者。
- **可持续演进**：避免无明确需求的抽象、双轨实现和万能模块。

## 产品与 AI 行为

AI 应帮助用户：

- 阐明问题、意图、方向或尚未成形的构想；
- 提供问题、联想、视角、变化和下一步建议；
- 将用户描述转化为可检查、可修改的提案；
- 在不接管创作权的前提下帮助用户继续推进。

AI 不得：

- 静默修改用户的文本、文件或画布内容；
- 将生成结果视为比用户判断更权威的结论；
- 在未说明的情况下携带用户内容发起网络请求；
- 暴露密钥、Provider 内部信息、敏感 Prompt 或原始堆栈；
- 创建第二套画布文档模型或第二个画布状态来源。

AI 对画布的提案必须提供预览或显式应用操作；一旦应用，必须走正常 Editor / Store transaction，使其能够通过 History 撤销。

## 状态与事实来源

### 画布文档

- 对于画布文档，tldraw `Editor` 与 `TLStore` 是规范运行时。
- TLStore records 是可持久化画布状态的唯一事实来源。
- Shapes、Bindings、Assets、Pages 和自定义 Records 不得镜像为第二套文档模型。
- 所有画布写入必须通过 Editor 或 Store transactions。
- tldraw History 是唯一 Undo / Redo 实现。
- 大型二进制数据、文件句柄与运行时对象不得进入 TLStore。

这仅是画布文档的技术边界，不代表画布拥有整个产品的唯一中心地位。

### 其他产品状态

- 描述、AI 会话、笔记、素材、工作区与保存状态都必须有明确所有者。
- 每一类状态只能有一个权威来源。
- 不得重复维护 selection、tool、zoom、画布内容或保存状态。
- 后台工作不得产生用户可见的历史记录，除非用户明确应用结果。

## 包结构与依赖方向

```text
apps ───────────────► agent + editor + features + platforms
features ───────────► agent public API + editor public extension API + foundations
agent/ui ───────────► agent/runtime
agent/runtime ──────► agent/protocol + agent/timeline + agent/registry + agent/transport
agent/protocol ─────► foundations
agent/persistence ──► agent/protocol
editor/core ────────► foundations
editor/document ────► editor/core + persistence contracts
platforms ──────────► application-defined ports
foundations ────────► no product packages
```

- `editor/core` 是唯一能够创建 `TLSchema`、`TLStore` 并控制 Editor 生命周期的包。
- `editor/document` 拥有画布文档会话、文件位置、revision、保存状态与关闭计划。
- `agent/*` 拥有 AI 会话、协议、时间线、工具注册与传输，但不拥有画布状态或原生能力。
- `features/workspace` 拥有工作台、命令、面板、标签页与产品外壳。
- `platforms/*` 只实现平台能力，不拥有产品规则或编辑器状态。
- `apps/*` 是 editor、features 与 platforms 的最终组合位置。
- `foundations/*` 不得依赖 `apps`、`editor`、`features` 或 `platforms`。
- 跨包访问必须使用公开 exports，禁止 deep import。
- 禁止创建根级 `components`、`services`、`utils`、`stores`、`types` 或 `managers` 等无边界目录。

## AI、网络与安全边界

- Provider 调用、密钥和网络传输必须隔离在显式接口之后。
- AI 上下文必须是有意选择、尽可能最小且可检查的。
- 模型响应属于不可信输入，结构化输出必须先验证。
- 模型输出不得直接触发原生命令、任意网络请求、文件写入或不受限制的工具调用。
- 长时间运行的 AI 工作必须支持取消、超时与过期结果保护。
- WebView、Worker、插件和 AI 集成只能获得完成任务所需的最小能力。

所有文件、路径、SVG、图片、字体、剪贴板内容、导入数据、AI 响应和插件内容都应视为不可信输入，并在边界处校验 schema、权限、大小、路径与资源预算。

## Rust、Tauri 与 IPC

- Rust 负责原子文件操作、资源流、系统集成、安全边界和崩溃恢复。
- TypeScript 负责产品语义、交互、AI 工作流与 UI 编排。
- IPC 必须使用显式、类型安全、可验证的 DTO。
- 禁止将 `serde_json::Value`、任意路径、第三方对象、原始错误或未经验证的模型输出直接穿透 IPC。
- 每个原生命令必须定义能力范围、输入校验、错误语义、取消机制和幂等性。

## 修改流程

修改前：

1. 确认用户可见行为、状态所有者和目标包。
2. 搜索现有模型与写入路径，避免重复实现。
3. 判断改动是否影响画布、文档、AI 上下文、持久化、IPC、权限或公开 API。
4. 保持改动聚焦，除非正确性要求扩大范围。

修改时：

1. 保持单一事实来源与单一写入路径。
2. 先设计用户行为与模块契约，再实现内部细节。
3. 在包、IPC、Provider 与文件边界使用显式接口。
4. 替换旧逻辑时删除旧路径，不保留无期限双轨。
5. AI 提案必须可审阅、可取消、可撤销。
6. 重要的持久化、IPC、权限、AI 数据处理或公开 API 变更必须记录到 ADR 或 RFC。

禁止：

- 用兼容层掩盖职责不清的问题；
- 绕过公开 API 或架构测试；
- 使用空 `catch`、隐藏副作用、万能 Store 或万能 Manager；
- 未经请求扩大改动范围；
- 未验证即宣称完成。

## 验证要求

至少执行：

```bash
pnpm lint
pnpm typecheck
pnpm test:architecture
pnpm test
cargo fmt --check
pnpm clippy
pnpm test:rust
```

涉及 AI 时，还必须验证取消、超时、异常模型输出、过期结果、用户确认，以及敏感数据与密钥保护。

## 完成标准

只有在以下条件同时满足时，改动才算完成：

- 功能清晰支持用户的思考与创造过程；
- 模块所有权与依赖方向正确；
- 画布状态保持单一事实来源与单一写入路径；
- AI 行为明确、有边界、可审阅且可撤销；
- 失败、取消、恢复和兼容路径已被考虑；
- 相关测试与检查通过；
- 文档、契约、实现与测试保持一致。
