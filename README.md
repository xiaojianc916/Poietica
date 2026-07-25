# Poietica

**Poietica** 是一个本地优先、由 AI 辅助的思考与创作工具。

它的名字来自 *poiesis*，意为“创造、生成、使之成为”。Poietica 不是单纯的画图软件，也不只是 AI 对话工具；它帮助人们描述想法、探索可能性、组织素材、获得启发，并逐步将模糊思绪发展为有意义的创作成果。

## Poietica 如何帮助创造

Poietica 不要求用户遵循固定的创作方式。用户可以从任何适合当前状态的入口开始：

- **描述**：写下正在思考的问题、目标、感受或尚未成形的想法。
- **AI 启发**：通过提问、联想、重构、建议和生成，发现新的方向。
- **画布**：在空间中放置、连接、比较和发展想法、笔记与素材。
- **笔记与素材**：保存参考信息、碎片化灵感、草图和过程记录。
- **整理与推进**：逐步形成结构、概念、计划、表达或最终作品。

画布是重要的思考与创作工具之一，但不是产品唯一或绝对的核心。自然语言、AI、笔记、素材与结构化整理同样可以成为创作的起点和过程的一部分。

> Poietica 的目标不是替用户创造，而是帮助用户更容易地继续创造。

## 产品原则

### 创造优先

- AI 应帮助用户发现、表达和发展自己的想法。
- AI 输出是建议，不是默认正确答案。
- 用户始终拥有作品、上下文与最终成果的控制权。
- 产品应鼓励探索，而不是过早要求用户确定结构或结论。

### 多元创作入口

- 不将任何单一交互方式定义为创作的唯一中心。
- 画布、描述、AI、笔记、素材与整理能力共同构成创作环境。
- 用户应能够在不同工具之间自然流动，而不是被锁定在固定流程中。
- 功能设计应帮助用户从模糊走向清晰，从探索走向表达。

### 本地优先与可信赖

- 用户文档属于用户。
- 保存、恢复、导出和文件行为必须可靠、明确且可理解。
- 网络与 AI 能力必须建立在明确的用户意图之上。
- 未经清晰设计与用户可见同意，不得将敏感内容发送给外部服务。

## 当前技术方向

Poietica 是基于以下技术构建的桌面应用：

- **tldraw**：画布能力与画布文档模型
- **React + TypeScript**：产品交互和界面
- **Tauri + Rust**：桌面运行时、文件系统和原生能力
- **pnpm + Turborepo**：Monorepo 与工程流程

对于**画布文档**，tldraw `Editor` 与 `TLStore` 是画布状态的唯一事实来源。这项技术约束只适用于画布数据模型，不代表画布是整个产品唯一的创作核心。

## 仓库结构

```text
poietica/
├── apps/
│   └── desktop/                 # Tauri 桌面应用与最终组合入口
├── editor/
│   ├── core/                    # tldraw Runtime、Schema、Store、扩展注册
│   ├── assets/                  # 资源存储与生命周期
│   ├── document/                # 文档会话、保存状态与生命周期
│   ├── persistence/             # 本地文档格式、序列化与迁移
│   └── extensions/              # 编辑器扩展契约
├── features/
│   ├── ai/                      # AI 辅助思考与创作
│   ├── settings/                # 产品设置
│   └── workspace/               # 工作台、命令、面板与应用外壳
├── platforms/
│   ├── desktop-ipc/             # 类型安全 IPC 契约
│   └── desktop-runtime/         # 文件、对话框、剪贴板与窗口能力
├── foundations/                 # 稳定、通用、无产品语义的基础能力
├── docs/                        # 架构、ADR、RFC 与运行文档
├── scripts/                     # 工程与质量工具
└── tests/                       # 架构与产品验证
```

## 开始开发

```bash
git clone https://github.com/xiaojianc916/poietica.git
cd poietica
corepack enable
pnpm install
pnpm tauri:dev
```

## 常用命令

```bash
pnpm dev
pnpm tauri:dev
pnpm typecheck
pnpm lint
pnpm test:architecture
pnpm test
pnpm check
pnpm build
pnpm clippy
pnpm audit
pnpm audit:rust
```

## 文档

- [AGENTS.md](./AGENTS.md)：仓库修改规则
- `docs/architecture`：稳定架构说明
- `docs/adr`：已接受的架构决策
- `docs/rfcs`：讨论中的设计提案
- `docs/runbooks`：运行与维护说明

## 许可证

Apache-2.0，详见 [LICENSE](./LICENSE)。
