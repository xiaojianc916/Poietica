# 助手界面：地基审查

审查姿势不是"这段怎么写得更短"，而是先问"专业软件在这个场景下怎么做"。
每条结论落到源码行。四条缺陷按根因排序。

## 硬性原则

1. 讲证据，不靠经验主义：每个结论落到具体源码行 + 具体事实。
2. 视野要广：横向对比官方能力 / 成熟依赖 / 业界标准做法，明确指出差距在哪。
3. 默认怀疑"这玩意儿一开始就不该这么写"。地基错了就换范式，不在烂地基上装修。

## 缺陷 1：流式通道没有地址位（根因）

- `packages/agent-contract/src/run-contract.ts`：`RunEvent` 六个变体全是 `{ kind, seq, at, ... }`,
  没有 `threadId`,没有 `runId` —— 尽管同一文件就定义了 `ThreadId` 与 `RunId`。
- `packages/agent-contract/src/agent-session-port.ts`：
  `subscribe: (listener: (event: RunEvent) => void) => () => void`，订阅端不接收
  threadId,端口层面不存在"按对话订阅"这件事。
- `packages/ipc/src/agent.ts`：信封是 `{ runId, seq, kind, frame }`,注释写着
  "the run identifier rides outside it because it is routing, not content",
  然后 `handler(event.payload.frame)` 把路由丢掉。
- `packages/agent-session/src/use-assistant-session.ts`：
  `session.subscribe((event) => setTimeline(c => applyRunEvent(c, event)))`,无过滤。
  结果是 N 个挂载的界面 × 所有帧。

行业对照：ACP 自己的 `session/update` 就带 sessionId（`acp_update` 原样内嵌它）,
JSON-RPC 有 id,LSP 有 request id,gRPC 有 stream。多路复用的流必须带地址。
这里自建了一条比它所封装的协议更弱的通道。

连带后果：`seq` 是每 run 单调,而 `applyRunEvent` 按 seq 去重排序 —— 同一条通道上
两个 run,seq 必然相撞,帧会互相覆盖。这是数据结构级的错误,不是偶发抖动。

修法：帧上带 `threadId` + `runId`（Rust 广播载荷与 `acp-event-schema.ts` 的 zod 同步）,
端口改成 `subscribe(threadId, listener)`。

## 缺陷 2：会话状态放在组件本地 state,并手搓了缓存与渲染期修复

`packages/agent-session/src/use-assistant-session.ts`：`timeline` 是 `useState`（每个界面各存一份）;
模块级 `restored` Map + `RESTORED_LIMIT = 8` 是手搓 LRU;`WINDOW_RUNS / WINDOW_STEP`
是手搓分页游标;`claimed / shown / reading` 是手搓竞态守卫;渲染期
`if (shown !== endpoint) { setTimeline(opening(endpoint)) }` 是在渲染函数里改状态。

行业对照：转录是后端状态（真源是原生侧的加密事件日志）,应当放在框架之外、按
threadId 归一化的存储里,视图只做投影 —— TanStack Query / Zustand / Redux Toolkit /
`useSyncExternalStore`。本仓库自己就有样板：`packages/agent-ui/src/time.ts` 正是
`useSyncExternalStore` + 外部 store。

后果：状态的生存期绑在组件挂载上,而排版又派生自这个状态,于是重挂载或 endpoint
重新分配会抹掉/复活转录,并把排版一起拖着跑。

## 缺陷 3：排版由内容反推,且判据可回退

`packages/agent-ui/src/AssistantSurface.tsx`：`started = visibleRows.length > 0` → `settled`
→ `data-started` → `assistant.css` 的 flex-grow 补间与 `grid-template-rows: 1fr → 0fr`。
"输入框在中间还是在底部"是导航状态,却派生自内容状态,而且可以来回翻。

行业对照：入口态与会话态是两个视图 / 两条路由（ChatGPT 的 `/` 与 `/c/:id`;
VS Code 的 chat welcome 与 chat session）,切换是导航;退一步至少是显式且单调的状态机
`entry → engaged`,由"用户提交过一次"或"打开的是既存对话"驱动,与转录有几行无关。

现状：已改为单调闩锁（不可回退）,最小忠实修正,不是终局。

## 缺陷 4：输入框增高用固定时长的 CSS tween

固定时长对内容驱动的位移天生不自然（粘两行与粘两百行同走 240ms）,且被打断时不保速度。
`field-sizing: content` 与"要补间"自相矛盾：计算 block-size 恒为 auto,过渡永不启动。

