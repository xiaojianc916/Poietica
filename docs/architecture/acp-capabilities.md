# ACP 能力通道目录

判断顺序只有一句：**先问这件事走哪条通道，再问那条通道怎么写。**

「Kimi 的 ACP 命令清单里没有 `/plan`」与「ACP 不能切模式」是两件完全不同的事。模式切换我们
已经做出来了，走的是会话选择器通道。清单里查不到某个 `/x`，只说明它不是文本命令，不说明这件事
没有官方入口。（本文替代已删除的 `acp-slash-commands.md`，那一版把这两件事混为一谈。）

## 一、三条通道

1. **JSON-RPC 方法**：会话的生命周期与查询。客户端主动发，agent 直接应答。
   建会话、列会话、恢复会话、发一轮、取消一轮、应答权限，全在这一条上。
2. **会话选择器**：`session/new` 响应里的 `configOptions`，改动发 `session/set_config_option`。
   凡是「这一整段会话的开关」——模型、推理强度、模式——都在这里，不在文本里。
3. **prompt 文本命令**：把 `/name 参数` 作为 `session/prompt` 的内容发过去，由 agent 解析。
   能发哪些名字由 agent 推送的清单决定；斜杠只是这条通道的语法，不是能力的边界。

## 二、想做的事 → 走哪条通道

- 新建会话 → 通道 1，`session/new`（params `cwd`、`mcpServers`；回 `sessionId` 与 `configOptions`）。
- 列出历史会话与官方标题 → 通道 1，`session/list`（params `cwd`、`cursor`；回 `sessions[]`，
  每项含 `sessionId`、`cwd`、`title`、`updatedAt`），需 `sessionCapabilities.list`，本地为 true。
- 恢复一个旧会话 → 通道 1，`session/load`，需 `agentCapabilities.loadSession`，本地为 true。
- 标题在会话中途变化 → 通道 1 的反向通知 `session_info_update`（`title` 为 `MaybeUndefined`）。
  0.29.1 的实测 trace 里没有出现过，所以标题以 `session/list` 为准，这条到了再覆盖。
- 换模型 → 通道 2，`category = model`。
- 换推理强度 → 通道 2，`category = thought_level`；选项**随模型变化**，不得写死。
- 换模式（default、plan、auto、yolo）→ 通道 2，`category = mode`。
  不是 `/plan`，也不是早期草案里的 `session/set_mode`。
- 发一轮 → 通道 1，`session/prompt`；取消 → 在响应到达前丢弃请求句柄，SDK 会发出取消通知。
- 应答权限 → 通道 1 的反向请求 `session/request_permission` 的响应。
- 压缩上下文 → 通道 3，`/compact`（唯一带 `input.hint` 的内置命令，即需要参数）。
- 状态、用量、MCP、任务、帮助、各类技能 → 通道 3，名字见下。

## 三、通道 3 的清单从哪里来

- 通知：`session/update`，`sessionUpdate = "available_commands_update"`，字段 `availableCommands`。
- 时机：`session/new` 之后立刻推一次；agent 可随时再推，以最后一次为准。
- 每项：`name`、`description`、`input`（有 `input.hint` 即需要参数）。
- 它是能力清单，不是 UI 清单：清单里有的才允许发，但不必每条都给按钮。
- 证据：发 `/model` 收到 agent 回执 `Unknown ACP command: /model. Use /help to see available`
  `commands.` —— 文本里的 `/x` 确实被当命令解析，依据就是这份清单。

0.29.1 推送的 18 条——内置：`compact`、`status`、`usage`、`mcp`、`tasks`、`help`；技能：
`check-kimi-code-docs`、`custom-theme`、`import-from-cc-codex`、`mcp-config`、`sub-skill`、
`sub-skill.consolidate`、`sub-skill.review`、`update-config`、`write-goal`、
`skill:emil-design-eng`、`skill:find-skills`、`skill:transitions-dev`。

清单里没有 `goal`、`plan`、`yolo`、`permission`、`model`、`settings`：前四个是通道 2 的事，
TUI 的 `/` 菜单有 51 条是另一张表，不要拿 TUI 截图推断 ACP 能力。

## 四、约束

- 一轮进行中改选择器会被 native 侧拒绝（`CHANGING`），UI 应在该轮结束后再允许改。
- 通道 1 的可用性由 `initialize` 的 `agentCapabilities` / `sessionCapabilities` 声明，先看再用。
- `docs/architecture/acp-client.md` 的 `## No modes are published, so no switch can be honest`
  一节已作废，以本文与 schema 1.4.0 为准。

## 五、动手前的 30 秒复核

1. 带 `POIETICA_ACP_TRACE` 与 `POIETICA_ACP_COMMAND="kimi.CMD acp"` 跑一次真握手，留下 trace。
2. grep `agentCapabilities` 看通道 1 能用哪些方法，grep `configOptions` 看通道 2，
   grep `available_commands_update` 看通道 3。
3. 三者都随版本变化：一律从 payload 渲染，代码里不写死名字、标签、数量或顺序。

## 六、当前状态

通道 2 已落地为会话选择器菜单。通道 3 的 UI（`/` 胶囊、一键按钮）按用户要求搁置，
恢复时先做 `compact`，它能顺带验证带参数的路径。通道 1 的多会话部分正在做：
`session/new`、`session/list` 与按 `sessionId` 分发，是真会话记录与多标签页的地基。
