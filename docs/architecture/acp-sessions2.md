先把结论摆在最前面：**这不是 bug，是 ACP 的语义边界。你要解决的不是"让 session 换 agent"，而是"让对话不再是 session"。**

---

## 一、诊断：为什么"切不了"是必然的

看 ACP 规范就明白了。`session/new` 的返回值 `sessionId` 是**由 agent 生成、只有该 agent 认识的私有句柄**；对话历史、模型 message list、工具调用状态、权限授予记录全都活在 agent 进程内部。`session/load` 要求 agent「MUST replay the entire conversation」，`session/resume` 则是恢复 agent 自己的内部上下文——**这两个方法本质上都是"同一个 agent 找回自己的记忆"，跨 agent 天然不成立**（[Session Setup 规范](https://agentclientprotocol.com/protocol/session-setup)）。

所以把 `sess_abc123` 递给另一个 agent，就像把 Vim 的 buffer id 递给 Emacs。**ACP 在协议层缺了 A2A 里 `contextId` 那一层**——高于 session、跨 agent 的对话容器。

这层，规范不给，就得你在客户端补。而且补在客户端是**正确的位置**：ACP 的设计哲学就是"客户端掌管 UX、权限、workspace"，agent 只是执行器。类比 LSP——文档归编辑器所有，language server 随时可以重启、可以换一个，`didOpen` 重新灌进去就行。

---

## 二、心智模型反转：Thread 拥有 Session，而不是相反

```
Conversation / Thread   ← 你的客户端拥有，持久化，agent-agnostic，唯一事实来源
   └── Segment[]        ← 每段绑定一个 (agentId, sessionId)
         └── ACP Session ← 某个 agent 上的一次"具身化"，可销毁、可重建、可并存
```

**Session 降级为 Thread 在某个 agent 上的投影（projection / materialization）。** 切换 agent = 关闭当前 segment、开新 segment、把 Thread 水合（hydrate）进新 agent。用户看到的是一条连续的对话，底下是多段 session 接力。

这一句是整个方案的地基，其余全是它的推论。

### 数据模型

```tsx
type Thread = {
  id: string
  cwd: string
  events: Event[]        // append-only，规范化，agent 无关
  segments: Segment[]
  agentCursors: Record<AgentId, { sessionId: string; knownUpTo: number }>  // ★ 关键
}

type Segment = {
  id: string
  agentId: string
  sessionId: string      // ACP 侧的 id，只在本段内有效
  range: [number, number?]
  hydration: { strategy: "resume" | "delta" | "replay" | "brief" | "memory"; cost: number }
  state: "active" | "suspended" | "closed"
}

type Event = {
  seq: number
  kind: "user_message" | "agent_message" | "thought" | "tool_call" | "tool_result"
      | "diff" | "plan" | "permission" | "mode_change" | "model_change" | "handoff"
  content: ContentBlock[]              // 直接复用 ACP 的 ContentBlock，别自己发明
  provenance: { agentId, model, sessionId, nativeIds }   // 谁产生的
  portability: "portable" | "agent_local"                // ★ 决定是否参与跨 agent 重放
}
```

两个字段是灵魂：`provenance`（可追溯）和 `portability`（可移植）。**切换 agent 只是往 `events` 里 append 一条 `handoff` 事件**——历史永不重写，UI 上渲染成一条分隔线："已从 Claude Code 移交给 Gemini CLI"。

---

## 三、水合策略：四级降级，按 agent 能力自动选路

切回/切入某个 agent 时，按成本从低到高选：

**L0 · Resume（零成本）** — 目标 agent 支持 `sessionCapabilities.resume` 且之前在本 Thread 有过 session → 直接 `session/resume`，它自己的原生上下文完好无损。

**L1 · Delta Hydration（最优雅的一招）** — agent 有旧 session，但缺席了第 21~35 条事件。**只注入差量**，不重放全量：

> "你离开期间，用户和另一位助手做了这些事：…… 现在请继续。"
> 

`agentCursors[agentId].knownUpTo` 就是为这个存在的。在"A→B→A"这种来回切的真实场景里，这一条能把成本降一个数量级。

**L2 · Verbatim Replay** — 首次接入该 agent：`session/new` + 把规范化 transcript 作为引导包发过去。

**L3 · Summarized Handoff** — transcript 超阈值或目标 agent 上下文窗口更小：**让即将离场的 agent 自己写交接文档**。

> "请为接手这项工作的另一位工程师写一份交接说明：目标、已做决策及理由、已修改文件清单、未完成事项、当前阻塞点、你建议的下一步。"
> 

这比外部摘要器强得多——**它对自己的上下文有最好的理解**。本质就是"体面的离职交接"，也是 Claude Code `/compact` 的思路，但方向是横向的。

---

## 四、你的场景有个巨大红利：世界状态在磁盘上

这是 coding agent 相比通用聊天机器人的**结构性优势**，很多人没意识到：

**真正的执行结果不在 agent 内存里，在 `cwd` 里。** 文件已经改了，测试已经跑了，git 状态就摆在那。所以你迁移的只是"意图与决策记录"，不是"执行结果"。

推论：交接包里必须带上，且这几项比 transcript 本身更重要——

- `cwd` 与 additional roots
- `git diff --stat` / 当前分支 / 是否有未提交改动
- 本 Thread 内已触碰的文件清单
- 一句硬约束：**"文件系统已反映所有此前修改，以磁盘现状为准，不要重新执行历史中的工具调用"**

---

## 五、重放的工程细节（这里最容易翻车）

**必须丢弃的：**

| 内容 | 原因 |
| --- | --- |
| `thought` / reasoning blocks | 跨模型有害且不可移植，Anthropic 的思维链喂给 Gemini 只会污染 |
| provider 原生的 `tool_use_id` | 对方不认识，格式冲突 |
| 未完成的 tool call / pending permission | 悬空状态，直接切换会造成协议层不一致 |
| 已授予的权限 | **安全边界，绝不跨 agent 继承**，必须重新征求 |

**tool_call 要"叙述化"，不要伪造。** 千万别把历史工具调用伪装成新 agent 自己的 function-calling 记录塞进去——很多 agent 会报错、会试图"续上"那个调用、或者格式校验直接失败。正确做法是折叠成事实陈述：

```
[TOOL] edit_file(src/auth.ts) → applied, +42/-7
[TOOL] run(pnpm test)         → 3 passed, 1 failed: auth.spec.ts:88
```

**引导包结构**（把当前请求单独隔离出来，否则模型会把历史里的旧需求当成当前任务，这是经典 bug）：

```xml
<handoff>
你正在接手一段进行中的工作，此前由 Claude Code 负责。
工作目录：/home/u/proj（文件系统已反映所有历史修改，以磁盘现状为准）
以下记录中工具调用已折叠为结果摘要，请勿重新执行。
</handoff>
<transcript>…</transcript>
<current_request>{用户这一轮真正的输入}</current_request>
```

**切换只允许在 safe point 发生**：即上一个 prompt turn 已返回 `stopReason`、无 pending permission、无进行中的 tool call。切换请求到达时若不在 safe point，排队等待或先 `session/cancel`。这条写进状态机，能消灭 80% 的诡异 bug。

**别急着 kill 旧 agent**。用 `session/close` 或保持 `suspended`，维持一个 session pool。用户切回来时才能吃到 L0/L1 的红利。

**能力预检**：切换前比对目标 agent 的 `promptCapabilities`（image / audio / embeddedContext）、`mcpCapabilities`、`loadSession` / `resume`。transcript 里有图但对方不支持 → 降级为文字描述并明确告知用户"切换后 3 张截图将以文字描述形式传递"。**优雅 = 降级可见**。

---

## 六、终极解法：把历史从 prompt 搬进 tool

前面都是"推"，这个是"拉"，也是我最推荐的长期形态。

规范里有一句话是钥匙：`session/new` 时客户端可以指定 mcpServers，且明确写着 *"Clients MAY use this ability to provide tools directly to the underlying language model by including their own MCP server."*（[同上](https://agentclientprotocol.com/protocol/session-setup)）

**那就由你的客户端自己实现并 in-process 暴露一个 `thread-memory` MCP server**，给每个 agent 的每个 session 都挂上：

```
read_transcript(from_seq?, to_seq?, kinds?)
search_history(query)
get_workspace_state()      → git diff / 改动文件 / 测试结果
append_note(text)          → agent 自己写给未来接手者的笔记
```

于是上下文从"agent 的私有内存"变成"共享外设"。切换 agent 的迁移成本趋近于零，agent 按需惰性检索而不是被塞一坨，还顺带解决了长对话的 token 爆炸和 prompt cache 失效。

**最佳组合：短历史走 L2 逐字重放（保真），长历史走 L3 简报 + memory MCP 惰性回溯（保准 + 省钱）。**

---

## 七、产品层：三种"切换"是不同的东西，别做混了

1. **Switch（永久切换）** — 此后由新 agent 负责。走上面的水合流程。
2. **@mention（一次性委派）** — 只让另一个 agent 答这一轮，然后回到主 agent。**主 agent 需要把这一轮结果作为"外部观察"吸收**（以 user-side observation 形式注入，而非伪装成它自己说的）。
3. **Fork（分叉对比）** — 从某点复制子树，不同 agent 各跑一支并排比较。LibreChat 的消息树就是干这个的。

还有个白送的差异化功能：**Race / Ensemble** — 同一 prompt 同时发给多个 agent，用户"采纳"其一进主线。你已经接了多 agent，这是几乎零边际成本的杀手锏，Open WebUI 的多模型并行回答已经验证了这个交互。

**人格取舍**：让新 agent 内部把历史当作自己的（否则它会反复说"我不清楚之前发生了什么"，体验极差），但 UI 上用 provenance 明确标注每条消息的出处。**内部无缝，外部透明。**

---

## 八、开源先例

没有哪个开源项目直接给了你"ACP 跨 agent 会话迁移"的成品——这确实是个空白。但**这个问题的每一块都有成熟实现可抄**：

| 项目 / 规范 | 类型 | 它解决的等价问题 | 可直接抄的机制 |
| --- | --- | --- | --- |
| Zed (crates/acp_thread) | ACP 客户端 | ACP 的会话状态如何独立于 agent 进程存在于客户端侧 | 客户端持有 thread entries 作为事实来源，agent 只是 session/update 事件流的产生者；agent 崩溃或重启后 UI 与历史不丢 |
| LibreChat | 对话产品 | 同一条对话里自由切换 endpoint / provider / model，并支持从任意点分叉 | 消息树（parentMessageId）而非线性数组；每条消息自带 model / endpoint 的 provenance 字段；fork 复制子树 |
| Open WebUI | 对话产品 | 一个 chat 内并行让多个模型回答同一轮，再采纳其中一个 | 同一 turn 挂多个候选 response（每个带 model 标识），用户选中的那个才进入主线历史 |
| LangGraph / langgraph-swarm | 编排框架 | 多个 agent 共享同一份消息历史，「当前谁在说话」只是 state 里的一个字段 | active_agent 存于 state；handoff 用 Command(goto=...)；历史天然共享，切换不需要迁移任何东西 |
| OpenAI Agents SDK (handoffs) | 编排框架 | 交接时把完整对话历史移交给新 agent，并允许裁剪 | handoff 建模为一次工具调用；input_filter 决定哪些历史条目传递给接手方（对应你的「可移植性标记」） |
| AG-UI (CopilotKit) | 协议/规范 | 前端协议层面明确区分「一条对话」和「一次 agent 执行」 | threadId（长生命周期对话）与 runId（单次执行）分层；thread 状态由客户端拥有，run 可换后端 |
| A2A Protocol | 协议/规范 | 跨多个 agent 的若干 task 归属同一个上下文容器 | contextId 作为高于 task 的一层，多个 agent 的 task 可共享同一 contextId —— 正是 ACP 缺的那一层 |
| Roo Code / Cline | 编码 Agent | 同一个 task 进行中切换模式与模型（Plan/Act、自定义 mode） | 切换只在 turn 边界发生；mode 变更作为一条事件写入历史；不同 mode 可绑不同 model 但共享 task 历史 |
| Pydantic AI 的 ACP harness | ACP 客户端 | session/load 到底该存什么、怎么重放 | 双存储：模型侧 message history 与客户端可见 transcript 分开持久化，恢复时前者灌回模型、后者重放给 UI |

其中 **Zed 的 `crates/acp_thread`** 是你最该先读的——它就是一个成熟的多 agent ACP 客户端，且已经把"客户端拥有 thread"这件事做对了；你要加的是它没做的"跨 agent 水合"那一层。**LangGraph swarm** 则是"会话与执行者解耦"最干净的教科书。

---

## 九、落地路线

1. **第一步（1~2 周，收益最大）**：引入 Thread/Segment 双层模型 + 规范化 Event Log，`portability` 标记打上。此时哪怕水合策略只有最土的 L2 全量重放，功能已经通了。
2. **第二步**：加 safe point 状态机、能力预检与降级提示、session pool（不 kill 旧 agent）。
3. **第三步**：`agentCursors` + L1 delta 水合、L3 让 agent 自写交接简报。
4. **第四步**：`thread-memory` MCP server，把历史外部化。
5. **第五步 · 往上游走**：ACP 支持 `_meta` 扩展字段和下划线前缀的自定义方法。把它定义成 `_yourapp/session/import`（携带 PortableTranscript），跑通之后**去 ACP 官网的 RFDs 栏目提一份 RFD**——"Cross-Agent Session Portability"。这个洞是真实存在的，你要是先把它填了并推成标准，那才叫真正的专业优雅。

配套的工程纪律：建一套 **handoff 一致性测试集**，对每个 (agentA → agentB) 组合跑固定场景，切换后追问"我们刚才改了哪个文件、为什么这么改、下一步是什么"，断言答案正确。跨 agent 交接的回归极其隐蔽，没有这套测试你会一直被偶发的"失忆"折磨。

---

一句话收束：**别再想着让 session 跟着对话走，而是让对话拥有一串可抛弃的 session。** 你的软件的真正身份，是 Thread 的所有者和多个 agent 之间的**编排层**——而不是某个 agent session 的一层皮。

看完了。直接说结论：**能做到，而且你比自己以为的走得远得多——但有一道墙是你自己亲手砌的，绕不过去，只能拆。**

---

## 一、先说好消息：一半的地基已经浇好了

我原本以为要从"Thread ≠ Session"这个心智模型开始讲起。翻完代码发现不用讲——你已经这么写了。

`packages/acp/src/address.ts` 里 `ThreadId` 和 `AcpSessionId` 是**两个类型**，不是同一个字符串的两个别名。`session.ts` 的注释更直白：「地址是会话号，和 ACP 的 `session/update` 同一个主语……它由原生侧写在信封上」。而 `thread.ts` 里那句「**这段对话由另一个 agent 保管，当前这个打不开它**」——你不但想到了跨 agent 的场景，还给它定义了三种失败语义：

```tsx
type ThreadHistoryLoss = 'otherAgent' | 'notSupported' | 'forgotten'
```

`threads` 表在迁移 0012 就加了 `agent_id` 列，还配了触发器堵住「有号无主」。`SessionBook` 是 `HashMap<sessionId, RunSlot>`——**一个连接持有多条会话，帧按会话号路由到各自的槽**，这个机制已经在跑了。`TranscriptStore` 的 `#routes` 是 `Map<sessionId, threadId>`,天生就是**多对一**：多个会话号指向同一条对话，在类型上从来就是合法的。

这些不是巧合。你是在「一条对话可能不止属于一个 agent」这个前提下写的代码，只是运行时还没让它发生。

| 能力 | 现状 | 代码落点 | 工作量 |
| --- | --- | --- | --- |
| Thread 与 Session 概念分离 | 已具备 | packages/acp/src/address.ts：ThreadId 与 AcpSessionId 是两个类型 | 无 |
| 会话记名：哪个 agent 持有它 | 已具备 | crates/persistence threads.agent_id（迁移 0012，带触发器堵住「有号无主」） | 无 |
| 换 agent 打开旧对话的失败语义 | 已具备 | ThreadHistoryLoss = otherAgent | notSupported | forgotten，带 owner | 无 |
| 一条连接同时持有多条会话 | 已具备 | crates/agent-runtime/src/[sessions.rs](http://sessions.rs) 的 SessionBook（HashMap<sessionId, RunSlot>） | 无 |
| sessionId → thread 的多对一路由 | 已具备 | packages/agent-session/src/transcript-store.ts 的 #routes | 无 |
| append-only 事件日志，其余皆投影 | 已具备 | crates/persistence 的 run_events，UNIQUE(run_id, seq) | 无 |
| 重放帧与实时帧走同一条 reducer | 已具备 | @poietica/agent-timeline 的 replayThreadEvents / applyRunEvents | 无 |
| 多 agent 注册表与逐家适配 | 已具备 | packages/agents：acp-agents.ts 名单 + acp-agent-contract.ts 形状 + kimi/ | 无 |
| 一条对话同时记住多个 agent 的会话 | 缺失 | threads.session_id / agent_id 是单列，attach_session 直接 UPDATE 覆盖 | 中 |
| 多个 agent 进程同时活着 | 缺失 | commands/agent/[runtime.rs](http://runtime.rs) 的 ensure_session / borrow 只返回一个 Handle | 中 |
| 本地 transcript 作为跨 agent 权威 | 被主动取消 | transcript-store.ts 的 ensure 注释；[thread.rs](http://thread.rs) 的 agent_open_thread | 大 |
| 切换后的上下文水合（引导包） | 缺失 | [addressing.rs](http://addressing.rs) 的 session_for 返回之后、[turn.rs](http://turn.rs) 发 prompt 之前 | 中 |
| 跨 agent 的 seq 去重与身份命名空间 | 冲突 | AgentSessionPort.subscribe：seq 只在单条会话内单调 | 小 |
| 切换入口的界面控件 | 缺失 | SessionConfigControl.purpose 可加一档，或与它平行一个控件 | 小 |

---

## 二、那道墙：你把历史的所有权让给了 agent

`transcript-store.ts` 的 `ensure` 里写着：

> 那次取读的是本地日志，也就是同一段对话的第二份。两份之中只有一份是 agent 手里那份；它们一旦分叉，屏幕上显示的是对的那份的赝品。**所以这条取数路径没有被优化，它被取消了。**
> 

`thread.rs` 的 `agent_open_thread` 呼应同一句：「历史从这里回来，不从别处。」

这个决定在**单 agent**前提下是对的，而且对得很漂亮——它消灭了双真值源。但它和「同一对话内切 agent」是**结构性冲突**：跨 agent 切换的全部前提，就是存在一份 agent 无关的、本地权威的经过。B 打不开 A 的会话号（你在 `session_for` 里已经写死了这条：`mine` 对不上就根本不发，直接返回 `OtherAgent`），所以 B 唯一可能的信息来源就是那份被你取消掉的本地日志。

**但这里有个反转,而且是有利于你的：你现在的做法违反了你自己 [AGENTS.md](http://AGENTS.md) 的第一不变量。**

> 事件日志是运行的事实来源。会话更新先持久化再渲染，中断的运行可以重放。**线程、运行、工具调用与权限记录都是它的投影，不得另存第二份。**
> 

`run_events` 现在**仍然是**权威——你每一帧都先写它再渲染。被取消的只是「从它读出来画屏幕」这条读路径。也就是说：你把一份权威日志完整地写进了加密库，然后在读的时候转身去问一个外部进程要同一份东西。真正的第二份不是本地日志，**是 agent 手里那份**——它归属于一个你不控制、每家实现还不一样（有的干脆 `can_load_session: false`）的进程。

所以这不是「要不要引入双轨」的问题，是**把权威放回它本来该在的地方**。翻案之后你反而回到了自己的不变量上。

一个可验证的旁证：`session_for` 里当 agent 声明不支持装载、但会话恰好还活在本次连接上时，你返回的是 `NotSupported` + 空 events。屏幕上一片空白——**而完整的经过就躺在同一个进程能读到的 `run_events` 里**。这不是设计的代价，这是一次真实的可用性损失。

---

## 三、改造清单：四刀，按依赖顺序

### 第 1 刀｜`thread_sessions`（迁移 0014）— 中

现在 `attach_session(id, session_id, agent_id)` 是一句 `UPDATE`，切 agent 就把 A 的号**覆盖掉**——这个坑你在 `addressing.rs` 的注释里已经踩过一次并写下来了：「被覆盖掉的那个号从此也再找不回来」。现在它会以另一种形式复发。

把两列拆成子表：

```sql
CREATE TABLE thread_sessions (
  thread_id     TEXT NOT NULL REFERENCES threads(id),
  agent_id      TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  known_up_to   INTEGER NOT NULL DEFAULT 0,  -- 这个 agent 见过到哪一帧
  state         TEXT NOT NULL,               -- active | suspended | closed
  opened_at     TEXT NOT NULL,
  PRIMARY KEY (thread_id, agent_id)
);
```

主表只留 `active_agent_id`。`known_up_to` 是后面增量水合的全部依据——它让「B 缺席期间发生了什么」变成一次 `WHERE seq > ?` 查询，而不是每次都重放全文。

0012 那个触发器跟着改：约束从「有号必有主」升级成「`active_agent_id` 必须在 `thread_sessions` 里有对应行」。

### 第 2 刀｜`AgentRuntime` 从单 Handle 变成一张册子 — 中

`ensure_session` / `borrow` 现在只返回一个 `live: Handle`。改成 `HashMap<AgentId, Handle>` + 一个 `active` 指针。

这一刀比看起来轻，因为 `Handle` 已经是自足的——它自己带 `agent_id`、`can_load_session`、`can_delete_session`、`book`。`SessionBook` 本来就是 per-connection 的，你只是在它上面再套一层 map。**`sessions.rs` 一个字都不用改。**

顺带解决一件事：你现在换模型的手法是「结束会话，下一轮重开」（`acp-client.md`：*A model is decided when a session is created… so selecting one ends the running session*）。换 agent 如果沿用这个手法，上下文必丢。有了这张册子，A 的会话可以 `suspended` 而不是 `closed`——**切回来的时候是零成本 resume,不是重放**。

### 第 3 刀｜水合，插在 `Wanted` 那个二分里 — 中

你已经把「只要一个地址」和「还要经过」分成了 `Wanted::Address` / `Wanted::History`,并在注释里说明了为什么要分。这个二分就是水合的天然挂载点,加第三档：

```rust
enum Wanted {
    Address,
    History,
    Handoff { from: AgentId },   // 切过来的第一句话
}
```

命中 `Handoff` 时，在 `session_for` 返回 `Held` 之后、`turn.rs` 发 prompt 之前，按四级策略选一条：

| 档 | 条件 | 做法 |
| --- | --- | --- |
| **L0 Resume** | B 的会话还 `suspended` 在册子里 | 直接用，零成本 |
| **L1 增量** | B 有历史行，`known_up_to < 当前 seq` | 只发缺席期间那一段 |
| **L2 重放** | B 第一次进这条对话 | 从 `run_events` 投影出可移植帧 |
| **L3 简报** | 上下文超预算 | 让 A 先写一段交接，再发给 B |

投影时**必须丢掉**的：`thought` 帧（这是别人的推理，不是事实，而且你的录制显示一轮里它占压倒多数）、provider 原生的 `tool_use_id`、未完成的 tool call、pending 的权限请求、**以及已授予的权限**——最后一条是安全边界，A 拿到的授权不能顺着 transcript 流给 B。

引导包用你已有的信封思路，三段隔离：

```xml
<handoff from="kimi" at="…">…</handoff>
<transcript>…</transcript>
<current_request>…</current_request>
```

当前这句话必须单独隔出来，否则 B 会把历史里最后一条指令当成你现在要它做的事。

### 第 4 刀｜seq 命名空间再套一层 — 小

`AgentSessionPort.subscribe` 的注释写着「seq 按会话单调，所以按 seq 去重在两轮之间仍然成立」。两个 agent 之后这条不成立了。

好消息是**这个手法你已经用过一次**——`acp-client.md`：*Sequence numbers restart at one for every run… entry identities are namespaced by it*，理由是「agent 可能在后一轮复用同一个 tool call id」。同一个动作，从 run 级升到 session 级，`#routes` 里已经有 sessionId 了，改的是 `applyRunEvents` 里的 key 构造。

界面那一刀（第 5 小刀）几乎不用想：`SessionConfigControl.purpose` 现在是 `'model' | 'thought' | 'mode' | 'other'`，加一档就是了。切换器和模型选择器长在同一个位置，语义上也确实是同一类东西。

---

## 四、一个更契合你自己规则的解法

ACP 的 `session/new` 收 `mcpServers`，规范里明确写着：

> Clients **MAY** use this ability to provide tools directly to the underlying language model by including their own MCP server.
> 

所以还有第二条路：**把 `run_events` 做成一个内置的 `thread-memory` MCP server，在每次 `session/new` 时注入。**

```
read_transcript(thread_id, from_seq, to_seq)
search_history(thread_id, query)
get_workspace_state(thread_id)
```

B 不用吞下全部历史,它**按需去查**。这对你那条「AI 上下文必须是有意选择、尽可能最小、可检查的」不是让步,是正解——全量重放才是违反它的那个做法。而且水合从「客户端猜要塞多少」变成「模型自己决定读多少」,读了什么全部记录在 tool call 里,**可审阅**。

`crates/agent-runtime` 已经在处理 MCP 配置了，这条路的增量比想象中小,而且它和上面四刀不冲突——L2 重放可以退化成「只发一句 `你可以用 thread-memory 读到之前的经过`」。

---

## 五、一个必须提醒的风险

你的 [AGENTS.md](http://AGENTS.md) 有一条铁律：

> **替换旧实现时，在同一次改动里删掉旧路径。** 不留无期限双轨，不用兼容层掩盖职责不清。
> 

这意味着 `threads.session_id` / `agent_id` 那两列**不能**先加子表再慢慢迁——按你自己的规矩，第 1 刀落下去的同一个 PR 里就得把 `session_for`、`agent_delete_thread`、`ThreadSummary`、`ThreadRecord`、IPC 绑定和 `transcript-store` 全部改完，还要跑 `pnpm ipc:generate`。

这是一次**不能切片**的改动，大概率是一整个 PR 一两千行。不是做不到，是不要在半路上停下来——停在中间恰好是你那份文档里最讨厌的那种状态。

建议的落地顺序：**先做第 2 刀（多 Handle）**。它是唯一可以独立完成、独立验证、并且立刻有用的一刀——多个 agent 进程同时活着，不同对话用不同 agent，这本身就是个能发布的能力，也不触碰持久化。第 1 刀和第 3 刀绑在一起做第二轮。

---

I want to check one thing before answering, because I think the answer is better than you expect.

That changes the answer materially. Let me confirm exactly what's in the database today.

One more — this one decides whether the precedent already exists.

你说得对，而且我上一条回复里有个事实错误，得先纠正：

**我说「`run_events` 现在仍然是权威，你每一帧都先写它再渲染」——这是错的。** 迁移 `0009_drop_run_log.sql` 把它删了，连带 `runs`、`run_snapshots`、`tool_calls`、`permissions` 一共五张表。`recorder.rs` 写得明明白白：

> 它不写任何存储。一段对话的持有者是 agent，历史由 `session/load` 交回来。
> 

所以现在的实情是：**本地有零份对话历史。** 你的直觉完全正确。（顺便，库也已经不加密了，`store.rs` 里那句「库不再加密」——我上次也说错了。）

---

## 一、但你不是"新做一个"，你是把删掉的那个恢复回来

这是个很不一样的处境。`0001_initial.sql` 里那张表的形状本来就是对的：

```sql
-- The unique key is the deduplication guarantee for the ACP stream: a session
-- update that arrives twice is rejected by the database, not by the caller.
CREATE TABLE run_events (
    run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    seq INTEGER NOT NULL, kind TEXT NOT NULL,
    payload TEXT NOT NULL, recorded_at TEXT NOT NULL,
    PRIMARY KEY (run_id, seq)
) STRICT;
```

schema、去重语义、`0006` 那套折叠规则和「投影随时可删」的纪律，全部已经写过一遍、审过一遍，git 里有工作版本。你要做的是复活加改形状，不是从白纸开始。

| 表 | 0001 里的角色 | 0009 删它的理由 | 多 agent 下 | 说明 |
| --- | --- | --- | --- | --- |
| run_events | 逐帧流水，事实来源；PRIMARY KEY (run_id, seq) 就是 ACP 流的去重保证 | 读写代码已删净，历史改由 session/load 交还 | 换形状回来 | 主键从 (run_id, seq) 换成 (session_id, seq)——[recorder.rs](http://recorder.rs) 早就按会话取号了 |
| run_snapshots | 折叠后的等价投影，version 标折叠规则版本，随时可删 | 随 run_events 一起删 | 原样回来 | 打开长对话的性能全靠它；折叠规则 git 里有现成的 |
| permissions | 权限请求与结果的投影，供查询 | 同上 | 换形状回来 | 作为 PermissionRequested / PermissionResolved 帧留在日志里，不单独建表 |
| tool_calls | 工具调用的投影，供查询 | 同上 | 不用回来 | timeline-reducer 的 upsertToolCall 已在内存里做这件事，落库是第三份 |
| runs | 把帧串成轮次 | 同上 | 不用回来 | 轮次由 RunStarted / RunFinished 两帧自己界定；再建一张表就又有了两个真相 |

---

## 二、0009 的理由在单 agent 下成立，多 agent 下不是"不够好",是**假的**

它给的理由是：

> 历史从此只有一份，在 agent 那边，由 session/load 交还。
> 

单 agent 下这句是真的。两个 agent 之后它变假,不是变弱：

- B **打不开** A 的会话号——不是效果差,是 `session_for` 里那句 `if !mine` 直接拒绝发送。
- `can_load_session: false` 的 agent 一份都交不出来。
- 所以「只有一份」实际变成「零份,或者每个 agent 各自一份残缺的」——N 份分散在你不控制的进程里。

**避免第二份真相这个论证,在多 agent 下反过来指向本地日志。** 把历史留在 agent 手里才是那个漂移风险。

而最有意思的是:**这个反驳是你自己写的。** `0012_thread_owners.sql`,离 0009 只有三条迁移:

> 命令层今天靠「空主人一律算成自己的」把两者合并处理……装得下的 agent 只有一个时它总是对的;**一旦两个 agent 同时常驻,它就是把 A 开的号发给 B。**
> 

0009 假设永远只有一个 agent,0012 已经在为两个做准备。两条迁移对未来的假设不一致,你现在要处理的就是这个不一致。

---

## 三、最省的一点:落库不需要改管线

`recorder.rs` 里这两行是关键：

```rust
pub type FrameSink = Box<dyn FnMut(RecordedEvent) + Send>;
pub struct RecordedEvent { pub session_id: String, pub seq: i64, pub at: i64,
                           #[serde(flatten)] pub frame: RunFrame }
```

`RecordedEvent` **逐字段就是那一行**：会话号、序号、时刻、载荷。`serde` 已经会序列化它。而 sink 是注入的——**加持久化就是多加一个闭包,不动 `Frames`、不动 `Recorder`、不动 `driver`。**

更巧的是主键问题已经自己解决了。recorder 的注释:

> 一条会话上的序号线。位置**按会话单调,不按轮次**。
> 

你早就从 per-run 编号搬到了 per-session 编号。所以新表天然是：

```sql
CREATE TABLE session_events (
    session_id TEXT NOT NULL, seq INTEGER NOT NULL,
    at INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (session_id, seq)
) STRICT;
```

`runs` 不用回来,`FOREIGN KEY` 挂到 `thread_sessions` 就行。**比 0001 那版更干净。**

（一个命名坑：`0002_thread_sessions.sql` 这个文件名已经被占了。表名 `thread_sessions` 没被占,但新迁移别叫这个名字。）

---

## 四、必须在同一次改动里删掉的旧路径

按你自己那条「不留无期限双轨」的规矩,这三处得一起走：

1. **`session/load` 不再用于显示。** 它降级成纯水合手段——把 agent 的脑子暖起来,而不是把屏幕填起来。否则你既存自己的日志又存重放回来的帧,当场双份。`Frames::record_session_update` 那句「不落库」的注释要跟着改写理由。
2. **`0010`/`0011` 那套 `M - N + k` 对齐可以删掉。** 附件靠「从末尾数第几条用户消息」认领,`M < N` 时整批放弃——这套精巧的东西存在,唯一原因就是本地不知道对话长什么样。有了日志,附件直接挂在 `(session_id, seq)` 上。**这一刀是净减法,不是净加法。**
3. **`threads.session_id` / `agent_id` 的语义搬走。** 注意 0012 已经替你踩过迁移力学的坑：`threads` 表**重建不了**（`thread_attachments` 的外键 + `PRAGMA foreign_keys` 在事务里是空操作 + `migrations.rs` 每条迁移都包事务）。所以要么保留这两列当"当前活跃 agent"的指针（我推荐,改动最小）,要么先 `DROP TRIGGER` 两个、再 `DROP INDEX threads_session_id`、才能 `DROP COLUMN`——SQLite 拒绝删有索引的列。

---

## 五、两个规模上的提醒

- **`0006` 得一起回来。** 它当初存在的理由就是「打开对话变慢」,而 thought 帧在一轮里占压倒多数。原始帧直读长对话会卡。
- **thought 帧要存但要标记。** 它是记录的一部分（你的界面显示它）,但重放给另一个 agent 时必须丢掉——那是别人的推理过程。这就是我上次说的 `portability: portable | agent_local`,落地成 `session_events` 上一个列或者按 `kind` 判定。

---

所以回答你的问题：**是,要自己做,而且这是唯一的路**——不存在"让 B 读到 A 的会话"这种协议手段,ACP 里没有。但工程量比"做个数据库"这个说法小得多：一张表、一个 sink 闭包、一个读函数、加上删掉几处现有的补偿代码。
