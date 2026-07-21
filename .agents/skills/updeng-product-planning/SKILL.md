---
name: updeng-product-planning
description: |
  Updeng 产品规划入口，统一需求发现、领域语义、PRD/Issue 纵向切片和长期技术决策。
  用于目标或业务含义仍需收敛、用户要求 PRD/issue/backlog、术语与状态存在冲突，或架构/依赖/数据/安全取舍需要记录的场景；范围清楚且可直接实现的小任务不要额外制造规划文档。
---

<!-- @author kongweiguang -->

# Updeng 产品规划

先读当前对话、`AGENTS.md`、相关代码、测试和既有业务文档，只补仍会改变实现的未知项。

## 选择工作面

- 目标、非目标、成功标准或候选方案未收敛：读取 `references/requirement-discovery.md`；需要外部发现或问题库时再读对应 reference。
- 术语、角色、状态或业务规则含义冲突：读取 `references/domain-context.md`，稳定结论写入 `.updeng/docs/business/`。
- 用户要求 PRD、issue 或 backlog：读取 `references/issue-planning.md` 与 `references/vertical-slices.md`。
- 存在长期架构、依赖、数据、安全、部署或公共契约取舍：读取 `references/tech-decisions.md`，用 `references/decision-record.md` 记录采用结果。

## 收口

区分已证实事实、用户决定、假设和待验证项。规划材料不冒充实现状态；进入实现后由 `updeng-workflow` 维护 plan 三件套。
