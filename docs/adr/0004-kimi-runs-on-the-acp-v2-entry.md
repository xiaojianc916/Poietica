# 0004 — kimi 起的是 acp-v2 入口

状态：已定。取代同编号的前一版结论 —— 那一版反对切换的三条理由里，两条已被
证据推翻（v2 自带 builtin-commands.ts 与 slash.ts；fs 反向 RPC legacy 也有）。

## 上游有两套并存的 ACP 实现

事实来源：MoonshotAI/kimi-code @ c396873。

| 子命令 | 后端包 | 上游自己的说法 |
| --- | --- | --- |
| kimi acp | @moonshot-ai/acp-adapter | acp-v2.ts 逐字：the legacy acp-adapter over the SDK harness |
| kimi acp-v2 | @moonshot-ai/acp-server + agent-core-v2 | experimental agent-core-v2 engine，惰性 import 隔离 |

## 切换的唯一必要理由：子代理的审批在 legacy 里到不了客户端

- legacy：acp-adapter/src/session.ts 的 onEvent 首行按 MAIN_AGENT_ID 过滤，
  子代理的审批请求随事件流一起被丢弃。引擎侧的 AgentPermissionGate 于是停在
  那里等一个永不到来的回答 —— 这就是「一调用子代理就卡死」。
- v2：acp-server/src/interaction-bridge.ts 不看事件流。它订阅
  interactions.changed（每次变更推送整份 pending 集合），逐条并发派发，用
  inFlight 集合防重入。interactions 是 Session 作用域，全文没有 agentId 一词。

过滤发生在上游包内部，客户端侧无论怎么改都碰不到。这一条在 legacy 上无解。

## 契约不变，所以我们侧零改动

- 审批 optionId：approve_once / approve_always / reject / plan_approve /
  plan_revise / plan_reject_and_exit / plan_opt_<i>，并继续接受 legacy 的
  approve 与 approve_for_session。与 acp-adapter 逐字相同。
- 提问 optionId：q<n>_opt_<i> 与 q<n>_skip。我们的 QUESTION_DIALECT 是超集。
- 选项名七个全在 OPTION_LABELS 里：Approve once、Approve for this session、
  Reject、Approve、Revise、Reject and Exit、Skip。
- server.ts 的 initialize 同时声明 sessionCapabilities.close 与 .delete，
  driver.rs 读的 .delete 仍然成立 —— Rust 侧一行不动。
- 提问卡的 content 是 q.question 本身，不再是入参 JSON。

## fs 能力：声明，并且实现

不声明它等于让 v2 引擎跑在一个 v1 能力的客户端上。上游是逐条按能力分流的：
acp-server/src/acp-fs/acpFsService.ts 的 readText 首行逐字
if (!this.connection.fsReadTextFile) return this.inner.readText(path, options)，
acpConnection.ts 的 bindFsCapabilities 判据逐字 fs?.readTextFile === true。
能力缺席时，agent 的文件读写退回它自己进程里的本地盘 —— 换了子命令、换了引擎,
v2 多出来的这一块整块白装。

实现在 crates/agent-runtime/src/fs_host.rs，边界与实现同处一处：

- 只认这条会话工作目录之下的绝对路径，边界值就是交给 session/new 的那个 cwd,
  不是第二份配置。
- .. 按词法消掉之后再比对。不能先 canonicalize 再比：一个还不存在的文件没有
  canonical 形式，而写入路径上必然遇到的就是还不存在的文件。
- 文件缺席回协议的 -32002。上游 acpFsService.ts 的 isResourceNotFound 逐字判
  error.code === -32002，它的 appendText 靠这一条把缺席当成空文件；回别的码,
  追加写会整个失败。
- 读盘写盘都在 connection.spawn 里，处理器立刻返回 —— 与授权请求同一个理由
  （见同目录 0001）：派发是原子的，占着它就是整个界面卡死。

## 顺带白拿的

- tool_call 带 locations（toolCallLocations，只发绝对路径，缺则省略不编造）。
- 懒建卡在 tool.call.started 到达时补齐 rawInput（legacy 永远补不上，意图轴
  因此在部分卡上必然落空）。
- todo_list 投影成 plan；usage_update；session_info_update（会话标题）；
  config_option_update 与 current_mode_update 并存。
- session/fork（上游标 UNSTABLE）、session/list 的 cwd 过滤、logout。

## 明确不做

- 仍然不声明 clientCapabilities.terminal。声明即承诺由我们起进程、持有、
  响应 kill 与 release；未实现之前声明比不声明糟。能力关闭时 acp-server 走
  execLocal，其 docstring 逐字：behavior with the capability off is
  therefore identical to today s。
- 不声明 elicitation.form。声明后提问改走 elicitation/create（原生多问、多选），
  而我们的提问卡目前只画单问单选。

## 未定案，留给下一刀

- acp-server/src/session.ts（47 KB）未读：子代理的工具事件本身是否出网，以及
  斜杠命令面板由谁拼（acp-v2.ts 不传 slashCommands，但 acp-server 自带
  builtin-commands.ts 与 slash.ts，分别是 legacy 的 5.6 倍与 1.6 倍）。
- 入参回显不是 legacy 的毛病：两套 events-map.ts 的 toolCallStartToSessionUpdate
  逐字相同，都把 stringifyArgs(event.args) 当 content 发。acp-projection.ts 的
  withoutArgumentEcho 因此是长期资产，不是兼容层。

## 后果

首次连接要求本机的 kimi 带 acp-v2 子命令。这是安装版本的下限，不是代码问题。
