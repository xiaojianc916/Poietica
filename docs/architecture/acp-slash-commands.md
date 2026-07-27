# ACP 斜杠命令：可用，清单由 agent 自己推送

结论：Kimi Code CLI 0.29.1 的 ACP 通道支持斜杠命令。此前判断「不能用」是两个错误叠加——
读了别的实现或旧版本的报错，又把 TUI 的命令表当成 ACP 的命令表。

## 一、清单从哪里来

- 通道：`session/update` 通知，`sessionUpdate = "available_commands_update"`，字段 `availableCommands`。
- 时机：`session/new` 返回后立刻推送一次；agent 可随时再推，UI 必须以最后一次为准。
- 每项字段：`name`、`description`、`input`；`input.hint` 存在即表示该命令需要参数。
- 它是**能力清单**，不是 UI 清单：清单里有的才允许发，但不必每条都给按钮。

## 二、怎么执行一条命令

- 没有独立 RPC 方法。执行方式是把文本 `/name 参数` 作为 `session/prompt` 的内容发过去，由 agent 解析。
- 证据：发 `/model` 收到 agent 回执 `Unknown ACP command: /model. Use /help to see available`
  `commands.` —— 说明 prompt 文本里的 `/x` 确实被当命令解析，依据就是上面那份清单。
- 因此：不在清单里的名字必然失败，发之前对着清单校验，不要凭印象拼名字。

## 三、0.29.1 实际推送的 18 条

内置：`compact`（唯一带 `input.hint`）、`status`、`usage`、`mcp`、`tasks`、`help`。

技能：`check-kimi-code-docs`、`custom-theme`、`import-from-cc-codex`、`mcp-config`、`sub-skill`、
`sub-skill.consolidate`、`sub-skill.review`、`update-config`、`write-goal`、
`skill:emil-design-eng`、`skill:find-skills`、`skill:transitions-dev`。

清单里没有：`goal`、`plan`、`yolo`、`permission`、`model`、`settings`。TUI 的 `/` 菜单有 51 条，
两张表不同源，不要拿 TUI 截图推断 ACP 能力。

## 四、模型、推理强度、模式不走斜杠命令

- 走会话选择器：`session/new` 响应里的 `configOptions`，改动发 `session/set_config_option`。
- `category` 取值 `model`、`thought_level`、`mode`；`mode` 的选项就是 default、plan、auto、yolo。
- 所以「切到计划模式」不要去发 `/plan`，那个名字根本不在清单里。
- 一轮进行中改选择器会被 native 侧拒绝（`CHANGING`），UI 应当在该轮结束后再允许改。
- `docs/architecture/acp-client.md` 的 `## No modes are published, so no switch can be honest`
  一节已作废，读到请忽略，以本文和 schema 1.4.0 为准。

## 五、当初误判的来源（别再当证据）

- Zed #53161：`missing field availableCommands` —— 旧 schema 的必填字段之争。
- Kimi issue #1380：`module acp has no attribute TerminalHandle` —— 旧版本 acp 模块缺件。
- Qwen Code #1806：`session/set_mode("plan")` 被确认却未生效 —— 另一个 agent 的实现问题。

三条都不是 Kimi 0.29.1 的行为，不能用来断定本项目的能力边界。

## 六、动手前的 30 秒复核

1. 带 `POIETICA_ACP_TRACE` 与 `POIETICA_ACP_COMMAND="kimi.CMD acp"` 跑一次真握手，留下 trace。
2. grep `available_commands_update` 看命令，grep `configOptions` 看选择器。
3. 两者都随版本变化：一律从 payload 渲染，代码里不写死名字、标签、数量或顺序。

## 七、当前状态

斜杠命令的 UI（`/` 胶囊、一键按钮）按用户要求搁置，已落地的是会话选择器菜单。
恢复该工作时先做 `compact`：它是唯一带 `input.hint` 的内置命令，能顺带验证带参数的路径。