行业对照：位移相关时长或弹簧;Web 上用 WAAPI（Framer Motion 内部即是）或 CSS
`linear()` 导入弹簧曲线。`packages/workspace` 已在用 motion 做布局动画,能力就在依赖里。

现状：已改为 WAAPI,时长跟位移走,新的一次从当前渲染高度接管。

## 推倒重做的范围

跨 `packages/agent-contract`、`packages/ipc`（含 Rust 广播载荷）、`packages/agent-session`、
`packages/agent-ui`：帧带地址 → 端口按对话订阅 → 转录搬进外部归一化存储 → 入口态与会话态
分成两个视图。

## 缺陷 5：身份由交互副作用产生

- `apps/desktop/src/presentation/workspace/ConversationSurface.tsx`：
  `engage()` 在 `threadId === null` 时 `void onIdentify?.()` —— 认领一条真的对话。
- `packages/agent-ui/src/AssistantSurface.tsx`：该回调接在
  `onFocusCapture={onEngage}` 与 `onPointerEnter={onEngage}` 上。
- `packages/agent-session/src/use-assistant-session.ts`：endpoint 一变，渲染期即
  `setTimeline(opening(endpoint))` 并 `setIsRestoring(true)`。

链条：鼠标碰一下输入框 → 认领对话 → endpoint 变化 → 转录被覆盖、isRestoring 置真
→ data-started 翻真 → 输入框落底 → 认领落定或失败、转录清空 → 弹回。
"一点击就落底"、"粘贴就落底"、"放十几秒抖一下"、"疯狂新建对话"是同一条链。

行业对照：预取只许影响缓存，不许影响 UI 状态（Next.js link prefetch、GitHub
hovercard）。而且预热多余：身份在发言时本来就会取到（send 里 identify() → prompt）。

现状：入口那一格的预热已删除；已有对话的 adopt 保留（不改身份，动不了排版）。

## 缺陷 3（续）：排版判据已换成显式单向相位机

`settled = started || isRestoring` 已删除。现在是 `phase: 'entry' | 'live'`，两个
不可逆来源：挂载时就带 endpoint，或用户在这一格发出过一句话。转录与加载状态一概
退出排版判据 —— 这也把缺陷 1（帧上没有地址）对排版的影响隔离掉了：帧再怎么串，
也搬不动构成。

## 缺陷 2 已修：转录搬出组件，帧有了唯一的归属方

搬走之前，`packages/agent-session/src/use-assistant-session.ts` 一个 Hook 里同时是：

| 源码 | 它其实是什么 |
|---|---|
| `useState<TimelineState>(() => opening(endpoint))` | 后端状态的组件级副本，每个挂载的界面一份 |
| `const restored = new Map()` + `RESTORED_LIMIT = 8` | 手搓 LRU |
| `WINDOW_RUNS` / `WINDOW_STEP` / `setWidth` | 手搓分页游标 |
| `const reading = useRef(0)` | 手搓竞态守卫 |
| `const claimed = useRef<string | null>(null)` | 手搓乐观 id 对账 |
| `if (shown !== endpoint) { setTimeline(...) }` | 渲染期改 state：手搓「派生自 prop 的状态」 |
| `session.subscribe((event) => setTimeline(...))` | 每个界面各订阅一次全量帧流 |

行业标准：转录是后端状态，归组件外的规范化 store；React 官方原语是
`useSyncExternalStore`，成熟依赖是 TanStack Query / Zustand / Redux。
本仓库自己的正确范例：`packages/agent-ui/src/time.ts`。

现状：`packages/agent-session/src/transcript-store.ts` 是全进程唯一的帧订阅者和唯一的
run 发起者，因此也是唯一有资格路由帧的人。组件不再接收帧 —— "帧落进别人的
转录"在新结构里没有语法可以表达。

## 缺陷 1 仍欠：线路上的地址

`packages/ipc/src/agent.ts`：

    module.listen<AgentEventEnvelope>(AGENT_EVENT, (event) => { handler(event.payload.frame) })

信封里有 `runId`（同文件注释：the run identifier rides outside it because it is
routing, not content），在这一行被丢弃。所以 store 的归属依据是"当前在飞的那一
轮"，而不是真地址。同一条 ACP 连接上最多一轮在飞（见 agent_threads 的注释），
所以今天它是精确的；但它依赖那个前提。

