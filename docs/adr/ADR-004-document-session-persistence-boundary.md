# ADR-004：tldraw Document 与本机 Session 持久化边界

- 状态：Accepted
- 日期：2026-07-23
- 决策者：Poietica maintainers

## 背景

tldraw 的 `TLEditorSnapshot` 包含两个生命周期不同的部分：

- `document`：shape、page、binding、asset record 等画布文档；
- `session`：camera、selection、current tool、current page、viewport 等本机编辑状态。

现有 v1 JSON 文件将两者一起写入 `.draw`。同时，文档生命周期接口也接收完整
`TLEditorSnapshot`，使 session 状态在类型上可以进入 dirty tracking、保存 checkpoint
和文件格式边界。

虽然当前 checkpoint 实现只读取 `snapshot.document`，但这只是实现约定，不是类型约束。

## 决策

文档生命周期从本 ADR 起只接收：

```ts
TLStoreSnapshot
```

具体约束如下：

1. `EditorDocumentPort.captureDocument()` 返回 `TLStoreSnapshot`；
2. dirty tracking 只比较 document snapshot；
3. `DocumentSession` 不接收 `TLEditorSnapshot`；
4. session 变化不得产生文档 dirty 状态；
5. v2 `.draw` 只持久化 document snapshot；
6. 本机 session 必须通过独立的 local-session storage 保存；
7. local session 必须绑定 document fingerprint，避免恢复到错误文件；
8. v1 reader 可以读取旧 session，但必须将其视为一次性的本机 session seed；
9. v2 writer 不得重新写入 tldraw session state。

## v1 过渡边界

在 v2 DocumentCodec 切换前，现有 v1 writer 仍要求完整
`TLEditorSnapshot`。

因此允许在唯一的 v1 serialization boundary 临时执行：

```ts
const document = editorDocument.captureDocument()
const legacySnapshot = editor.getSnapshot()
serializeDrawDocument(legacySnapshot)
```

该兼容桥具有以下限制：

- 不能用于 dirty tracking；
- 不能进入 DocumentSession；
- 不能复制到新的 writer；
- v2 writer 落地时必须删除；
- 不得被声明为 v2 logical document contract。

## v2 logical document

v2 的逻辑文档至少包含：

```ts
interface LogicalDrawDocumentV2 {
  readonly tldraw: TLStoreSnapshot
  readonly assets: readonly DrawAssetDescriptor[]
}
```

真实二进制资源由 Native DocumentCodec 和 TLAssetStore 管理，不进入 snapshot JSON。

## 后果

正面影响：

- session 变化不再污染 dirty tracking；
- 文件内容与本机 UI 状态生命周期明确；
- v2 不需要伪造或持久化 session；
- DocumentSession 可以脱离已挂载 Editor 测试；
- 为后续 local-session storage 和 v2 DocumentCodec 建立稳定边界。

代价：

- v1 writer 暂时保留一个显式兼容桥；
- 需要后续实现 local-session storage；
- v1 reader 需要拆分 document 与 legacy session seed。

## 删除条件

完成以下条件后删除 v1 兼容桥：

- v2 DocumentCodec reader/writer 完整 roundtrip；
- TLAssetStore 已接入；
- v1 reader 可输出 canonical logical document；
- 所有新保存只走 v2 writer；
- local session 已独立持久化。
