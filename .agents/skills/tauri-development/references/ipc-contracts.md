<!-- @author kongweiguang -->

# IPC 契约

## 内容

- Command 与前端 wrapper
- DTO/serde 规则
- 结构化错误
- Channel/Event
- 长任务与验证

## Command 与 Wrapper

Command 只校验公共输入、调用 service、映射输出/错误。每个 Command 必须进入真实 `generate_handler!`，并通过统一前端 API 模块调用。

```rust
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteInput {
    pub title: String,
    pub body: String,
}

#[tauri::command]
pub async fn create_note(
    input: CreateNoteInput,
    state: tauri::State<'_, AppState>,
) -> Result<NoteDto, CommandError> {
    validate_create_note(&input)?;
    state.notes.create(input).await.map_err(Into::into)
}
```

```typescript
export function createNote(input: CreateNoteInput): Promise<NoteDto> {
  return invoke<NoteDto>("create_note", { input });
}
```

参数命名和嵌套结构以项目当前 Tauri 版本、相近 wrapper 和实际序列化测试为准，不凭记忆猜 camelCase/snake_case。

## DTO 与 Serde

- IPC DTO 与 database row、domain aggregate、plugin type、SDK response 分离。
- 长期契约显式设置命名策略，缺失和 `null` 分开建模。
- `Option`、default、`skip_serializing_if` 与 TypeScript optionality 保持一致。
- 超过 JavaScript safe integer 的整数、精确 decimal、hash、opaque ID 使用 string。
- 演进型结果/事件使用 tagged enum 与 exhaustive TypeScript union。
- 反序列化后仍要限制 string、collection、payload size；serde 成功不等于授权通过。
- 大文件/二进制不要整体走 JSON IPC。

项目已有 type generation 时更新其 source 并检查 drift；不要为一个小 DTO 引入新的宏或 codegen 栈。

## 结构化错误

Rust 保留完整 error chain，IPC 返回稳定脱敏 envelope：

```rust
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
    pub retryable: bool,
}
```

- 在知道恢复语义的层映射错误。
- 不返回 SQL、绝对路径、token、stack trace、SDK payload 或内部 type name。
- 需要关联日志时返回受控 trace/request ID。
- 只重试幂等操作或有 idempotency key 保护的操作。
- 前端 wrapper 统一 normalize 未知 invoke rejection，组件只依赖稳定 code。

## Channel 与 Event

| 语义 | 机制 |
| --- | --- |
| 请求和一个结果 | Command |
| 单 caller 的有序进度 | IPC Channel |
| Window/App 生命周期广播 | Event |
| 可恢复的完成事实 | Command/query + 权威状态 |

Channel/Event payload 使用 tagged type，并携带 `operationId` 或 resource ID；定义 started/progress/completed/failed/cancelled。高频进度要 throttle/batch，最终状态不能丢。私有数据只发目标 window。异步 listener 注册也要处理组件已卸载的竞态并调用 `unlisten`。

reload 或晚订阅时先查询 authoritative snapshot，再监听增量。Event 不提供 transaction、backpressure、ack 或 authorization。

## 长任务

明确 timeout、cancel、duplicate start、资源/输出上限、progress identity、caller 消失和 app shutdown 行为。同步数据库、文件、process、压缩或 CPU-heavy 工作放到专用线程/`spawn_blocking`；不阻塞 async executor，不跨 `.await` 持锁。

所有终态都清理 temp file、subprocess、transaction、channel、listener 和 managed task entry。

## 验证

- serde fixture round-trip，以及 invalid/missing/null/unknown fields。
- 前端 wrapper 与 wire type 编译一致。
- 真实 WebView 调用已注册 Command，覆盖至少一个稳定错误。
- 两个并发 operation 的进度不串线。
- caller close/reload 后 listener 与后台资源符合声明。
- Rust 边界验证 path/resource ownership 和 payload limit。
