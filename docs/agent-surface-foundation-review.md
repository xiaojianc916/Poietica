# 助手界面：地基审查

审查姿势不是"这段怎么写得更短"，而是先问"专业软件在这个场景下怎么做"。
每条结论落到源码行。四条缺陷按根因排序。

## 硬性原则

1. 讲证据，不靠经验主义：每个结论落到具体源码行 + 具体事实。
2. 视野要广：横向对比官方能力 / 成熟依赖 / 业界标准做法，明确指出差距在哪。
3. 默认怀疑"这玩意儿一开始就不该这么写"。地基错了就换范式，不在烂地基上装修。

## 缺陷 1：流式通道没有地址位（根因）

- `agent/protocol/src/run-contract.ts`：`RunEvent` 六个变体全是 `{ kind, seq, at, ... }`,
  没有 `threadId`,没有 `runId` —— 尽管同一文件就定义了 `ThreadId` 与 `RunId`。
- `agent/protocol/src/agent-session-port.ts`：
  `subscribe: (listener: (event: RunEvent) => void) => () => void`，订阅端不接收
  threadId,端口层面不存在"按对话订阅"这件事。
- `platforms/desktop-ipc/src/agent.ts`：信封是 `{ runId, seq, kind, frame }`,注释写着
  "the run identifier rides outside it because it is routing, not content",
  然后 `handler(event.payload.frame)` 把路由丢掉。
- `agent/runtime/src/useAssistantSession.ts`：
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

`agent/runtime/src/useAssistantSession.ts`：`timeline` 是 `useState`（每个界面各存一份）;
模块级 `restored` Map + `RESTORED_LIMIT = 8` 是手搓 LRU;`WINDOW_RUNS / WINDOW_STEP`
是手搓分页游标;`claimed / shown / reading` 是手搓竞态守卫;渲染期
`if (shown !== endpoint) { setTimeline(opening(endpoint)) }` 是在渲染函数里改状态。

行业对照：转录是后端状态（真源是原生侧的加密事件日志）,应当放在框架之外、按
threadId 归一化的存储里,视图只做投影 —— TanStack Query / Zustand / Redux Toolkit /
`useSyncExternalStore`。本仓库自己就有样板：`agent/ui/src/time.ts` 正是
`useSyncExternalStore` + 外部 store。

后果：状态的生存期绑在组件挂载上,而排版又派生自这个状态,于是重挂载或 endpoint
重新分配会抹掉/复活转录,并把排版一起拖着跑。

## 缺陷 3：排版由内容反推,且判据可回退

`agent/ui/src/AssistantSurface.tsx`：`started = visibleRows.length > 0` → `settled`
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
`linear()` 导入弹簧曲线。`features/workspace` 已在用 motion 做布局动画,能力就在依赖里。

现状：已改为 WAAPI,时长跟位移走,新的一次从当前渲染高度接管。

## 推倒重做的范围

跨 `agent/protocol`、`platforms/desktop-ipc`（含 Rust 广播载荷）、`agent/runtime`、
`agent/ui`：帧带地址 → 端口按对话订阅 → 转录搬进外部归一化存储 → 入口态与会话态
分成两个视图。

## 缺陷 5：身份由交互副作用产生

- `apps/desktop/src/presentation/workspace/ConversationSurface.tsx`：
  `engage()` 在 `threadId === null` 时 `void onIdentify?.()` —— 认领一条真的对话。
- `agent/ui/src/AssistantSurface.tsx`：该回调接在
  `onFocusCapture={onEngage}` 与 `onPointerEnter={onEngage}` 上。
- `agent/runtime/src/useAssistantSession.ts`：endpoint 一变，渲染期即
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

搬走之前，`agent/runtime/src/useAssistantSession.ts` 一个 Hook 里同时是：

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
本仓库自己的正确范例：`agent/ui/src/time.ts`。

现状：`agent/runtime/src/transcript-store.ts` 是全进程唯一的帧订阅者和唯一的
run 发起者，因此也是唯一有资格路由帧的人。组件不再接收帧 —— "帧落进别人的
转录"在新结构里没有语法可以表达。

## 缺陷 1 仍欠：线路上的地址

`platforms/desktop-ipc/src/agent.ts`：

    module.listen<AgentEventEnvelope>(AGENT_EVENT, (event) => { handler(event.payload.frame) })

信封里有 `runId`（同文件注释：the run identifier rides outside it because it is
routing, not content），在这一行被丢弃。所以 store 的归属依据是"当前在飞的那一
轮"，而不是真地址。同一条 ACP 连接上最多一轮在飞（见 agent_threads 的注释），
所以今天它是精确的；但它依赖那个前提。

下一刀（纯 TS，不动 Rust、不动 zod schema）：`AgentEventSource.listen` 交出
`{ runId, frame }`，store 按 runId → threadId 查表路由。
