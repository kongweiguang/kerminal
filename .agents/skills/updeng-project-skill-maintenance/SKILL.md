---
name: updeng-project-skill-maintenance
description: |
  维护 Updeng catalog 中的项目级 skills、references、scripts、触发边界，并从人工确认的历史证据中沉淀规则。
  用于新增、聚合、退役或验证 Updeng Skill，以及用户要求总结历史对话、识别重复错误或升级规则；普通产品代码、自动采纳生成结论和无关个人 Skill 不使用本流程。
---

<!-- @author kongweiguang -->

# Updeng Skill 维护

使用 Codex 的 skill-creator 规则编写单个 skill；本 skill 只补充 Updeng 仓库契约。

用户要求从历史 metrics 提炼重复问题或升级规则时，读取 `references/skill-evolution.md`；保持人工触发、证据可追溯和采纳门禁。

## 仓库契约

- 源目录为 `skills/<domain>/<skill-id>/`，`SKILL.md` 的 `name` 必须等于目录 id。
- `templates/skills.catalog.json` 明确映射 `{ id, source }`，group 和 preset 只引用已声明 id。
- 只有需要项目或领域知识、确定性资源或可复用任务协议的能力才进入 catalog。Codex 原生 Plan/Goal、subagent、worktree、review、Browser 和 handoff 不包装成 skill。
- 项目长期规则放 `AGENTS.md`，外部实时动作放 MCP/app，生命周期采集和结构化提示放 Hook；运行审批继续交给 Codex 原生能力。
- 优先扩充边界清晰的现有 skill；删除 skill 时先把仍独有的领域规则迁入明确接收者，再物理删除源码和 catalog 引用。

## 维护流程

1. 用真实正向请求和相邻反向请求定义触发边界：什么必须加载、什么不能误加载。
2. 对每条候选规则做压力检查：没有它时 Codex 会犯什么错，它要求什么不同动作，怎样验证。
3. 选择最小承载面：稳定仓库约定用 AGENTS，生命周期采集/机械检查用 Hook，任务方法和领域知识用 Skill，确定性重复操作才写 script。
4. 优先编辑现有 Skill；聚合/退役时建立旧能力到新入口/reference 的明确映射，并验证独有不变量仍可发现。
5. 同步 `agents/openai.yaml`、catalog、route、preset、README 和受影响测试；不让 UI metadata 与正文职责漂移。

description 必须同时写清“做什么、何时用、何时不用”。正文使用指令式语言，核心流程留在 `SKILL.md`，变体、长模板和领域细节放一级 references；不要深层引用或复制相同事实。

## 验证

先对每个变更 Skill 运行 skill-creator 的 `quick_validate.py`，再验证至少一个正向触发和一个反向不触发场景。新增/修改 script 必须真实执行其成功和失败路径；聚合能力要验证旧 id 对应的关键不变量仍存在于明确 target。

```powershell
npm test
npm run pack:check
npm pack --dry-run
```

`catalog.test.mjs` 检查目录、frontmatter、group/preset 引用和退役 id；`doctor` 检查目标项目中安装的 skill 与当前模板是否完整。不要用另一套 Python validator 或 Hook 路由复制这些检查。
