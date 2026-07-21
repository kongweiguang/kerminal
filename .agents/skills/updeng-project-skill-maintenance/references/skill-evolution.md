---
name: updeng-skill-evolution
description: |
  从 Updeng 本地 metrics 保存的历史用户提问与助手回复中，人工触发地归纳高频问题、重复纠正、重复工作和 agent 常见错误，再更新 AGENTS、Hooks 或 Skills。
  用于用户要求 Codex 总结历史对话、识别重复行为、改进 Updeng，或从证据升级项目 Skills；不得自动修改正式规则、自动采纳生成结论，也不得把 token/tool 次数当成知识。
---

<!-- @author kongweiguang -->

# Updeng Skill 沉淀与升级

进化由用户触发，Hook 只保存历史对话，不自动生成或采纳规则。

## 数据源

- .updeng/metrics/index.json：会话索引、消息数量和更新时间。
- .updeng/metrics/conversations/*.jsonl：每行一条 user 或 assistant 消息，保留 session/turn、时间和轻量 signal 标签。
- .updeng/metrics/summaries/*.json：Codex 在用户要求总结后生成的结构化分析。

metrics 是本地数据，不提交远程。仍要避免把凭据、密钥、客户敏感数据和生产 payload 固化；Hook 默认做常见 secret redaction。

## 人工总结流程

1. 明确分析范围：时间、session、模块或问题类型，避免每次扫描全部历史。
2. 读取相关 conversation JSONL，按语义合并同类表达，不按关键词命中次数机械下结论。
3. 提取四类证据：高频提问、重复纠正、重复工作、agent 常见错误。
4. 对每个候选记录次数、session/turn 证据、适用边界、反例和建议落点。
5. 写入 .updeng/metrics/summaries/<timestamp>-<topic>.json，先给用户评审；没有用户要求时不改正式文件。
6. 用户确认后做最小修改并验证正反例。

## 证据与确认

- 用户明确纠正可以立即形成候选，但修改正式规则前仍要复述准备修改和不修改的边界。
- 重复次数不是唯一标准：一次高影响安全错误可以进入治理，多次同源噪声不能冒充多条独立证据。
- 每个候选至少包含适用边界、一个反例、目标文件、预期行为变化、验证和回滚。
- 多个候选来自同一根因时合并；已有规则已覆盖但未执行时，优先修触发/提示/验证，不重复堆正文。
- 用户最新明确指令优先于历史模式，metrics 不能反向覆盖当前需求。

## 落点选择

- 项目长期执行约定：AGENTS.md。
- 生命周期采集、结构化记录或归属提示：Hook。
- 某类任务的可复用方法：对应 Skill。
- Skill 匹配、流程深度或执行建议：templates/skills.catalog.json 与 Hook 路由逻辑。
- 已实现业务事实：.updeng/docs/business/<module>/。
- 尚未实现的需求、设计或资料：.updeng/docs/discovery/<module>/。

个人偏好不应伪装成项目事实。一次失败不自动升级为规则；重复证据也要检查是否来自同一根因。修改 Skill 时遵守 skill-creator：description 写清 trigger 与边界，正文只保留模型原本不知道且会改变行为的内容。

`updeng update` 会同步 catalog 管理的 Skill 目录。项目特有沉淀应创建不同 id 的项目 Skill；需要改 Updeng 内置 Skill 时，在 Updeng 源仓库修改并发布，不直接长期分叉已安装的托管副本。

## Summary 结构

使用 .updeng/schemas/metrics-summary.schema.json。每个 pattern 至少包含 type、summary、count、evidence、boundary、target 和 recommendation。证据只引用 session/turn，不在 summary 里再次复制整段对话。

## 采纳门禁

1. 说明目标 Skill/Hook/AGENTS 段落、修改边界和明确不改内容。
2. 为 Skill 验证 frontmatter、UI metadata、catalog/route，并运行 `quick_validate.py`。
3. 至少验证一个应触发场景和一个不应触发场景；Hook 还要用真实事件 payload 覆盖成功、失败和重复事件。
4. 运行受影响项目测试、package 检查和必要真实项目 update/doctor。
5. 复读 diff，确认没有把原始对话、secret、一次性项目事实或旧 id 噪声写进通用规则。

不能证明新规则比现有行为更稳时，保留 summary 候选，不修改正式资产。
