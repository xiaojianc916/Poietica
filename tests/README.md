# Tests

所有 TypeScript / JavaScript 测试必须位于仓库根目录的 `tests/` 下，
并且仅通过各包的公开 API（package export）访问被测代码。

## 目录约定

- `unit/`：单个模块或纯领域逻辑的快速测试。
- `integration/`：跨包协作、生命周期、持久化和 IPC 契约测试。
- `architecture/`：依赖方向、边界和公共 API 约束。
- `desktop-e2e/`：桌面端端到端与发布前手工验证材料。
- `security/`：安全边界、恶意输入和权限测试。
- `release/`：发布验证材料。

## 质量规则

- 测试名称描述长期行为或契约，不描述某一次修复或 Issue。
- 每个测试必须验证可观察结果、错误边界或不变量；禁止只验证 mock 调用而忽略结果。
- fixture 必须保留测试输入，禁止用 `void input` 丢弃参数后返回固定值。
- 失败、回滚、取消和恢复路径应与正常路径同等重要。
- 新增测试前先判断现有测试文件是否已覆盖同一长期契约；优先扩展现有测试，而不是创建一次性回归文件。

## 运行

```bash
pnpm --filter @poietica/tests test
pnpm --filter @poietica/tests test:unit
pnpm --filter @poietica/tests test:integration
pnpm test:architecture
pnpm test
```
