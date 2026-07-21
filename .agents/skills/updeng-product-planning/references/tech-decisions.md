---
name: updeng-tech-decision
description: |
  在当前 plan 与 discovery 中比较影响架构、依赖、数据、安全、部署或公共契约的长期技术取舍，并把实际采用结果写回实现文档。
  用于非常规技术选择存在有意义的替代方案、长期后果、验证和回滚需求的场景；不要建立全局 ADR 注册表，也不要为普通局部实现选择制造决策文档。
---

<!-- @author kongweiguang -->

# Updeng 技术决策

Updeng 不再维护独立 decisions.json 或 ADR CLI。技术决定跟着它服务的业务模块和执行计划存在，避免另一套状态生命周期。

以下情况才值得形成长期决策：改变公共 API/数据/权限/部署/更新机制，引入或替换高影响依赖，改变模块边界，或在安全、性能、成本、可维护性之间存在真实取舍。单个小 bug、已有规范直接规定的选择和可随时替换的局部细节不建决策记录。

## 决策位置

- 尚未实现：写入 .updeng/docs/discovery/<module>/，保存背景、约束、候选、取舍和参考资料。
- 正在执行：plan.md 引用选定方向；operations.jsonl 追加 kind=decision 的结构化摘要，记录何时、由谁、为何改变执行。
- 已经实现并验证：把影响当前业务行为的结论提炼到 .updeng/docs/business/<module>/；已实现外部契约写入 integrations。不要把历史讨论伪装成当前行为。

## 质量要求

1. 写清当前事实、约束和决策驱动因素。
2. 至少比较一个可信替代方案；没有真实替代的局部选择通常不需要记录。
3. 说明选择为什么适用于当前代码，而不只写产品或模式名称。
4. 列出收益、代价、兼容影响和必须同步的 shared contracts。
5. 给出可观察验证、失败信号和当前版本可执行的 rollback/replacement。
6. 由主 controller 决定跨任务取舍；native subagent 只提供证据，不自行扩大公共契约。

需要完整比较、证据表、替代关系和可复用模板时读取 [decision-record.md](references/decision-record.md)。

发生替代时更新 discovery 中的决策记录，并在当前 plan operations 追加新 decision 事件。不要抹掉旧理由，也不要为状态转换增加专用 CLI。
