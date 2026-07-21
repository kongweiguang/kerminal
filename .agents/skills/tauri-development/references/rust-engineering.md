<!-- @author kongweiguang -->

# Tauri Rust 工程

## Ownership 与 API

- callee 不保留数据时借用，只在 ownership/concurrency 边界 clone。
- 使用领域 struct/enum，避免通用 map 和 string flag。
- 保持 public surface 小，并沿用项目 module visibility。
- 用 `Option` 表示可选、`Result` 表示可恢复失败，能用类型排除非法状态时不要靠注释。
- 用户输入、filesystem/database/network/plugin、lock、window lookup 和 serialization 不使用无保护 `unwrap/expect`。
- `Mutex::lock()` 可能返回 `PoisonError`；生产路径必须映射为稳定领域错误或在明确重建不变量后恢复，不能 `lock().unwrap()`。只有能证明受保护状态仍一致并立即修复时才考虑 `into_inner()`，否则把 poisoned state 当不可用并走重建/重启路径。

不要顺手对无关 Rust 代码做风格重写；遵循项目 toolchain、edition、lint 和相近实现。

## Async、Blocking 与资源

- 使用 Tauri/项目已经选择的 runtime。
- 同步数据库、filesystem、process、压缩和 CPU-heavy 工作离开 async executor。
- lock 只包围必要 mutation，并在 `.await` 前释放 guard。
- background task 有 cancellation token/owned shutdown channel，并定义 join/abort policy。
- queue、output、concurrency、retry 和 timeout 必须有界。
- failure 与 controlled shutdown 都清理 watcher、listener、temp file、process、transaction 和 handle。

## 错误、日志与配置

沿用项目 `thiserror`、`anyhow`、tracing/logging 约定。内部保留 source chain，IPC 只映射稳定脱敏数据。日志应足够定位边界，但不能记录 token、signing key、完整用户文件或无限制 subprocess output。

配置从项目已有结构化来源读取，在 startup 或最近责任边界校验；区分 developer configuration failure 与可恢复 user data failure。

## Windows 子进程

优先使用项目已有 adapter 或 scoped Tauri shell plugin。直接创建进程时：

- executable 固定，参数使用结构化 allowlist；不拼接前端输入为 shell command。
- 明确 cwd、environment allowlist、timeout、output cap、exit code、cancel 和 child cleanup。
- 不记录 secret argument 或完整继承环境。
- `.cmd/.bat` 与 native executable 分开处理。

GUI 应用仅在 Windows 抑制多余 console window：

```rust
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

let mut command = Command::new(program);
command.args(args);

#[cfg(target_os = "windows")]
command.creation_flags(CREATE_NO_WINDOW);
```

该 flag 不替代 timeout、output 和 lifecycle 管理。

## 验证命令

先读取项目 scripts，常见聚焦检查为：

```text
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

只有项目已把 Clippy 作为门禁，或任务本身针对 lint quality 时才按项目参数运行。纯 service/adapter 使用 unit test，注册、WebView IPC、plugin lifecycle 和平台行为必须用真实 Tauri runtime 验证。