下一刀（纯 TS，不动 Rust、不动 zod schema）：`AgentEventSource.listen` 交出
`{ runId, frame }`，store 按 runId → threadId 查表路由。

## 缺陷 6 已修：可选项被绑在会话生命周期上

- `apps/desktop/src/presentation/workspace/ConversationSurface.tsx`：
  `const controls = threadId === null ? NO_CONTROLS : ...` —— 入口那一格恒为空。
- `packages/agent-session/src/threads-store.ts`：`selectorsOf(threadId)`，表按 threadId 存；
  唯一到达口是 `port.open(threadId)`（`#read` / `create`）。
- `packages/agent-contract/src/session-config-contract.ts` 文件头：
  "What the running session lets us change."

后果：新建会话界面没有模型选择器；每条对话各问一遍同一张表；并且有人为绕开它，
把 `onIdentify` 挂到 `onPointerEnter` 上偷偷开一条真对话 —— 那个补丁就是输入框
乱跳的源头。一个地基错误，两张脸。

行业对照：ChatGPT / Claude / Cursor / VS Code Copilot Chat 的新会话界面选择器一直
在，画的是偏好，新会话继承它；ACP 把能力放在 initialize 阶段，只有当前选中值是
per-session。

现状：能力表升到进程级（`agent-capability-store.ts`），偏好独立持久，入口那一格
画偏好，`ThreadsStore.create` 在会话开出来时把偏好补下去。

仍欠：线路上没有 initialize 阶段的能力上报（Rust 侧），所以全新安装、一条对话都
没开过时这张表是空的；localStorage 缓存是权宜，正确的家是一个 preferences 端口。

## 缺陷 1 已修：帧在线路上有了地址

- `packages/ipc/src/agent.ts`：`handler(event.payload.frame)` —— 信封里的
  `runId` 被一句 "the envelope is not the contract" 说服自己扔掉了。
- `packages/agent-contract/src/run-contract.ts`：六个帧变体全是 `{ kind, seq, at, ... }`，
  帧本身没有地址。
- 因此 `AgentSessionPort.subscribe` 交出的是一封没有收件人的信，接收方只能猜
  "大概是当前那一轮"；而 `seq` 按 run 计数，两轮都有 seq 3，按 seq 去重分不开。

行业对照：JSON-RPC 的 `id`、LSP 的 request id、gRPC 的 stream id、ACP 的
`session/update`（带 `sessionId`）—— 多路复用的第一条规矩是每条消息自带地址，
接收方从不靠"我记得我刚发了什么"配对。

现状：`listen(frame, runId)` → `subscribe(event, runId)` → `transcript-store` 按
`runId` 查表；那个记着"当前那一轮"的模块级可变量删除；广播早于 prompt 返回的
竞态由 `orphans` 正面接住，不再靠代码顺序掩盖；拒收帧同样带地址，所以解析失败
落在它本来那一轮上。

不需要 Rust 改动：地址早就到渲染进程了。

## 还欠着

- 缺陷 3：入口态与会话态仍是同一个视图在两种姿势之间插值，应当是两个视图。
- 缺陷 4：输入框增高的 WAAPI 补间至今没有成功落过一次。
- 能力表仍没有 initialize 阶段的上报（Rust 侧），全新安装时入口那一格仍为空。

## 缺陷 4 已修：长高的时长为一段不存在的路计费

- `packages/agent-ui/src/assistant.css`：`max-block-size: var(--cp-editor-max)`（八行）。
- `packages/agent-ui/src/composer/prompt-input.tsx`：`settle` 把替身量出的完整文本高度直接
  当终点，`duration = min(400, max(130, delta * 1.7))` 按这个未经钳制的位移算。
- 于是粘进一大段时元素在八行处到底，动画还在为剩下的两千多像素走时间：观感是
  动一小段、然后原地不动 —— 这才是"不自然"的成因，不是曲线选得不好。

现状：终点先经 `clampToStyle` 用计算样式钳到样式表的上下限之间，位移与时长都按
钳制后的值算；到顶之后继续输入是零位移，因此零动画。

顺带清掉三处不接线的声明：`field-sizing: content`（行内像素值恒胜出）、它的
`@supports` 分支、以及一条给这个元素关闭 `transition` 的减弱动态规则（这个元素
早已没有 transition，减弱动态由 `settle` 里的 `matchMedia` 处理）。`--cp-motion-grow`
在确认全仓无消费者后退场 —— 内容驱动的位移不该有固定时长令牌。

## 还欠着

