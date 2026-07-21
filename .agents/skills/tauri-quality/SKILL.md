---
name: tauri-quality
description: |
  Tauri 2 跨 Rust、前端、IPC、plugin、WebView 和目标平台的测试、故障诊断与性能分析。用于设计测试矩阵、复现运行时/打包差异、排查启动卡顿、资源泄漏、进程/窗口问题或优化体积。普通功能实现使用 tauri-development。
---

<!-- @author kongweiguang -->

# Tauri 质量保障

先证明问题发生在哪一层，再选择测试和工具。单元测试、mock invoke、浏览器截图、`cargo check` 和真实 packaged app 各自只能证明一部分事实，不能相互冒充。

## 分层定位

| 现象 | 优先检查 |
| --- | --- |
| Rust 规则/解析错误 | pure module unit/property test |
| serde/错误码/参数不一致 | Rust/TypeScript contract fixture |
| Command 未注册或 state 缺失 | 真实 app composition + invoke |
| Plugin permission denied | registration + Capability + window role |
| UI 状态/焦点/竞态 | frontend component/controller test + Browser |
| dev 正常、安装包失败 | packaged resource/path/signing/target runtime |
| 卡顿、泄漏、进程残留 | trace/profile + repeated lifecycle measurement |

## 诊断流程

1. 固定版本、平台、架构、构建模式、输入、工作区和复现步骤。
2. 保存第一条因果错误，不被后续 cascade log 带偏。
3. 从 UI -> wrapper -> IPC -> Command -> service/plugin -> OS 缩小故障层。
4. 建立最小可重复基线，加入能区分假设的 instrumentation/test。
5. 修改最小边界，先跑聚焦验证，再跑受影响的真实 runtime/package 路径。
6. 检查取消、并发、window close、workspace switch、shutdown 和恢复。
7. 报告证据、未验证平台与残余风险，不把偶发一次成功当修复。

## 按需读取

- 测试分层、mock 边界、真实 runtime/E2E、平台矩阵和资源清理：[testing.md](references/testing.md)
- 启动、Rust/IPC/WebView、资源泄漏、长稳、体积和性能报告：[performance.md](references/performance.md)

需要实现 IPC 使用 `tauri-development`；插件/权限使用 `tauri-app-capabilities`；release artifact、安装或 updater 问题同时读取 `tauri-delivery` 对应 reference。

## 完成门禁

- 失败前测试能稳定复现目标行为或明确说明只能人工复现。
- 修改后聚焦测试、相邻回归和真实 Tauri 路径通过。
- 测试没有只断言 mock 自己，也没有用 sleep 掩盖竞态。
- 性能结论包含 baseline、样本、环境、p50/p95 或合理统计，而不是单次时间。
- 进程、listener、watcher、model、window、thread、handle 和 temp file 回到稳定状态。
- 无法验证的平台、打包格式或真实外部条件明确列出。
