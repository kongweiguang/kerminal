<!-- @author kongweiguang -->

# Tauri 测试策略

## 测试层级

| 层级 | 主要证明 |
| --- | --- |
| Rust unit/property | 纯规则、解析、状态机、错误映射 |
| Rust integration | filesystem/SQLite/Git/process 等真实 adapter |
| Contract fixture | serde、DTO、error code、UTF-16/encoding 等 wire 语义 |
| Frontend unit/component | controller、race gate、focus、view state、wrapper 参数 |
| Browser/E2E | 渲染、交互、键盘、响应式和 console |
| Tauri runtime | handler 注册、managed state、Channel/Event、plugin/Capability |
| Packaged/clean machine | resource path、sidecar、签名、安装、更新和平台行为 |

每个验收选择能证明它的最低成本层，但公共 IPC、plugin、window 和 packaged path 至少要有一条真实 runtime 证据。

## Rust 测试

- 把 policy/state machine/normalization 从 Command 抽出，用 temp directory、temp DB、fake clock/process adapter 测试。
- IO 集成尽量使用真实临时资源，不 mock 掉要验证的 filesystem/database/Git 行为。
- 覆盖正常、空、边界、非法、权限、取消、stale identity、并发和恢复。
- 对 destructive/transactional 行为验证失败后的真实 state，不只看 error variant。
- 测试结束回收 child process、watcher、DB connection、temp file 和 background task。

`#[path]` 重编译生产模块可能产生与真实 crate 不同的 dead-code/feature 情况；需要证明应用注册入口仍能链接和调用公共 API。

## IPC 契约测试

- 固定 request/response/event JSON fixture，覆盖 rename、tagged enum、missing/null/unknown field。
- 前端 wrapper 断言 command name、argument envelope 和返回 normalize，不把所有组件都直接 mock `invoke`。
- 大整数、decimal、path、Unicode、UTF-16 position、binary/encoding 和 error redaction 单独覆盖。
- Handler registration 仍需真实 Tauri test/dev 验证，fixture 不能证明 `generate_handler!`。

## 前端与竞态

- controller test 覆盖旧请求晚到、workspace/window 切换、取消、重复点击和失败恢复。
- component test 覆盖 accessible name、keyboard、focus return、disabled/pending/error 和长文本。
- Monaco/canvas/WebView 等重组件只 mock 外壳时，另保留真实 Browser/runtime 验证。
- 不用任意 sleep；使用可控 promise、fake timer、event barrier 或最终状态等待。

## Event、Channel 与资源

- 两个并发 operation 的 progress 带不同 ID 且不串线。
- late subscriber 先取 snapshot，再接增量。
- caller reload/close、window destroy、workspace switch 和 app shutdown 后，listener/sender/task 清理。
- backpressure/高频事件做 batch/throttle，最终 completed/failed/cancelled 不丢。

## 真实桌面与平台矩阵

至少记录 OS、架构、WebView/runtime、debug/release、Tauri/plugin 版本。需要平台 API 时在目标 OS 验证；浏览器 preview 不能证明 window、tray、notification、shortcut、filesystem scope 或 updater。

packaged 测试使用干净 profile/location，覆盖路径含空格/Unicode、首次启动、第二次启动、升级/卸载和错误权限。不能执行的平台标记未验证，不写成 passed。

## 测试输出

记录命令、通过数量、skipped 原因、真实/模拟边界和残余风险。失败日志脱敏，不把完整用户文件、绝对路径、token 或 signing material 写进 fixture/CI artifact。
