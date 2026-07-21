<!-- @author kongweiguang -->

# Plugin、Capability 与权限

## 依赖与注册

先确认项目 Tauri 2、plugin 和 JS package 的实际版本。优先用项目的 Tauri CLI 添加官方 plugin，再审查它修改的 `Cargo.toml`、frontend package、Capability 和 Rust registration；不要混用其它 major 版本示例。

plugin 只在真实入口注册一次。desktop/mobile 专用能力使用匹配 `cfg`，并确保前端调用也有平台分支和可理解的 unavailable 状态。

自定义 plugin 只有在多个 Command/平台实现共享清晰边界时才值得建立；单个项目内部策略通常保留在 service + Command 更直接。

## Capability 设计

按 window role 和产品能力拆分，而不是给所有窗口一个巨大 permission 集合。逐项确认：

- `identifier` 唯一且用途明确。
- `windows` 只包含需要该能力的 label。
- `platforms` 与实际注册和 UI 一致。
- permission command 与插件当前 schema 一致。
- scope 只允许所需 path、URL、resource 或 operation。
- remote origin 只有在确有远程 WebView/content 时才配置。

Capability 只控制 WebView 能否到达能力；Rust 仍要验证 path containment、resource ownership、user authorization、rate/size limit 和 destructive confirmation。

## Scope 与 CSP

- 路径 scope 使用 app-specific data/config/resource 位置或明确用户选择结果，不开放整个 home/disk。
- URL scope 固定 scheme/host/path，避免任意 HTTP、shell 或 deep-link 转发。
- CSP 从现有策略最小扩展；不为解决单个加载错误直接加入宽 `*`、`unsafe-eval` 或任意 connect source。
- 开发服务器需求与 production CSP 分开处理。
- 外部 HTML/markdown/url 不因为在 WebView 渲染就获得本地 plugin 权限。

## 前端直调还是 Rust Command

前端可以直接使用无额外业务策略、scope 已足够表达授权的官方 plugin API。以下情况必须经 Rust：

- path/URL 由业务资源或用户权限决定。
- 涉及 secret、credential、签名或生产配置。
- 多步事务、幂等、审计或 destructive operation。
- 需要组合多个 plugin/native API 并保证一致恢复。

## 权限故障排查顺序

1. 前端 package 与 Rust plugin 是否同一兼容版本。
2. plugin 是否在真实 app entry 注册。
3. 当前 window label 是否匹配 Capability。
4. permission identifier 和 scope 是否符合 generated schema。
5. platform/`cfg` 是否排除了当前目标。
6. CSP、remote origin 或 URL/path scope 是否拒绝。
7. packaged 环境的 resource/path 是否不同于 dev cwd。

同时验证一个允许调用和一个拒绝调用。不要通过扩大到全局权限“验证修复”。
