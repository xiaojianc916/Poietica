# 性能测量

五把尺子，四层运行时。任何性能改动都先跑一遍，拿到数字再动手。

```bash
pnpm perf          # TS 派生管线（vitest bench）
pnpm perf:churn    # React 提交层：一拍重建几行（断言，回归护栏）
pnpm perf:native   # 原生帧管线（cargo example，release）
pnpm perf:render   # 渲染层：自动，无需真实 agent
pnpm perf:profile  # 真实应用现场采样（需要 pnpm tauri dev）
```

## 账本（2026-08-02）

| 层 | 实测 | 判决 |
|----|------|------|
| TS 派生（reducer + selectors） | 0.114 ms/拍 @10k 条 | ❌ 出局 |
| 字符串增长（`appendChunk`） | 31 ns/段，三档持平 | ❌ 假设证伪 |
| 行身份（React 提交） | rebuilt=1，三档一致 | ✅ 只重建尾行 |
| 原生成帧 + 上线 | 789 ns/帧，37 KB/秒 @150 段/秒 | ❌ 出局 |
| **渲染层（markdown 重解析）** | `pnpm perf:render` | 🔴 唯一还站着的假设 |

### 还站着的那条

`Prose.tsx` 的 `mode={isStreaming ? 'streaming' : 'static'}`。文件自己的注释写着，
streaming 模式每次渲染要做三件事：marked 的 lexer 把**全文**切块、每块包一个 memo
实例、remend 再扫一遍**全文**补未闭合标记。

churn 探针实测尾行每拍重建一次。两条合起来：

> 每拍重渲一次 × 每次重新解析整条已生成文本 = 一条回答 **O(T²)**

这正是第一轮证伪 `ConsString` 时预言的落点：V8 把字符串复制推迟给"第一个按字符
读它的人"，那个人就是每拍一次的 lexer。

`pnpm perf:render` 就是判它的那把尺：render 一列随 chars 线性上涨则成立，持平则
再一次是我猜错。

### 派生管线明细

| 组 | N=200 | N=2000 | N=10000 | 期望 | 判决 |
|----|-------|--------|---------|------|------|
| ingest（一拍 16 段） | 1.0 µs | 4.1 µs | 16.0 µs | 持平 | ❌ O(N)，绝对值可忽略 |
| grow（每段折算） | 31.6 ns | 31.3 ns | 31.0 ns | 持平 | ✅ 线性 |
| open（冷启一次） | 0.066 ms | 0.68 ms | 4.27 ms | 线性 | ⚠️ 一次性，记账 |
| project（重投影） | 3.5 µs | 19.0 µs | 97.8 µs | 持平 | ❌ O(N)，绝对值可忽略 |

一拍总共 0.114 ms，占 16.7 ms 帧预算的 0.68%。`draftOf()` 的 `items.slice()` 与
选择器的非增量重投影都是真的，但不值得为之动刀。

### 原生管线明细

```
shape         506 ns/frame   (to_value + normalize + prune)
wire          283 ns/frame   (serde_json::to_string)
payload       248 bytes/frame   (chunk 45 B → 5.5x)
```

150 段/秒时 CPU 0.12 ms/秒、流量 37 KB/秒。

## 被自己的证据毙掉的提案，留档

### 一、`appendChunk` 是 O(T²)，该换 rope —— 证伪

每段折算成本三档持平（31.6 / 31.3 / 31.0 ns）。V8 的 `ConsString` 让 `a + b` 只建
一个节点。运行时已经在做 rope，手搓一个只会更慢。**账转移到了渲染层**，见上。

### 二、换 `tauri::ipc::Channel` —— 性能理由不成立

官方文档说 Channel 是为流式设计的，那解决的是高频小消息的事件路由开销；而
`commands.rs` 已经攒批，一帧才发一次。37 KB/秒 换通道换不出可感知的差别。
**降级为架构议题，不作为性能优化执行。**

### 三、`pnpm dev` 能连 DevTools —— 命令写错了

`dev` 只起 Vite（`turbo run dev --filter=@poietica/desktop` → `vite`），没有 WebView。
真实应用是 `pnpm tauri dev`。

## 还留着的一笔 🟡

信封 203 B / 载荷 45 B。CPU 和带宽上无所谓，但 `recorder.rs` 把 `RecordedEvent`
整条持久化 —— 两万段的会话 5 MB 落盘，其中 4 MB 是重复的字段名。这是存储与冷启
读盘的账，和上表 `open` 的 4.27 ms 一起算。

## 内存判据

`pnpm perf:profile -- --heap` 给的是分配归因，不是保留集。判泄漏要靠 Memory 面板
两张 Heap snapshot 对比（空对话 / 长对话之后），重点看 `AgentTextItem.text`、
`TranscriptStore` 的 `#held` / `#routes` / `#alias`（源码注释写着"这张表没有上限"）、
以及被 `WeakMap` 之外的东西钉住的 `TimelineItem`。

判据：**关掉一条对话之后，它的转录必须整段可回收。**
