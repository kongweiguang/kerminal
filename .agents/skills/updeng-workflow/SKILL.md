---
name: updeng-workflow
description: |
  Updeng 的轻量开发入口：统一工程治理、direct/plan、当前 checkout/Codex worktree、controller/native subagent、持久计划和高风险升级。
  用于 Codex 在 Updeng 项目中开始或恢复工程任务、选择执行位置、维护 plan 三件套、协调原生 subagent 或收口状态；纯讨论无需创建计划，小任务不要被强制变成重型状态机。
---

<!-- @author kongweiguang -->

# Updeng 工作流

Updeng 管理本地状态和文档，Codex 负责实际执行。worktree、subagent、handoff、merge、review 和 worktree cleanup 都使用 Codex/Git 原生能力，不在 Updeng 中再实现一套执行器。

按需读取：跨 session、subagent 或 worktree 的持久计划使用 `references/durable-planning.md`；通用工程基线和高风险升级使用 `references/development-governance.md`，涉及生产工程细节再读 `references/production-engineering.md`。

## 两层路由

先判断流程深度，再判断执行位置。

### 流程深度

- direct：边界清楚、低风险、单点且可快速验证。直接修改，不创建 plan。
- plan：多步骤、跨文件、需要设计、可能暂停/恢复或适合拆分执行。由 Hook 创建或复用 plan 三件套，再由 Codex 完善。
- discussion：用户只要分析/设计，或需求还未收敛。材料写入对应业务模块的 docs/discovery/，不写实现型业务文档。
- review：只读评审。findings 优先，不顺手修改，除非用户明确要求。

### 执行位置

- 当前 checkout 唯一写入者、改动集中、可串行完成：在当前分支执行。
- 需要后台并行、当前 checkout 有无关未提交修改、任务需要独立验证/评审、或多个执行单元会产生独立代码包：使用 Codex worktree。
- 多项工作会修改同一文件、schema、migration、依赖清单、生成产物或公共契约：不要并行写；由一个集成 owner 串行处理。
- worktree 只隔离工作目录，不消除 merge conflict。完成后由 Codex 合并或 handoff，验证合并结果，并清理已完成的 Codex worktree/task。

复杂任务不等于必须 worktree；并发的简单任务也可能需要 worktree。

## 意图与能力

| 意图 | 默认 flow | 按需能力 |
| --- | --- | --- |
| 有界实现或修复 | direct 或 plan | 领域 Skill + 开发治理 |
| 模糊需求、竞品或方案比较 | discussion | requirement discovery |
| 术语、状态或业务边界冲突 | discussion 或 plan 前置 | domain context |
| PRD、backlog、纵向切片 | plan | issue planning |
| 偶发失败、性能回退、根因不明 | direct 或 plan | diagnose |
| 高回归风险规则或用户要求先写测试 | plan | TDD |
| UI/状态/依赖方向尚未证明 | discussion 或 plan | prototype |
| 深模块、依赖倒置或渐进迁移 | plan | architecture deepening + tech decision |
| 只读代码评审 | review | code review |

只加载当前项目 `.agents/skills/` 中实际安装且语义命中的能力。专项 Skill 未安装时，低风险任务沿用项目既有模式并说明缺口；数据、权限、发布、远程写入或不可逆任务缺少必要领域约束时，先停止危险动作并补齐证据、授权和恢复口径，不能假装已加载能力。

## 上下文预算

- direct 只读 AGENTS、目标代码、调用方、最近似实现、测试和必要业务文档。
- plan 再读 `plans/index.json`、当前三文件计划和关联 blocker；存在 roadmap 时只读本 child plan 的输入输出和直接依赖。
- discovery、business、integrations 按业务模块加载；metrics 只在用户要求总结时读取选定范围。
- 不把所有计划、历史对话、全部 Skills、旧归档或长日志塞进每轮上下文。

## Roadmap 与 Plan 三件套

长期 roadmap 不由一个大 plan 和一个 controller session 从头做到尾。按可独立启动、验收、回滚的用户/调用方结果拆为多个 child plan；每个 child plan 对应一个 Codex controller task，plan 内再由该 controller 决定是否使用 native subagent。

每个执行中的 plan 位于 .updeng/plans/active/<plan-id>/，且只用三份文件表达工作：

1. plan.md：目标、设计、边界、执行策略、任务拆分、验收、验证与回滚。只写计划叙事，不放状态、checkbox 或操作流水。
2. tasks.json v5：一个数组保存任务状态、risk、references、doNotTouch、rollback、相关 Skills、delegation eligibility、实际 executor、local/worktree execution、session/agent、owned/shared paths、依赖、验收数组、documentation impact、结构化验证检查和 blockerId。
3. operations.jsonl：每行一个结构化操作。Hook 自动记录工具写入和验证；Codex 补充 worktree、handoff、merge、commit、关键决策等语义操作。

