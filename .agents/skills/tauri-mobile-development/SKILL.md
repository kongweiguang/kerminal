---
name: tauri-mobile-development
description: |
  Tauri 2 Android/iOS 移动端开发与平台适配。用于初始化、构建或改造移动端项目，处理平台入口、移动端 Capability、Android manifest、iOS Info.plist、原生权限、响应式交互、设备能力和真机验证。纯桌面功能、桌面 updater 或公开发布使用对应专项 Skill。
---

<!-- @author kongweiguang -->

# Tauri 2 移动端开发

## 基线判断

移动端不是桌面打包格式的变体，而是单独的原生目标：

- Android 需要 Android Studio、Android SDK/NDK、模拟器或真机。
- iOS 只能在 macOS + Xcode 环境构建和运行。
- 不是所有桌面插件都支持移动端；每个插件先查官方支持平台。
- 文件、通知、定位、相机、NFC、生物识别等能力还要配置原生平台权限。

## 初始化和运行

通过项目实际 Tauri CLI 入口运行 `tauri android init/dev/build` 或 `tauri ios init/dev/build`。入口可能来自 lockfile 对应的 package manager script 或 `cargo tauri`；先读项目脚本，不固定为 `pnpm`。如果子命令不可用，核对当前 Tauri CLI 版本、移动端 prerequisites 和 `tauri --help`，不要先盲目升级。

## Rust 入口

共享 `run()` 时保留移动入口宏：

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
            }

            #[cfg(mobile)]
            {
                // 注册移动端可用插件或移动端专用初始化。
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

原则：

- 桌面专用插件用 `#[cfg(desktop)]` 包住。
- 移动端专用原生逻辑用 `#[cfg(mobile)]` 包住。
- 公共 Command 保持跨平台；平台差异下沉到 service 或 adapter。

## Capability 拆分

桌面和移动端分别使用对应 schema，并用 `platforms` 限定：

```json
{
  "$schema": "../gen/schemas/mobile-schema.json",
  "identifier": "mobile",
  "description": "Mobile permissions",
  "windows": ["main"],
  "platforms": ["iOS", "android"],
  "permissions": [
    "core:default",
    "barcode-scanner:allow-scan",
    "biometric:allow-authenticate",
    "geolocation:allow-get-current-position"
  ]
}
```

桌面权限不要混进移动端：

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "desktop",
  "description": "Desktop-only permissions",
  "windows": ["main"],
  "platforms": ["linux", "macOS", "windows"],
  "permissions": [
    "updater:default",
    "global-shortcut:allow-register",
    "window-state:default"
  ]
}
```

## 原生平台权限

Tauri Capability 只控制 WebView 调用 Tauri API；移动端还需要原生系统权限。

| 能力 | Android/iOS 关注点 |
|------|--------------------|
| 相机/扫码 | Android manifest 权限，iOS Info.plist usage description |
| 定位 | 前台/后台定位权限与用途说明 |
| 通知 | 系统通知授权和平台版本差异 |
| NFC | 设备能力、平台 entitlement/manifest |
| 生物识别 | 设备能力、系统认证回退 |
| 文件访问 | 移动端 sandbox，避免假设任意文件路径可读写 |

不要只改 `src-tauri/capabilities` 就认为移动端权限已完成；还要验证原生配置和真机授权弹窗。

## 前端适配

- 使用响应式布局和触摸交互，不把 desktop hover/右键作为唯一入口。
- 处理软键盘遮挡、状态栏/安全区、窄屏溢出。
- 避免依赖桌面窗口 API，如最小化、最大化、系统托盘、全局快捷键。
- 对扫码、定位、通知等能力做不可用状态和权限拒绝状态。
- 对移动端路由首屏和资源体积做单独性能检查。

## 文件和数据

- 应用配置优先用 `tauri-plugin-store` 或移动端可用的受控目录。
- 业务数据库可继续走 Rust + SQLite，但路径要用 `AppHandle.path()`，不要硬编码桌面路径。
- 用户导入导出文件时优先用插件或原生 picker，不要直接要求 `$HOME`、`$DOCUMENT`。

## 验证清单

- [ ] 当前项目的 `tauri android dev` 或 `tauri ios dev` 入口能启动。
- [ ] 桌面专用插件已用 `#[cfg(desktop)]` 隔离。
- [ ] 移动端 Capability 使用 `mobile-schema.json` 和 `platforms`。
- [ ] 原生 manifest/Info.plist 权限与插件能力一致。
- [ ] 真机验证权限授权、拒绝、再次尝试的 UI 流程。
- [ ] 文件路径、数据库路径、通知、定位、扫码等功能在目标平台实测。

## 常见错误

| 错误做法 | 正确做法 |
|---------|---------|
| 把桌面插件直接注册到移动端 | 用 `#[cfg(desktop)]` 条件注册 |
| 只配置 Capability，不配原生权限 | 同步 Android/iOS 原生权限说明 |
| 假设移动端有 `$HOME`/`$DOCUMENT` 桌面语义 | 使用应用 sandbox 和平台 picker |
| 只在模拟器验证 | 涉及硬件能力时用真机验证 |
| 移动端复用桌面窗口控制 UI | 去掉最小化、最大化、托盘、全局快捷键等桌面概念 |
