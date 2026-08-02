# 性能测量

四层运行时，四把尺子。任何性能改动都先跑一遍这里，拿到数字再动手。

```bash
pnpm perf          # TS 派生管线（vitest bench）
pnpm perf:churn    # React 提交层：一拍要重渲多少行
pnpm perf:native   # 原生帧管线（cargo example，release）
pnpm perf:profile  # 真机 WebView：CPU / 堆分配采样（CDP，零依赖）
```

## 账本（2026-08-02）

| 层 | 实测 | 判决 |
|----|------|------|
| TS 派生（reducer + selectors） | 0.114 ms/拍 @10k 条 | ❌ 出局 |
| 字符串增长（`appendChunk`） | 31 ns/段，三档持平 | ❌ 假设证伪 |
| 行身份（React 提交） | 前缀 rebuilt=0 | ✅ 共享前缀有效 |
| 原生成帧 + 上线 | 789 ns/帧，37 KB/秒 @150 段/秒 | ❌ 出局 |

**能在 Node 与 Rust 里测的都被排除了。** 剩下的成本只可能在 WebView 里：markdown
每拍重解析、`measureElement` 的每行 `getBoundingClientRect`、合成与绘制。所以
下一步只有一条路 —— `pnpm perf:profile`。

### 派生管线明细

| 组 | N=200 | N=2000 | N=10000 | 期望 | 判决 |
|----|-------|--------|---------|------|------|
| ingest（一拍 16 段） | 1.0 µs | 4.1 µs | 16.0 µs | 持平 | ❌ O(N)，绝对值可忽略 |
| grow（每段折算） | 31.6 ns | 31.3 ns | 31.0 ns | 持平 | ✅ 线性 |
| open（冷启一次） | 0.066 ms | 0.68 ms | 4.27 ms | 线性 | ⚠️ 一次性，记账 |
| project（重投影） | 3.5 µs | 19.0 µs | 97.8 µs | 持平 | ❌ O(N)，绝对值可忽略 |

`draftOf()` 的 `items.slice()` 与选择器的非增量重投影都是真的，斜率上都没做到
承诺的事。但一拍总共 0.114 ms，占 16.7 ms 帧预算的 0.68%；涨到 10 万条也才
1.1 ms。**不值得为之动刀。**

### 原生管线明细

```
shape         506 ns/frame   (to_value + normalize + prune)
wire          283 ns/frame   (serde_json::to_string)
total         789 ns/frame
payload       248 bytes/frame   (chunk 45 B → 5.5x)
```

150 段/秒时：CPU 0.12 ms/秒（一个核的 0.012%），流量 37 KB/秒。

## 被自己的证据毙掉的两条提案，留档

防止下一轮再凭源码"看着像"就动手。

### 一、`appendChunk` 是 O(T²)，该换 rope —— 证伪

每段折算成本三档持平（31.6 / 31.3 / 31.0 ns）。若真的每段复制整条文本，8000 档
必须是 500 档的 16 倍。V8 的 `ConsString` 让 `a + b` 只建一个节点，扁平化推迟到
第一次按字符读取时才发生 —— 运行时已经在做 rope，手搓一个只会更慢。

**账没消失，只是转移了**：扁平化由第一个读这条字符串的人付，也就是每拍把
`item.text` 喂给 markdown 解析的渲染层。采 CPU 剖面时首先盯这一点。

### 二、把 Tauri 事件换成 `tauri::ipc::Channel` —— 性能理由不成立

官方文档说 Channel 是为流式数据设计的，这没错，但它解决的是高频小消息的
**事件路由开销与顺序保证**。`commands.rs` 已经做了 rAF 攒批，一帧才发一次事件，
路由开销早被摊平；37 KB/秒 的流量换通道换不出可感知的差别。

**降级为架构议题，不作为性能优化执行。**

### 还留着的一笔 🟡

信封 203 B / 载荷 45 B。CPU 和带宽上无所谓，但 `recorder.rs` 把 `RecordedEvent`
整条持久化 —— 两万段的会话就是 5 MB 落盘，其中 4 MB 是重复的 `sessionId`、
`kind` 和字段名。这是存储与冷启读盘的账，和上表 `open` 的 4.27 ms 一起算。

## 真机剖面

`pnpm perf:profile`。这是唯一还没测过的一层，也是唯一还可能藏着问题的一层。

WebView2 就是 Chromium，开着 DevTools Protocol；Node 26 自带 `fetch` 与
`WebSocket`。所以采样零依赖，也不需要往产品代码里塞任何 `performance.mark`。

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
pnpm dev
```

另开一个终端，一边采样一边让 agent 输出一段长回答：

```bash
pnpm perf:profile                # CPU，15 秒
pnpm perf:profile -- --seconds 30
pnpm perf:profile -- --heap      # 堆分配归因
```

终端直接打出按 self time 排序的前 20 名；完整剖面落在 `.perf/`，可以拖进
DevTools 的 Performance / Memory 面板看火焰图。

读的时候按这个顺序，因为前四层已经排除了：

1. **markdown 解析**（`Prose.tsx` / streamdown）的自身耗时。证伪那条预言的账单
   落在这里，头号嫌疑。
2. **Layout / Recalculate style**。超过 30% 说明测量在打架
   （`AgentActivityFeed.tsx` 的 `measureElement` 每行一次 `getBoundingClientRect`）。
3. **GC**。派生层在 N=200 档打出过 max 24 ms 的尖峰，与 N 无关，是分配率问题；
   `--heap` 能指出是谁在分配。
4. 别再去看 `applyRunEvents` 与 `selectFeedRows`。实测 0.114 ms/拍，看了没用。

### 内存判据

`--heap` 给的是分配归因，不是保留集。判断泄漏还得靠 Memory 面板的两张
Heap snapshot 对比（空对话 / 长对话之后），重点看三类保留者：

- 字符串（`AgentTextItem.text`）—— 增量是否远超实际文本量。
- `TranscriptStore` 的 `#held` / `#routes` / `#alias`（源码注释写着"这张表没有
  上限"），关掉标签页之后是否释放。
- 被 `WeakMap` 之外的东西钉住的 `TimelineItem`。

判据：**关掉一条对话之后，它的转录必须整段可回收。** 回收不了就是泄漏，与它
占多少字节无关。