同时更新 .updeng/plans/index.json 的 roadmap、跨 plan 依赖、controllerSessionId 和 lifecycle。完成后把目录移到 .updeng/plans/archive/<plan-id>/，将索引状态改为 done；被新 child plans 替代的旧大计划使用 superseded，不得伪造完成。

UserPromptSubmit 判定为 plan 时会先创建或复用三件套、绑定当前 controller session，并在 Hook 上下文返回路径。多个 unfinished plans 并存时必须在 prompt 中明确 plan ID，Hook 不猜目标。先读取该目录，不要重复建 plan；Hook 生成的是可恢复草稿，检查代码后必须补足以下内容：

- 独立可交付使命、用户可观察结果与非目标。
- 当前事实、代码/测试证据、跨 plan 输入、风险、参考、禁止改动和具体回滚。
- 状态、数据、错误、恢复、安全、性能和兼容边界。
- 为什么选 local 或 worktree；owned/shared paths 和唯一集成 owner。
- 可独立任务与 subagent eligibility，而不是预先固定 subagent。
- 验收矩阵、最窄验证、合并后验证、rollout、rollback 和 handoff。

## Native Subagent

主 Codex 是 controller。只有任务可独立验收且写入边界不重叠时，才使用 Codex 原生 subagent；派发时明确任务、owned paths、相关 Skills、验证和回传格式。subagent 根据传入的 Skills 与项目已安装 Skills 做评估，不依赖 Updeng 生成 agent profile。

不要为小改机械派发。不要让多个执行单元同时拥有同一 shared path。主控必须复核结果并执行合并后验证。

## 执行循环

1. **Route**：判断 intent、flow、risk、execution 和需要读取的 Skills。
2. **Context**：核对代码事实、调用链、现有测试、用户改动和当前并发状态。
3. **Shape**：direct 形成压缩任务胶囊；plan 完善叙事、task capsule、依赖和文档门禁。
4. **Build**：主控串行拥有共享契约；只把可独立验收且路径隔离的切片委派给 native subagent/worktree；新增、重写或修改的可注释人工文件补齐 `@author kongweiguang` 文件头。
5. **Verify**：先聚焦检查，再在目标 checkout 验证集成、真实运行、UI、数据或发布边界。
6. **Review**：非 trivial 交付按问题优先方式检查行为、数据、权限、并发、资源、兼容和漏测。
7. **Close**：解决作者标识、文档影响、验证与 blocker，复读 diff，归档计划并清理不再需要的 Codex worktree。
8. **Learn**：只把重复纠正、反复失败和稳定经验保留为 metrics 证据；用户要求后再总结和修改正式规则。

## 状态与阻塞

- .updeng/runtime/tasks/*.json 由 Hook 管理，只表示当前正在运行的 session/subagent。Stop 或 SubagentStop 后删除，不作为完成历史。
- .updeng/runtime/hooks.json 只记录当前 Hook revision 是否被 Codex 实际调用；awaiting_activation 时新开项目 task，并在 /hooks 审核或信任当前定义。
- .updeng/blockers.json 保存跨 turn 仍需保留的 blocker、用户决策和可逆默认选择；解决后写 resolution，再标记 resolved。
- tasks.json 才是 plan 的任务状态。只有语义上完成并有验证结果时才改为 done；Hook heartbeat 不会自动完成任务。
- 原主控会话应优先恢复；会话确实关闭或丢失后，在新 task 中明确“接管 PLAN-*”。Hook 仅在旧 runtime 已停止时迁移主控并记录 handoff，不能用含糊的“继续”并发抢占。
- 每个 task 用 `documentation.impact=required|none` 结算文档影响，并通过 required documentation check；impact=pending 不能进入 review/done。
- 用 updeng status . 查看正在运行的会话、未完成 plan tasks、active/blocked plans、open blockers 和 metrics summaries。

## 文档边界

- .updeng/docs/business/<module>/ 只记录当前代码已经实现并验证的业务逻辑、规则、入口和边界。未落地功能、产品设想和候选设计不得写入。
- .updeng/docs/discovery/<module>/ 保存尚未实现的需求发现、设计候选、原型结论和参考资料；按业务模块建目录。
- .updeng/docs/integrations/<module>/ 只记录当前已实现的外部契约；未验证资料仍放 discovery。

## 收口

完成前更新必要业务实现文档，再结算 tasks.json 的 documentation/check、其它验证和 plan index。direct flow 也必须显式判断文档影响。worktree 路径必须验证合并后的目标 checkout，再由 Codex 清理 worktree。不要为了“状态好看”伪造完成，也不要把 raw tool logs 复制进 plan。
