# ACP 模型与 Agent 配置

- 状态：已接受（第 1 步：TypeScript 契约与界面）
- 日期：2026-07-28

## 背景

设置里的"模型"页此前只有界面：一张写死的模型表加上各家 provider 的密钥输入框，
改动只留在 React state 里，不落盘、不发请求。

但本产品的架构是 ACP：客户端不调用模型 API，请求一律由 agent 子进程发出。
在这个前提下，"配置模型"被拆成了两半，而旧界面把它们混成了一件事。

## 决策

### 1. 模型的真值来自会话，不来自设置页

ACP v1 的 Session Config Options 规定：agent 在 session/new 返回 configOptions，
客户端用 session/set_config_option 修改，agent 用 config_option_update 反向通知，
两者都携带完整配置状态。category 的保留值为 mode / model / model_config / thought_level。

因此模型选择器属于聊天界面。设置页里的模型清单只表达收藏（排序）与默认值（启动注入），
与 Zed 的 favorite_config_option_values / default_config_options 语义一致。

### 2. 凭据通过环境变量注入，不改写 agent 自己的配置文件

密钥存系统钥匙串，只在 spawn 的瞬间注入子进程环境。不写 ~/.claude/settings.json
一类的文件：格式各家不同、会被 agent 重写，而且会让密钥明文落盘。

已知代价：用户自己的 settings.json 若写了同名变量会覆盖我们的注入。界面需如实说明。

### 3. 只支持两种方言

anthropic 与 openai-chat。Codex 走 Responses API、Gemini 走自家协议，需要额外适配，
因此它们的 agent 档案不绑定提供方，由 agent 自行认证。客户端不做协议转译。

### 4. 配置落在独立的 agents.json，不进 AppSettings

agent 接入是设备级的运行环境配置，与主题、快捷键这类偏好不是同一种东西。

### 5. 解析容错

单个坏档案被丢弃并汇报，不让整份配置失败。

## 参考

- ACP: /protocol/v1/session-config-options, /protocol/v1/initialization, /rfds/auth-methods
- Zed: crates/settings_content/src/agent.rs (CustomAgentServerSettings)
- Zed: crates/agent_servers/src/custom.rs (钥匙串 -> extra_env)
- Zed: crates/util/src/redact.rs (日志脱敏)

## 后续

- 第 2 步：Rust 侧 agents.json 原子读写、keyring、注入与脱敏。
- 第 3 步：spawn 改用 agent 档案；聊天界面接 configOptions 做模型切换。
