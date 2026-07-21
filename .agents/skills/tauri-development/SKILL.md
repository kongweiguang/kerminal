---
name: tauri-development
description: |
  Tauri 2 应用架构与 Rust/前端类型化 IPC 开发。用于创建或重构 Tauri 项目、修改 src-tauri 核心代码、增加 Command/Channel/Event、设计 serde DTO 与结构化错误、管理 Rust 应用状态，或排查完整 invoke 调用链。单独插件配置、纯移动端平台工作或发布打包应使用对应专项 Skill。
---

<!-- @author kongweiguang -->

# Tauri 开发

沿用项目当前边界，交付最小但完整的 UI -> 前端 wrapper -> IPC -> Rust service -> state/IO 调用链。业务规则保持可脱离 Tauri 测试，前端类型与 Rust wire contract 必须同步。

## 先读项目事实

修改前检查：

- `package.json`、lockfile 和真实 Tauri CLI script。
- `src-tauri/Cargo.toml`、`tauri.conf.json`、`build.rs` 和 Rust composition root。
- 已有 `#[tauri::command]`、`generate_handler!`、managed state、event name、DTO 和前端 API wrapper。
- 新调用涉及 plugin/WebView API 时，同时检查 `src-tauri/capabilities`。

项目已有清晰模式时，不额外引入 service layer、状态库、类型生成器、async runtime 或 error crate。

## 选择边界

| 需求 | 推荐边界 |
| --- | --- |
| 纯 UI 交互 | 保留在前端 |
| 单次请求与单个成功/失败结果 | Command + `invoke` |
| 一次调用拥有的有序进度 | IPC Channel |
| 生命周期或多订阅者通知 | Tauri Event |
| 无额外业务策略的官方能力 | Plugin JS API |
| 授权、路径、密钥、事务或多能力编排 | Rust service + Command |

大量二进制或高频数据不要反复走 JSON Event；根据项目选择文件、sidecar/socket 或其它有界传输。

## 开发流程

1. 追踪最相近功能的现有调用链，确认状态和副作用归属。
2. 先定义输入、输出、事件和错误 DTO，再注册 handler。
3. 把可复用策略与 IO 放到可测试 Rust 模块，Command 只做边界适配。
4. 在真实入口只注册一次 Command、state、plugin 和 listener。
5. 维护一个 typed 前端 API wrapper，不在组件中散落 raw `invoke`。
6. 在 Rust 边界校验不可信输入、资源所有权、canonical path、上限、取消和清理。
7. 运行聚焦 Rust/前端/契约测试，再验证真实 Tauri runtime 路径。

## 按需读取

- 项目初始化、模块边界、启动组合和状态所有权：[architecture-and-setup.md](references/architecture-and-setup.md)
- Command、Channel/Event、serde wire type、错误和长任务：[ipc-contracts.md](references/ipc-contracts.md)
- Rust ownership、async/blocking、资源、日志、Windows 子进程和验证命令：[rust-engineering.md](references/rust-engineering.md)

插件、Capability、文件、持久化、窗口、托盘或通知使用 `tauri-app-capabilities`；Android/iOS 使用 `tauri-mobile-development`；测试或性能诊断使用 `tauri-quality`；打包发布使用 `tauri-delivery`。

## 不变量

- 前端传入的路径、ID、URL 和参数全部不可信。
- IPC 只返回稳定、脱敏的错误；内部 cause 留在受控日志。
- 不跨无关 `.await` 持有锁，不在 async executor 直接执行长期 blocking work。
- 长任务必须定义 timeout、cancel、operation identity、资源上限和 shutdown 行为。
- Event 只发给需要的 window/caller，并在组件、窗口或任务结束时移除 listener。
- DTO 不直接复用数据库 row、SDK model、内部 error 或可变全局 state。

## 完成门禁

- Rust fmt/check 与聚焦 unit/integration tests。
- 前端 typecheck 与聚焦测试。
- Rust/TypeScript DTO fixture、缺失/null/非法值和稳定错误码。
- 至少一条真实 `invoke`、Channel 或 Event runtime 路径。
- 受影响时覆盖错误权限、路径越界、取消、listener/resource cleanup 和 packaged behavior。

只编译成功不算完成；handler 注册、wire shape、Capability、真实 WebView 调用和业务文档必须一致。