- 缺陷 3：入口态与会话态仍是同一棵树在两种姿势之间插值，应当是两个视图。
- 能力表仍没有 initialize 阶段的上报（Rust 侧）。

## 缺陷 3 已修：位置不再是一个可以被补间的数字

- `packages/agent-ui/src/feed/agent-activity-feed.css`：`::before / ::after { flex: 1 1 0;
  transition: flex-grow ... }`，配 `[data-started="true"] { flex-grow: 0 }`，
  以及 `__viewport` 的 `flex: 0 1 auto` → `flex-grow: 1`。
- `packages/agent-ui/src/assistant.css`：`__intro / __starters` 的 `grid-template-rows`
  从 `1fr` 补间到 `0fr`。
- 于是"输入框在中间还是在底部"是一串可插值的数字，由一个 DOM 属性驱动。上一刀
  （显式相位）拿掉了触发源，但没有拿掉表达能力：中间态仍然是一个可以进入的状态，
  所以任何让那个属性抖一下的原因都会让整块构成走一遍位移。

行业对照：ChatGPT / Claude / Gemini 的新会话是另一个视图（`/new` → `/c/:id`），
落底是一次导航；Zed 的 agent panel、VS Code Copilot Chat 的空态是独立组件。没有
一家把这件事做成一个可补间的数字。

现状：会话态挂一个占满剩余空间的滚动区，入口态挂上下两块各占一半自由空间的兄弟。
挂载与卸载不可补间，中间态因此无法被表达。`AgentActivityFeed` 交出 `header` 与
`dock` 两个插槽，只画滚动区与浮层；输入框是 `.assistant-surface` 的孩子，两个相位
共用同一个 DOM 节点，草稿与焦点跨相位存活。两条"这几帧不要动画"的抑制规则一并
删除 —— 需要被抑制的动画已经不存在。

居中的几何逐字照搬，版式零像素差。

已知的一处可见变化：`data-scrollbar-track` 仍在 feed 根上，而输入框不再是它的
后代，所以轨道从覆盖整块面板变成覆盖转录区。要恢复贯穿全高，需把该属性上移到
`.assistant-surface`，前提是先确认消费它的实现怎么找滚动元素。

## 还欠着

- 能力表仍没有 initialize 阶段的上报（Rust 侧）。
- minimap 两处复杂度与 `agent-config-store.ts` 的 `useAwait`。

## 缺陷 6 余款已修（原生侧）：能力表的所有者不再是会话

- `apps/desktop/src-tauri/src/commands/agent.rs`：选择器表此前只有两个出口，
  `agent_new_session` 的 `AgentOpenedSession.selectors` 与 `agent_open_thread` 里的
  `live.client.selectors(held.session_id)`。两者都要先有一个会话，而会话的归属由
  `session_for` 按 thread UUID 决定；`agent_set_config_option` 更是直接
  `ok_or(NO_CONVERSATION)`。
- `packages/agent-contract/src/session-config-port.ts` 的注释写明了这件事："这里没有'读'。
  选择器随会话一起交回来。"
- 于是入口界面（没有对话、没有会话）在结构上拿不到模型清单，渲染层只能靠
  localStorage 里上一次学到的表 —— 那是替一条不存在的取数路径打掩护，不是修复。

行业对照：ACP 的 initialize 阶段就是交换能力的地方，模型清单是 agent 级的，会话
只是选了一个当前值。Zed 的 agent panel、Copilot Chat、Cursor 都能在没有任何会话
时画出模型选择器。

现状：`connect()` 交回的那个没有对话持有的会话号被命名为**锚会话**，存进
`Session.anchor` 并随 `Handle` 交出；新命令 `agent_capabilities` 不点名任何对话，
直接问锚会话要整张表，不新开会话、不写库、不碰 thread。

## 下一刀（TS 半刀，必须排在绑定导出之后）

`packages/ipc/src/generated/ipc-bindings.ts` 是 specta 生成物，
`commands.agentCapabilities` 在导出跑过之前不存在，所以这半刀编译不过：

1. `packages/ipc/src/agent.ts`：在会话配置桥上加 `capabilities()`。
2. 入口界面装载时学一次，把 `learnAgentControls` 从"会话开出来才学"改成"连上就学"。
3. `packages/agent-session/src/agent-capability-store.ts` 的 localStorage 从唯一来源降级为
   离线兜底，并搬进真正的 preferences 端口。

## 还欠着

- minimap 两处复杂度与 `agent-config-store.ts` 的 `useAwait`。
