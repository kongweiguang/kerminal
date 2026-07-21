---
name: updeng-development-governance
description: |
  为 Updeng 项目的所有开发、修复、重构、评审和交付提供简洁工程基线，并在生产数据、认证授权、发布或外部副作用出现时升级恢复与审批要求。
  用于 Codex 在 Updeng 项目中执行任何工程变更并需要保护范围、既有行为、用户改动、验证可信度和文档真实性；只有涉及生产、凭据、权限、破坏性数据、发布或不可逆外部副作用时才升级高风险要求。
---

<!-- @author kongweiguang -->

# Updeng 开发治理

Codex 原生 sandbox、approval、review、worktree 和 Goal 负责运行时控制。Updeng Hook 只维护本地状态和给出归属提示，不替 Codex 决定命令是否执行。

## 通用基线

1. 先读 AGENTS、最近似实现、调用方和相关测试；沿用项目已有边界，找不到参考时再建立新模式。
2. 写清目标、非目标、验收和最窄验证。小任务可在当前思考中完成，复杂任务写入 durable plan。
3. 保持改动聚焦，不覆盖用户或其它 session 的未归因修改；共享文件由一个 integration owner 串行处理。
4. 让测试强度匹配风险：先跑聚焦验证，改公共契约、跨模块行为或发布路径时再扩大验证。
5. 只报告真实运行结果；无法运行时说明原因、未覆盖范围和剩余风险，不把推断写成通过。
6. 每次代码改动都判断文档影响。plan task 在 `documentation` 中记录 required paths 或明确的 none reason，并通过 documentation check；direct task 在完成说明前做同样判断。只有代码已经落地并验证后才更新 business/integrations；设计、候选和资料留在 discovery。
7. 完成前复读 diff，确认没有越界改动、调试残留、敏感信息或与验收无关的格式化。

## 文件作者硬要求

- 所有新增、重写或本轮修改的人工维护文件，都必须在文件头或文件级注释中标注 `@author kongweiguang`。修改遗留文件时发现缺失，必须在同一任务补齐，不能因为不是本轮创建就继续遗漏。
- 保留语法要求：shebang、编码声明、XML declaration、HTML doctype、TypeScript triple-slash directive 和 Skill YAML frontmatter 必须仍位于格式要求的位置，作者标识紧随其后。
- 文件格式不支持注释、机器生成文件、锁文件、vendor、缓存和二进制资源是唯一例外。JSON/JSONL 不允许为了作者标识写入非法注释。
- 常用格式使用原生注释：Markdown/MDX 用 `<!-- @author kongweiguang -->`，JS/TS/Rust/Java 等用行或文件级注释，CSS 用块注释，Python/YAML/TOML/Shell 用 `#`，SQL 用 `--`。
- 交付前检查本轮所有 touched files；缺少作者标识的可注释文件不得视为完成。Updeng Hook 只负责提示和收口复核，实际补写仍由 Codex 完成。

跨模块状态、公共契约、权限/数据边界、外部 IO、性能热点、桌面/WebView 或长期迁移不是普通接线工作。遇到这些场景时，按需读取 [production-engineering.md](references/production-engineering.md)，先定义必须保持的语义，再选择模型、边界、适配器、验证和恢复；不要机械套层级或设计模式。

Updeng 管理的计划、业务、discovery、integration 和交付说明默认使用中文。作者标识保持固定姓名，其余公共契约、核心业务规则、复杂状态机、并发/事务/权限/恢复等非显然代码写必要中文注释，解释原因和边界；简单赋值、显然控制流和类型签名不要写复述式注释。

## 高风险升级

涉及生产数据、凭据、权限、正式发布、破坏性操作或不可逆外部副作用时，再增加：

1. 确认精确环境、账号、分支、资源、数据范围和调用方；无法确定目标时停止写入。
2. 标出不可逆点、并发窗口、权限扩大、敏感数据和失败后的残留状态。
3. 优先只读检查、dry-run、备份、快照或限定样本，并验证恢复路径适用于当前版本。
4. 需要审批时，由 Codex 提供具体命令、目标、影响、保护措施和回滚方式。
5. 执行后检查真实系统事实，不只看退出码；失败时先恢复一致状态，再决定是否重试。

跨 task 的高风险工作使用 `updeng-workflow` 的 durable planning reference。计划叙事写 plan.md，执行状态写 tasks.json，关键选择与操作写 operations.jsonl；不要增加另一套审批状态机。
