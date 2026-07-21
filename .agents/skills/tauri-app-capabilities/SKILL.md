---
name: tauri-app-capabilities
description: |
  Tauri 2 插件、Capability/权限、CSP、文件与对话框、本地 Store/SQLite、Window、Tray、通知和平台 API 集成。用于安装或排查官方/自定义 plugin、收紧 scope、增加本地持久化或桌面能力。自定义 IPC 契约使用 tauri-development，更新器与发布使用 tauri-delivery。
---

<!-- @author kongweiguang -->

# Tauri 应用能力

原生能力必须作为完整链路交付：依赖、Rust 注册、Capability/permission、typed caller、lifecycle、错误与真实 runtime 验证。安装 package 或编译成功不能证明 WebView 有权且能安全调用。

## 同时检查四个位置

1. `src-tauri/Cargo.toml` 的 Rust dependency 与 feature。
2. 前端 package、package manager 和 lockfile。
3. 真实 Rust 入口中的 plugin/state/window 注册。
4. `src-tauri/capabilities`、generated schema、CSP、window/platform assignment。

再读取相近 wrapper/call site，判断前端能否直接调用 plugin，还是必须经过 Rust Command 执行业务授权、路径校验、secret 或事务。

## 集成流程

1. 从仓库和当前官方文档确认 Tauri/plugin 版本及目标平台。
2. 优先使用项目包管理器和对应 Tauri CLI 添加 plugin，并逐项检查生成改动。
3. 只在真实 composition root 注册一次，desktop/mobile 使用匹配 `cfg`。
4. 只授予功能需要的 command、resource、path、URL、window、origin 和 platform。
5. arbitrary path、secret、destructive action、transaction 和多 plugin 编排放到 Rust。
6. 为 listener、watcher、shortcut、tray、window、database connection 和 background task 定义 cleanup。
7. 验证 dependency/schema、拒绝路径、允许路径及真实 dev/packaged runtime。

## 按需读取

- Plugin 安装、自定义 plugin、Capability、scope、CSP、remote origin 与权限排错：[plugins-and-permissions.md](references/plugins-and-permissions.md)
- 文件、dialog、drag/drop、path containment、atomic write 与 watcher：[files-and-dialogs.md](references/files-and-dialogs.md)
- Store、SQLite、data directory、migration、transaction 与恢复：[state-and-persistence.md](references/state-and-persistence.md)
- 多窗口、tray、notification、global shortcut 与 lifecycle：[windows-and-notifications.md](references/windows-and-notifications.md)

## 安全边界

- Capability 是允许上限，不是业务授权；仍需在 Rust 检查当前用户、resource owner 和 operation state。
- 不用 `default` 或宽 scope 图省事，不把 dev permission 带到 production。
- frontend path/URL/window label 不可信；canonicalize 后再做 containment。
- secret 不进入 WebView、Store、日志或普通 SQLite；使用项目已有 secure abstraction/OS credential facility。
- remote WebView/content 默认不获得本地 plugin 权限，确需开放时单独建 role、origin 和 CSP。

## 完成门禁

- 安装版本和 lockfile 一致，plugin/state 只注册一次。
- generated schema 与 Capability 文件有效，目标 window/platform 能调用，非目标角色被拒绝。
- 失败、取消、window close、app shutdown 后资源已清理。
- 文件/数据库/通知等副作用使用真实临时资源或目标平台验证。
- 受影响的业务和集成文档只描述已经落地的能力。
