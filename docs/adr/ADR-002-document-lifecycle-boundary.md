# ADR-002：画布文档生命周期边界

- 状态：Accepted
- 日期：2026-07-21
- 决策者：Poietica maintainers

## 背景

原有 \`editor/document\` 同时依赖：

- editor/core；
- editor/persistence；
- features/workspace。

它既拥有画布文档会话，又直接修改产品工作台状态。这导致编辑器子系统反向依赖产品 UI，并使文档生命周期无法在无 Workspace 的环境中独立测试或复用。

## 决策

将画布文档生命周期移动到：

\`editor/document\`

包名为：

\`@poietica/editor-document\`

该包拥有：

- EditorSession 集合；
- 文档打开和创建；
- dirty revision；
- 保存状态机；
- 文件格式编解码协调；
- 关闭决策；
- 应用退出前的文档关闭计划。

该包不得依赖：

- React；
- Workspace；
- Tauri；
- 桌面窗口；
- 产品命令注册；
- 平台 adapter 类型。

桌面应用在 composition root 中创建：

- CanvasDocumentService；
- WorkbenchSessionStore；
- CanvasWorkflow。

CanvasWorkflow 是应用层协调器，负责在文档会话与 Workspace 标签页之间维护一致性。

## 依赖关系

\`\`\`mermaid
graph TD
  Desktop[apps/desktop]
  Workflow[CanvasWorkflow]
  Workspace[features/workspace]
  Document[editor/document]
  Core[editor/core]
  Persistence[editor/persistence]
  Platform[platforms/desktop-runtime]

  Desktop --> Workflow
  Workflow --> Workspace
  Workflow --> Document
  Document --> Core
  Document --> Persistence
  Desktop --> Platform
\`\`\`

## 状态所有权

- TLStore：唯一画布文档事实来源；
- EditorSession：Editor/TLStore 运行时生命周期；
- CanvasDocumentService：文件路径、revision 和保存状态；
- WorkbenchSessionStore：标签页、活动画布和 Workspace 投影；
- CanvasWorkflow：跨模块事务与失败补偿；
- React：仅拥有对话框开关等临时 UI 状态。

## 备选方案

### 保持 canvas-session 为 Feature

拒绝。它不是用户可选择的产品能力，而是所有画布文档都需要的编辑器生命周期基础能力。

### 合并到 editor/core

拒绝。editor/core 应只管理 tldraw runtime、schema 和扩展注册，不应知道文件选择或应用退出。

### 让 Workspace 拥有文档会话

拒绝。Workspace 是产品壳层投影，不应拥有 TLStore、文件路径或保存事务。

## 后果

正面影响：

- 消除 editor/application 对 Workspace 的反向依赖；
- 文档生命周期可脱离 React 和 Tauri 测试；
- 跨模块事务集中在应用层；
- 为原子保存、恢复和文件监视提供稳定边界。

代价：

- 增加一个小型 CanvasWorkflow 协调器；
- 文档会话和 Workspace 标签页仍是两种状态，但所有同步只发生在一个位置；
- 后续需要为跨模块补偿路径增加测试。

## 重新评估条件

出现以下情况时重新评估：

- Workspace 被多个应用复用；
- 引入多窗口共享同一文档会话；
- 引入协作服务器和后台文档进程；
- 文档生命周期迁移到独立进程；
- 插件需要受控访问文档级能力。
