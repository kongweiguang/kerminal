---
name: updeng-issue-planning
description: |
  将已经确认的产品范围拆成可独立验收的 PRD 与纵向 issue 切片，并区分可自动执行和必须人工决策的工作。
  用于用户要求 PRD、issue 拆分、backlog 或可直接进入 tracker 的实现切片；当前 Codex 任务内的普通执行计划使用持久计划，不额外创建 issue 体系。
---

<!-- @author kongweiguang -->

# Updeng Issue 规划

先使用当前对话、代码、业务知识和必要的 requirement discovery 收敛问题；本工作面负责发布级拆分，不重复采访已经明确的内容，也不替代 `updeng-workflow` 的执行计划。

## 输出位置

- 有 GitHub、GitLab、Linear 等连接器时，先读取现有 issue、标签和模板，再创建或更新 tracker 条目。
- 用户只要草案时，直接在回复中输出，不为临时草案创建仓库目录。
- 需要跨 Codex task 版本化执行时，先判断是否能由一个 controller session 完整交付。可以时写入一个 durable plan；不能时建立 roadmap，并按独立启动、验收和回滚边界拆成多个 child plans，每个 plan 对应一个 controller session。
- 只有已经由当前代码实现并验证的行为才写入 `.updeng/docs/business/<module>/`；backlog、候选切片和未落地设计写入 discovery，不当作业务真相源。

## PRD 最小内容

- 问题、目标用户、期望结果和非目标。
- 当前行为、约束、关键业务规则、权限和数据影响。
- 用户故事与可观察验收，覆盖主要失败和边界路径。
- 已确认的实现决策与仍需人工决定的问题。
- 发布、迁移、可观测性和回滚要求，仅在确实适用时展开。

## Vertical Slice

每个 issue 必须交付一个可独立验证的端到端行为，而不是机械拆成数据库、后端、前端三层。更完整的正反例和 brief 模板见 [vertical-slices.md](references/vertical-slices.md)。写清：

| 字段 | 要求 |
| --- | --- |
| Outcome | 用户或调用方完成后能观察到什么 |
| Scope | 包含、不包含、重要路径或公共契约 |
| Dependencies | 真正阻塞执行的 issue 或外部输入 |
| Acceptance | 正常、失败、权限或数据边界中的必要验收 |
| Verification | 可运行命令或人工观察 |
| Execution | `AFK` 可独立实现，`HITL` 需要业务、设计、权限或生产决策 |

不要机械地把每个小 issue 都变成 plan。一个 child plan 可以包含同一用户结果下的多个纵向切片，但不能跨越不相关产品主线、不同事实源或无法共同验收的 release boundary。

使用 Codex 原生 subagents 和 worktrees 执行 plan 内互不冲突的切片；是否委派由该 plan 的 controller 在读取实时路径冲突后决定。不要在 issue 中维护 lane、worker ledger 或固定并行数量。共享 registry、schema 或同一热点文件有冲突时明确串行合并责任。

## 收口

发布前确认 issue 粒度、child plan 边界、跨 plan 依赖和 HITL/AFK 分类。最终列出已创建或更新的条目、roadmap 中 ready/waiting plans、可在 plan 内委派的切片、仍阻塞的决策以及验证门槛；不自动关闭父 issue，不覆盖人工标签或负责人。
