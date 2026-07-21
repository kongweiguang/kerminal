---
name: updeng-durable-plan
description: |
  为跨步骤、跨 session、native subagent 或 worktree 执行的功能维护 plan.md、tasks.json、operations.jsonl 与结构化索引，让计划叙事和执行状态分离。
  用于需要持久本地计划、任务所有权、原生 subagent 委派、worktree 集成、暂停/恢复或结构化验证历史的工作；可在一轮安全完成的有界 direct 任务不要创建计划。
---

<!-- @author kongweiguang -->

# Updeng 持久计划

Codex Plan/Goal 只负责当前 task 的运行时思考。Updeng plan 是本地、跨 session 的执行材料，不提交远程，也不靠 Markdown checkbox 管状态。

## 文件布局

UserPromptSubmit 的 plan 路由会从 .updeng/templates/plan/ 自动创建或复用并绑定 session：

    .updeng/plans/active/<plan-id>/
      plan.md
      tasks.json
      operations.jsonl

并在 .updeng/plans/index.json 增加唯一记录。大型交付先建立 roadmap，再按可独立启动、验收、回滚的边界拆成多个 child plan；一个 child plan 只绑定一个 Codex controller session。不要另建重复 plan；先打开 Hook 返回的 plan。存在多个 unfinished plan 时，启动 task 的 prompt 必须显式包含 `PLAN-...`。

plan.md 只保存设计和执行意图；所有 task 状态在 tasks.json；实际工具、验证、worktree、merge 和关键决定按事件写入 operations.jsonl。旧大计划被拆分时标记 `superseded` 并保留历史，不能伪造成 `done`。

如果 superseded 计划仍有历史 `in_progress/review/blocked` task，保留原状态，并追加一条 `taskId=null`、`kind=handoff`、`status=ok` 的计划级操作，说明由哪些 roadmap/child plans 替代和接管。没有这条证据时 doctor 持续告警。

## plan.md

Hook 草稿只保证计划立即存在和可恢复。检查代码后写清独立任务使命、事实证据、范围/非目标、跨 plan 输入、采用设计、状态/数据/错误/恢复边界、local/worktree 理由、任务拆分与集成 owner、验收矩阵、验证矩阵、rollout/rollback、风险和 handoff。不要写 status/frontmatter、checkbox、进度百分比或工具流水。

设计还未进入实现时，详细方案和参考资料放 .updeng/docs/discovery/<module>/，plan 只链接它们。业务功能实际落地并验证后，再更新 .updeng/docs/business/<module>/ 或 integrations。

## tasks.json

任务应是可验证的完整切片。v5 task capsule 先记录 `risk`、`references`、`doNotTouch` 和 `rollback`，再记录 execution、Skills、ownedPaths、sharedPaths、dependsOn、acceptance、documentation 和逐项 verification check。`pending` 可有明确待完善占位，开始实现时应补全，进入 review/done 前不得保留占位。

`delegation=eligible` 只表示 controller 可以在读取实时冲突后考虑 native subagent，并不预先强制委派；`executor` 记录实际 controller/subagent。同一 shared path 只能由 controller 作为 integration owner 串行落地。状态使用 pending、in_progress、blocked、review、done；只有所有 required checks 有证据并通过后才写 done。

`documentation.impact` 只能是 pending、required 或 none。未判断时保持 pending；实现行为或外部契约变化时使用 required，并列出 `.updeng/docs/business/` 或 `.updeng/docs/integrations/` 下实际存在的文件；确认无文档影响时使用 none，并写出具体原因。每个 task 恰好有一个 required、`command=null` 的 documentation check。进入 review/done 前 impact 不能是 pending，documentation check 必须 passed；不要用“最后统一补文档”推迟每个切片的事实同步。

plan index 的 controllerSessionId 是该 plan 唯一主控会话；开始的 task 使用同一 sessionId，真正委派后再记录 agentId。阻塞详情只写 `.updeng/blockers.json`，task 用 blockerId 引用；解除后更新两者。

原主控 task 仍存在时优先恢复它。确实丢失或关闭后，在新 Codex task 中明确写“接管 `PLAN-*`”；Hook 只有在旧会话不再出现在 `runtime/tasks/` 时才迁移当前未完成 controller task，并向 operations.jsonl 追加 handoff。普通“继续”不会抢占其它会话，已完成 task 保留原 sessionId 作为历史证据。

只有 controller 在任务状态、绑定、验证或 blocker 语义变化时改 tasks.json；subagent 返回结果，不用 heartbeat 重写共享任务文件。写 plans/index.json、tasks.json 或 blockers.json 前先重读最新内容，并由单一 integration owner 串行更新。

## operations.jsonl

每行是符合 schema 的独立 JSON 对象。Hook 自动记录可识别的写入和验证，并保存脱敏、截断的 tool/detail；Codex 补充 worktree、handoff、merge、commit、decision 和 note。不要复制完整命令输出或对话。

## 完成

确认 tasks 全部 done、合并后的目标 checkout 验证通过、blocker 已解决、每个 task 的 documentation gate 已结算。然后把目录移动到 plans/archive/<plan-id>/ 并更新 index。Codex-managed worktree 由 Codex archive/cleanup；Updeng 不自行实现 worktree 删除器。
