<!-- @author kongweiguang -->

# Tauri 打包与签名

## 内容

- 构建基线
- Bundle、资源与 sidecar
- 签名与密钥
- 真实产物清单
- 平台验收
- 排错顺序

## 构建基线

先读项目实际 package manager script、lockfile、`src-tauri/Cargo.toml`、`tauri.conf.json`、平台覆盖配置、CI 和上一版产物。使用 lockfile 对应的 Tauri CLI、Rust toolchain 与 bundle target，不默认使用 `pnpm`，也不直接复制 Skill 中的静态配置块。

进入打包前确认：

- 前端 typecheck、测试和 production build 通过，`beforeBuildCommand` 与 `frontendDist` 指向真实输出。
- Rust fmt、check、测试通过，所需 target 和系统依赖已经安装。
- `identifier`、`productName`、版本来源、目标平台、架构和 bundle 格式明确。
- 目标是开发包、无签名候选、签名候选还是可发布产物。
- 配置键已用项目当前 Tauri 2 schema 或官方文档核对。

只构建项目声明支持且本次要求的格式和架构；不要用 `targets: all` 代替平台矩阵设计。

## Bundle、资源与 sidecar

- 应用标识、版本和显示名称在各权威文件中一致。
- 仅包含运行必需的资源、图标、license、sidecar 和动态库。
- 运行时通过 Tauri path/resource API 定位资源，不依赖源码目录、当前工作目录或开发机绝对路径。
- sidecar 文件名、target triple、执行权限和动态库架构与目标平台一致；调用参数、超时和输出大小必须有界。
- 从项目批准的源图生成平台图标，并实际检查 Windows icon、macOS app icon、Linux desktop icon 和需要的移动端图标。
- 安装路径含空格、非 ASCII 字符和普通用户权限时仍能启动并读到资源。
- 按发布策略保留 symbol、source map、SBOM 或 provenance；不要为减小安装包而删除事故定位所需材料。

## 签名与密钥

沿用项目已有签名机制和 CI secret store，只在最小构建/签名步骤注入凭据，关闭可能回显 secret 的命令跟踪。普通打包任务不得擅自生成、替换或轮换生产密钥。

- Windows：验证目标可执行文件与 NSIS/MSI 的 Authenticode 签名、证书链和可信时间戳。
- macOS：验证签名 identity、entitlements、hardened runtime；对站外分发完成 notarization 和 stapling，并在 Gatekeeper 环境复验。
- Linux：验证包元数据、checksum，以及发行仓库采用的包签名；代码签名规则不能照搬 Windows/macOS。
- Android/iOS：仅使用获授权的 keystore、certificate 和 provisioning profile；不得复用桌面 updater 私钥。

私钥、密码、token、证书导出文件、keystore、provisioning profile 不进入 Git、日志、前端 bundle、artifact manifest 或普通任务文档。密钥丢失、过期或轮换必须先给出已安装客户端兼容与恢复方案。

## 真实产物清单

从实际 bundle 输出目录生成机器可读的 artifact manifest，不从预期文件名反推。每个产物至少记录：

```json
{
  "schemaVersion": 1,
  "version": "X.Y.Z",
  "sourceCommit": "<commit-sha>",
  "artifacts": [
    {
      "fileName": "<actual-file-name>",
      "role": "installer|updater|signature|symbols|metadata",
      "target": "windows|darwin|linux|android|ios",
      "arch": "x86_64|aarch64|...",
      "bundle": "nsis|msi|dmg|app|appimage|deb|apk|aab|...",
      "sizeBytes": 0,
      "sha256": "<actual-sha256>",
      "signatureFile": "<relative-path-or-null>",
      "signingStatus": "verified|unsigned|not-applicable"
    }
  ]
}
```

清单中的 `path` 或 `signatureFile` 只用于受控构建目录定位，公开 metadata 另写最终 URL。发布前检查清单没有重复 target/arch/role、未知文件、缺失签名或零字节产物。上传后再补充远端 asset ID/URL 和远端 checksum 验证结果，不覆盖本地原始事实。

## 平台验收

### Windows

- 分别验证本次声明支持的 NSIS 和 MSI；不能用其中一个成功代替另一个。
- 检查安装范围、UAC、升级覆盖、快捷方式、协议/文件关联、安装目录、卸载和用户数据保留。
- 核对安装器与实际可执行文件的签名和架构，在干净普通用户环境启动。

### macOS

- 检查 `.app` 与 DMG 中应用的一致性、bundle id、版本、架构、entitlements 和嵌套二进制签名。
- 验证 notarization/stapling 结果，并从下载后的 DMG 在干净机器执行 Gatekeeper 首次启动。
- 同时支持 Intel/Apple Silicon 时分别构建验证，或证明 universal binary 的两个 slice 完整。

### Linux

- 分别验证声明支持的 AppImage、DEB、RPM 等格式、架构、desktop entry、icon、依赖和卸载行为。
- 在目标发行版或对应容器/VM 做干净安装与启动；开发机已有动态库不能作为依赖完整性的证明。
- 核对 checksum、包元数据和 AppImage 可执行权限。

所有平台还要检查显示名称/版本、资源、sidecar、数据目录、升级后数据、卸载边界，以及产物中不存在私钥、开发配置、源码专用数据或意外文件。

## 排错顺序

按第一条因果错误依次检查：前端构建与输出目录、Rust target/系统依赖、Tauri schema、资源/sidecar 路径、架构、代码签名/公证、安装器工具、安装后路径与权限。不要被后续级联错误带偏。
