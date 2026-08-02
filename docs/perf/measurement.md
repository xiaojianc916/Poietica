# 性能测量

三层运行时，三把尺子。任何性能改动都先跑一遍这里，拿到数字再动手。

```bash
pnpm perf          # TS 派生管线（vitest bench）
pnpm perf:native   # 原生帧管线（cargo example，release）
```

第三层——WebView 的渲染与内存——没有脚本，因为脚本量不准。它的规程在下面。

## 1. TS 派生管线

`packages/agent-timeline/src/__bench__/timeline.bench.ts`。

每组跑三档规模。**读的是斜率，不是绝对值**：

| 组 | 期望 | 不符合时的靶子 |
|----|------|----------------|
| `ingest` | 三档持平 | `timeline-reducer.ts` `draftOf()` 的 `items.slice()` |
| `grow` | 与段数成正比 | `appendChunk()` 的 `text: tail.text + chunk` |
| `open` | 与条目数成正比 | `replayThreadEvents` 的预扫描或 `positionOf` 建索引 |
| `project` | 三档持平 | `timeline-selectors.ts` 的共享前缀失效 |

`ingest` 若随规模线性上涨，一次回答的总代价就是 O(N²)：那不是"慢一点"，
那是长对话必然卡死。

## 2. 原生帧管线

`crates/agent-runtime/examples/frame_throughput.rs`。必须 `--release`。

三个数字要一起看：

- **shape** — 成帧本身。`frame.rs` 的 `to_value` 建一棵树，`prune` 再整树递归一遍。
- **wire** — 上线的序列化。Tauri 的事件通道传的是 JSON 字符串。
- **amplification** — 一段文本在线上被放大了多少倍。

放大倍数是 IPC 通道选型的决定性数据。Tauri 官方对高频流式数据的推荐是
`tauri::ipc::Channel` 而不是事件广播；倍数越高，换通道的收益越大。

## 3. WebView 渲染与内存

WebView2 就是 Chromium，所以用 Chromium 的官方工具，不要自造计时器。

### 帧时间

1. `pnpm dev` 起开发版，右键 → 检查，打开 DevTools。
2. Performance 面板 → 录制 → 让 agent 输出一段长回答 → 停止。
3. 看三件事：
   - **Long tasks**（> 50ms 的黄条）出现在哪个调用栈。
   - **Layout / Recalculate style** 的总占比。超过 30% 说明测量在打架
     （`AgentActivityFeed.tsx` 的 `measureElement` 每行一次 `getBoundingClientRect`）。
   - **Scripting** 里 `applyRunEvents` 与 `selectFeedRows` 的自身耗时，
     与上面第 1 层的 bench 数字对得上吗。对不上，说明真正的成本在渲染而不在派生。

### 内存

1. Memory 面板 → Heap snapshot，在**空对话**上取一张。
2. 跑完一段长对话，再取一张。
3. Comparison 视图看 Delta。重点看三类保留者：
   - 字符串（`AgentTextItem.text`）——增量是否远超实际文本量。
   - `TranscriptStore` 的 `#held` / `#routes` / `#alias`（源码注释明确写着
     "这张表没有上限"），关掉标签页之后是否释放。
   - 被 `WeakMap` 之外的东西钉住的 `TimelineItem`。
4. 判据：**关掉一条对话之后，它的转录必须整段可回收**。回收不了就是泄漏，
   与它占多少字节无关。
