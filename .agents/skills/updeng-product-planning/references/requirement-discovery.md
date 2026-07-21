---
name: updeng-requirement-discovery
description: |
  为仍然模糊的产品问题做仓库事实核对、外部发现、候选方案比较和高影响澄清，收敛目标、非目标与可观察成功标准。
  用于用户要求需求发现、竞品/基准调研、头脑风暴，或未解决的产品选择会实质改变实现的场景；需求已经清楚到可直接实现时不要重复采访，并把未落地结论留在 discovery。
---

<!-- @author kongweiguang -->

# Updeng 需求发现

优先使用 Codex Plan mode 读取上下文和澄清。本 skill 只补充可复用的发现纪律，不创建一套实现状态机。

## 流程

1. 先读 `AGENTS.md`、相关代码、测试、对应模块的 business/discovery 文档和已实现集成契约。有 `.codegraph/` 时先用 CodeGraph 定位概念与调用路径。
2. 区分仓库可确认事实、需要外部一手资料的事实和只能由用户决定的业务取舍。不要把可搜索问题推回用户。
3. 外部发现优先官方资料、成熟产品和活跃源码；记录链接、日期、支持/限制和与当前约束的差异，不按热度代替适用性判断。需要展开时读 [external-discovery.md](references/external-discovery.md)。
4. 一次只问一个会改变方案的高影响问题，并给出推荐答案、理由和不同选择的后果。连续问题不再改变方案时停止采访；问题维度见 [question-bank.md](references/question-bank.md)。
5. 给出 2 到 4 个可信方向，比较用户结果、实现/数据/权限影响、风险、验证成本和退出条件。
6. 收敛为目标、非目标、成功信号、选定方向、拒绝原因、开放问题和下一步。

需要跨 task 保留的发现材料写入 `.updeng/docs/discovery/<module>/`，可包含设计、候选、原型结论和参考资料。durable plan 只链接并采用这些材料。只有当前代码已经实现并验证的业务行为才提炼到 `.updeng/docs/business/<module>/`；不要把发现结论提前写成现状。

## 下一步选择

- 产品范围已明确并需要 tracker 切片：继续使用 `updeng-product-planning` 的 issue planning reference。
- 术语或业务边界仍不稳定：继续使用 `updeng-product-planning` 的 domain context reference。
- 需要低成本验证方向：在当前 task 做限定 spike，并写清吸收/删除条件；跨 task 时纳入 durable plan。
- 形成长期架构、依赖、数据或安全取舍：继续使用 `updeng-product-planning` 的 tech decision reference。
- 范围和验收已清楚：回到 Codex 原生 Plan/Goal 实施；只有高风险操作才使用 development governance。

## 停止条件

- 用户要求直接实现，且范围、风险和验收已经清楚。
- 仓库与外部证据已足够区分候选方案。
- 缺少不可推断的业务决定；此时明确 blocker、负责人和恢复条件，不继续猜测。
