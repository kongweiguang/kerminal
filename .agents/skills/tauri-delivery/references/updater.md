<!-- @author kongweiguang -->

# Tauri 2 桌面更新器

## 内容

- 适用边界与完整依赖链
- 密钥和配置
- Tauri 2 更新产物
- 静态与动态端点
- 应用内更新流程
- CI 与真实升级测试

## 适用边界与完整依赖链

Updater 是桌面能力。先核对项目当前 Tauri、CLI 和 plugin 版本以及既有发布基础设施，再检查整条链路：

- Rust updater plugin；应用需要重启时同时使用 process plugin。
- WebView 直接调用 API 时安装匹配版本的前端 package。
- 在真实 composition root 注册一次，并用 `#[cfg(desktop)]` 隔离移动端。
- Capability 只授权需要更新的 window，包含 updater 及实际使用的 process 权限。
- `bundle.createUpdaterArtifacts: true` 生成 Tauri 2 updater 产物。
- `plugins.updater.pubkey` 内嵌公钥内容，私钥只在获授权的签名环境使用。
- 生产 endpoint 使用 HTTPS，目标与架构映射和项目分发方式一致。

不要在共享启动路径无条件注册桌面 updater。Android/iOS 使用应用商店、平台更新机制或项目明确设计的移动端分发流程，不能复用桌面 `latest.json` 和桌面签名密钥。便携版也不是标准安装器语义，必须单独定义数据目录、写权限、替换正在运行文件和回滚策略后才能宣称支持自更新。

## 密钥和配置

更新签名不可关闭。私钥一旦丢失，已安装客户端可能无法再接受新版本；轮换公钥也可能让旧客户端失去升级路径。只有用户明确要求且兼容迁移、备份和恢复方案已经确认时，才能生成或轮换密钥。

- `pubkey` 是公钥内容，不是路径。
- 私钥及密码不进入 Git、日志、shell history、`.env`、前端 bundle、计划或 artifact manifest。
- 构建时通过项目现有 secret store 设置 `TAURI_SIGNING_PRIVATE_KEY` 和需要时的密码。
- `endpoints` 的 fallback 行为要按当前插件核对；不要假设业务错误响应会自动切换端点。
- Windows `installMode` 沿用产品已验证的交互与权限策略；`quiet` 不能自行申请管理员权限。
- 不启用不安全传输来绕过生产 HTTPS 问题。

配置键和 API 签名必须以项目锁定版本的 schema、生成类型和官方文档为准，不能从旧示例直接复制。

## Tauri 2 更新产物

使用最新版 Tauri 2 的 `createUpdaterArtifacts: true`，不为兼容 Tauri 1 改成 `"v1Compatible"`。真实构建输出始终是最终依据，典型关系如下：

| 平台 | 用户安装/分发产物 | Tauri 2 updater 使用的产物 | 签名 |
| --- | --- | --- | --- |
| Windows NSIS | `*-setup.exe` | 同一个 NSIS 安装器 | `*.exe.sig` |
| Windows MSI | `*.msi` | 同一个 MSI 安装器 | `*.msi.sig` |
| macOS | `.app` / `.dmg` | 由 `.app` 生成的 `.app.tar.gz` | `.app.tar.gz.sig` |
| Linux AppImage | `*.AppImage` | 同一个 AppImage | `.AppImage.sig` |

不要把 v1 兼容产物 `.nsis.zip`、`.msi.zip` 或 `.AppImage.tar.gz` 写入最新版 Tauri 2 更新元数据。一个 release 同时构建 NSIS 与 MSI 时，明确产品更新通道选择哪一种，不能让同一 target 随机指向不同安装器。

CI 必须上传用户可见安装包、实际 updater 产物、对应 `.sig`，以及策略要求的 checksum/provenance。只有 manifest 中存在且签名已核验的文件才能进入端点元数据。

## 静态与动态端点

静态 JSON 的平台 key 使用项目当前 Tauri 目标字符串，默认形式是 `OS-ARCH`，例如 `windows-x86_64`、`darwin-aarch64`、`linux-x86_64`。每项 URL 指向真实 updater 产物，`signature` 必须是对应 `.sig` 文件的完整文本内容，不是 `.sig` 路径或 URL。

```json
{
  "version": "X.Y.Z",
  "notes": "已发布版本的更新说明",
  "pub_date": "2026-07-15T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://cdn.example.com/app/vX.Y.Z/App_X.Y.Z_x64-setup.exe",
      "signature": "<App_X.Y.Z_x64-setup.exe.sig 的实际内容>"
    },
    "darwin-aarch64": {
      "url": "https://cdn.example.com/app/vX.Y.Z/App.app.tar.gz",
      "signature": "<App.app.tar.gz.sig 的实际内容>"
    }
  }
}
```

规则：

- `version`、每个平台的 `url` 和 `signature` 必须完整；只列出实际构建并验证的平台/架构。
- Tauri 会在比较版本前验证整个静态文件，因此不能保留半成品平台条目。
- `pub_date` 使用 RFC 3339；版本、notes、URL、signature 与 artifact manifest 一致。
- 多分发端点可以替换 URL base，但同一产物的版本、checksum 和 signature 不变。
- 动态端点无更新时按插件契约返回 204，有更新时返回当前版本要求的完整 JSON。
- 上传后验证 HTTPS 状态、响应体、content type、缓存策略、重定向和每个真实文件；仅 `HEAD 200` 不证明下载内容正确。

## 应用内更新流程

- 在产品合适的时机检查，并保留手动重试入口。
- 避免重复并发检查、下载或安装；用 operation identity 管理一次更新。
- 在破坏性下载/安装前按产品要求展示版本与 notes 并取得用户意图。
- 进度事件节流，处理未知总长度，不让高频回调阻塞 UI。
- 明确处理无更新、离线、endpoint 非法、metadata 缺失、签名失败、目标不匹配、下载中断、磁盘不足、安装失败、重启延期和再次尝试。
- 签名或 target 不匹配时必须终止，不能提供“继续安装”绕过。
- 下载和安装 API、callback 字段、relaunch/restart 方式以项目实际 plugin 版本为准。

## CI 与真实升级测试

各 OS/架构在原生 runner 构建签名，签名 secret 只进入对应 step。矩阵未齐全前保持 draft，收集产物后从 manifest 和 `.sig` 生成 metadata，并做结构化校验。

最终验收必须从一个真实发布且由旧客户端信任的版本开始：

1. 在干净环境安装旧版本，确认其版本、更新 endpoint 与公钥均为真实发布配置。
2. 验证检查更新、notes、下载进度、签名校验、安装、重启和新版本号。
3. 验证用户数据、数据库、配置、窗口状态等升级后保留策略。
4. 人为制造一次网络中断或失败响应，确认 UI 可恢复且不会留下半安装状态。
5. 在每个声明支持的平台/架构至少完成一次真实链路；未覆盖项明确记录。

当前版本的 dev build、mock 响应或只验证 metadata JSON 都不能证明更新链路可用。
