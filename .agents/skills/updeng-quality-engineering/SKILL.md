---
name: updeng-quality-engineering
description: |
  Updeng 质量工程入口，统一缺陷与性能诊断、测试先行开发和生产级代码评审。
  用于排查 bug/失败/竞态/性能回退、用户明确要求 TDD 或先锁定回归、以及 review/diff/交付复核；普通功能实现仅执行项目必要验证，不因加载本能力而强制完整 TDD 或只读评审。
---

<!-- @author kongweiguang -->

# Updeng 质量工程

## 选择工作面

- 现象、根因或失败层级未知：读取 `references/diagnosis.md`；需要建立快速反馈回路时再读 `references/feedback-loops.md`。
- 用户要求 TDD、复杂规则回归代价高，或缺陷需要先锁定：读取 `references/tdd-development.md` 与 `references/test-design.md`。
- 用户要求 review、独立复核或合并检查：读取 `references/code-review.md`，保持 findings 优先和只读边界。

## 共同纪律

先建立可重复证据，再改变实现。区分测试、静态检查、真实 runtime 和发布产物各自能证明的范围；没有执行的验证不得写成已通过。
