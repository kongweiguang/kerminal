<!-- @author kongweiguang -->

# 文件、对话框与路径安全

## Dialog 边界

dialog 的取消是正常结果，不是错误。区分单选/多选、文件/目录和目标平台返回形态；前端只把选择结果交给受控 Rust/Plugin API，不长期把绝对路径散落在组件状态和日志中。

保存对话框返回路径后，仍要处理扩展名策略、已存在确认、权限、磁盘空间和 atomic replace。不要把用户选择目录自动扩大为永久全盘 scope。

## Path 规则

- Rust 使用 `Path/PathBuf`，不要用字符串拼 separator。
- 需要 containment 时先 canonicalize 已存在根和候选；新文件则 canonicalize 最近已存在 parent，再验证最终目标。
- 拒绝 absolute injection、`..` traversal、错误 drive/UNC、非法 filename 和保留设备名。
- symlink/junction/reparse point 可能越出 root；验证 resolved target，而不只比较原始前缀。
- opaque node/resource ID 优于在 IPC 中反复暴露绝对路径。
- path error 对用户稳定脱敏，内部日志也避免无必要完整路径。

## 读写策略

- 读取前检查类型和 metadata，限制文件大小；文本明确 encoding/BOM/line ending 策略。
- binary/未知编码/超大文件返回有界状态，不把无限内容送入 WebView。
- 写入使用同目录 temp file、flush/sync（按数据风险）、atomic rename/replace，并定义失败残留清理。
- 不能原子覆盖的平台/文件系统要明确 fallback 和恢复，不伪装成原子。
- 批量操作定义 partial failure、retry/idempotency 和取消点。

## Drag/Drop 与 Watcher

drag/drop 输入同样不可信，并按 window role、数量、大小和 path policy 校验。Watcher event 可能重复、乱序或合并；用 debounce/coalesce 和 authoritative rescan，不把单个 event 当完整事实。

Tauri 窗口默认启用 OS 原生文件拖入。页面内 HTML5 drag/drop、`react-dnd` 或 Tree 拖拽出现禁用光标、`dragover/drop` 不触发时，先检查 `tauri.conf.json` 对应窗口的 `app.windows[].dragDropEnabled`：

```json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "dragDropEnabled": false
      }
    ]
  }
}
```

`false` 让页面内拖拽事件正常进入 WebView，但会关闭该窗口的 OS 原生文件拖入；必须从系统文件管理器拖入文件时保留 `true`，改用 Tauri window drag/drop event 或 Dialog 处理。两类行为通常不能在同一窗口无冲突地同时保留。窗口配置不受前端 HMR 控制，修改后必须完全重启 `tauri dev` 再验证。

Watcher 生命周期绑定 workspace/window，切换 root 时停止旧 watcher。向前端发布 opaque identity/relative data，避免绝对路径泄漏；window focus 时可做一次低成本 reconciliation。

## 验证矩阵

- 取消、空选择、单/多选及路径含空格/Unicode。
- root 内、`..`、symlink 越界、删除竞态和权限拒绝。
- UTF-8/BOM/UTF-16、binary、未知编码、超大文件。
- 写入成功、磁盘/权限失败、进程中断后的 temp/原文件状态。
- watcher 重复/乱序、快速变化、workspace switch 和 cleanup。
- 页面内拖拽与 OS 文件拖入分别验证；修改 `dragDropEnabled` 后用完全重启的 Tauri runtime 验证。
- dev 与 packaged resource/data path 都能工作。
