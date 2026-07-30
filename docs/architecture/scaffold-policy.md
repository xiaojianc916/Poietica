# 架构脚手架策略

空脚手架不是默认错误，但必须是受治理的架构资产。

每个预留脚手架必须声明：

1. 路径；
2. 生命周期阶段；
3. 稳定职责；
4. 所有者；
5. 激活条件；
6. 删除条件；
7. 允许依赖；
8. 禁止依赖。

## 允许预留的条件

只有同时满足以下条件才允许保留：

- 对应已确认的产品方向，而非纯假想复用；
- 边界位置已确定；
- 激活不会要求反转现有依赖；
- 存在明确移除条件；
- 架构测试能够验证其依赖约束；
- 不产生运行时代码、空 service、空 manager 或虚假公共 API。

## 禁止的脚手架

以下结构即使为空也不得预留：

- 根级 utils、types、services、managers；
- 没有使用方的通用事件总线；
- 仅为潜在可替换性建立的 editor abstraction；
- 与既有状态权威并行的第二套文档或会话模型；
- 未定义 capability 的插件宿主；
- 同时依赖 features 与 platforms 的基础包；
- 没有删除条件的永久占位包。

## 生命周期

\`\`\`text
reserved
  -> domain-only
  -> partial
  -> active
  -> deprecated
  -> removed
\`\`\`

阶段变化必须更新：

- architecture.scaffolds.json；
- 对应 ADR/RFC；
- package exports；
- 架构测试；
- 激活后的契约测试。
