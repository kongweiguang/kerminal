<!-- @author kongweiguang -->

# Window、Tray 与通知

## Window 角色与生命周期

把 window label 当信任角色。为每个窗口定义创建 owner、单例/多实例、route、Capability、初始数据、close/hide 行为、状态同步和销毁清理。

- 查找窗口可能失败，不对动态 window 使用无保护 `unwrap`。
- 创建并发要防重复，关闭过程中不再投递私有事件。
- window close/hide/minimize-to-tray 语义明确，不让后台资源意外常驻。
- 自绘标题栏保留 drag region、minimize/maximize/restore/close、键盘和 accessibility。
- multi-monitor、DPI、Snap、恢复位置需在真实目标平台验证。

## 多窗口通信

权威数据放 Rust managed service 或已有 durable store；窗口通过 query + scoped event 同步。新窗口/重载先读取 snapshot，再订阅增量。Event payload 带 resource/operation identity，不全局广播 private data。

listener 注册、window close 和 async callback 有竞态；保存并调用 `unlisten`，backend sender 也要在 receiver/window 消失时终止或降级。

## Tray

Tray menu/action 只注册一次，并与当前 window/state 保持一致。明确：

- 左/右键与 menu item 行为。
- show/focus main window、退出、后台运行和重复启动。
- window 全关后是否仍运行，以及显式 Quit 如何清理 watcher/process/DB。
- 不支持 tray 的平台如何隐藏或降级。

## Notification

通知前检查平台支持、permission 和产品时机。permission denied 是正常状态；不要循环请求或在无用户意图时打开系统设置。

通知内容不包含 token、完整路径、敏感正文或生产 payload。点击通知时使用受控 opaque ID/deep link，由 Rust 验证资源和权限；过期资源给出安全失败。

## Global Shortcut 与系统事件

快捷键注册需要冲突/拒绝处理、设置持久化、窗口/应用 lifecycle cleanup 和平台差异。不要覆盖系统保留组合；修改快捷键时先 unregister 旧值，失败则恢复一致状态。

系统主题、single-instance、deep link、power/session 等事件需要去重、作用域和启动竞态处理；先恢复权威状态，再消费增量事件。

## 验证

- 窗口重复创建、关闭竞态、target missing 和 listener cleanup。
- tray show/hide/quit 与后台资源终止。
- notification allow/deny、点击、过期 resource 和隐私。
- global shortcut conflict、重注册、restart 和 unsupported platform。
- 自绘标题栏在 Windows/macOS/Linux 目标矩阵的真实行为。
