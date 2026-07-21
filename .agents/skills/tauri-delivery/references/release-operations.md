<!-- @author kongweiguang -->

# Tauri 发布执行

## 内容

- 发布边界与授权
- 版本和源码准备
- CI 矩阵与关键路径
- 原生可选依赖
- Draft、tag 与失败恢复
- 发布顺序
- 发布后验收

## 发布边界与授权

准备工作不等于远程写入授权。本地修改版本、release notes、配置和验证，不自动授权以下操作：

- commit 或修改用户已有提交；
- 创建、移动或删除 tag；
- push commit/tag，dispatch 或 rerun CI；
- 创建/删除 release，上传/删除 asset；
- 修改 CDN、对象存储、应用商店、下载页、版本索引或生产 updater endpoint；
- 将 draft/private release 公开。

在每个实际远程边界前确认用户授权、目标仓库/账号、版本、commit SHA、平台矩阵、可见性和恢复方案。凭据只使用项目既有安全机制；发布 Skill 不接管生产账号或自动扩大权限。

## 版本和源码准备

从仓库查找权威版本来源，不假设固定同步三处。常见位置包括前端 package、Cargo package、Tauri config、Android Gradle、iOS bundle 配置和文档版本索引，但只修改项目真实采用的文件。

发布候选应满足：

- 所有用户可见版本一致，release notes 只描述已实现且已验证的变化。
- 必需 lockfile、generated schema 和生成代码为当前状态。
- 工作树来源明确；不把无关本地修改、密钥或机器配置带进 release commit。
- release commit、tag 命名、channel、目标平台/架构/bundle、签名和 updater 支持已确定。
- 已运行项目要求的前端/Rust/文档快速门禁，失败项没有被后续构建掩盖。
- 移动端、便携版和桌面端是否共用版本号/tag 有明确项目规则；没有规则时不要擅自绑定。

## CI 矩阵与关键路径

安装器、系统依赖和签名优先在目标原生 runner 构建。矩阵显式列出 OS、CPU、libc、Rust target、bundle、更新产物和签名要求，`fail-fast` 是否关闭由“能否保留其它平台诊断证据”决定。

发布慢时先读取真实 job/step 时长和首次因果错误，再优化关键路径：

- 区分依赖安装、前端构建、Rust release 编译/链接、bundle、签名、公证和上传。
- Windows release job 最慢时，确认瓶颈是 Rust 冷编译还是 NSIS/MSI，而不是凭感觉优化安装器。
- Rust cache key 包含兼容的 OS、target、toolchain 与 lockfile 输入；不同 OS/target 不共享编译 target cache。
- 使用稳定且能复用的分平台 key，避免把 run id、job display name 等每次变化字段写入主 key。
- 修改 `Cargo.lock`、toolchain 或 cache key 后第一次仍可能冷编译，要用同平台后续 run 判断命中率。
- npm/pnpm 安装只占几十秒时，不为它增加复杂缓存和恢复风险。
- 缓存不得包含签名材料、凭据或不可移植的绝对路径状态。

优化前后记录同类 runner、相同 target 和可比 commit 的数据；一次偶然提速不能视为稳定收益。

## 原生可选依赖

`lightningcss`、Rollup、esbuild 等前端工具可能依赖 OS/CPU/libc 特定的 optional package。某个矩阵目标出现 `Cannot find module '*.node'` 或 optional dependency 缺失时：

1. 检查 lockfile 中目标包的版本及 `os`、`cpu`、`libc` 元数据。
2. 在真实 CI image，或系统临时目录中使用 package manager 支持的目标参数重现干净安装。
3. 验证目标 native binary 确实存在，并运行受影响平台的前端 production build。
4. 优先刷新 lockfile 或做最小元数据修复，不顺手升级无关依赖。
5. 删除临时 `node_modules`、cache 和平台模拟目录，禁止纳入提交。

如果 package manager 不支持可靠跨平台模拟，以目标 runner 的干净安装为准；不要手工复制 `.node` 文件伪造成功。

## Draft、tag 与失败恢复

矩阵构建默认先进入 draft/private release。只有 required jobs 全绿、artifact manifest 完整、签名/校验和/metadata 验证通过后才能公开。

失败后先查事实：release 是否公开、哪些 asset 已上传、tag 是否远端可见、下载/updater endpoint 是否已引用、用户是否可能已经取得版本。恢复规则：

- 未公开且未被生产端点引用的不完整 draft，可在授权后删除或清理并重跑。
- 已公开 release 或已被客户端引用的版本，不得静默删除、复用版本号或移动 tag；使用新版本 hotfix/withdrawal 流程并说明影响。
- tag 未公开但确需移动时，先获取远端 tag SHA，确认目标 commit 和授权，再使用 lease 保护更新：

```text
git ls-remote --tags origin refs/tags/vX.Y.Z
git push --force-with-lease=refs/tags/vX.Y.Z:<刚读取的远端 SHA> origin refs/tags/vX.Y.Z
```

读取 SHA 与 push 之间如远端变化，lease 必须失败并重新评估。禁止使用无条件 `--force`，也不能只比较本地 tag。删除远端 tag、release 或 asset 同样是破坏性远程写入，必须单独授权。

## 发布顺序

依据项目既有机制执行，推荐保持以下依赖顺序：

1. 构建并签名全部 required target，将文件上传到未公开 draft 或受控 staging。
2. 从真实输出生成 artifact manifest，核对名称、角色、平台、架构、大小、checksum 和 signature。
3. 从 manifest 和 `.sig` 内容生成 updater metadata、下载 metadata 与 release notes，禁止手写资产名。
4. 上传主分发端点和获授权的备用端点，下载回读并验证内容、checksum、签名和 URL。
5. 再公开 GitHub Release 或等价发布页，确认 tag 和 source commit 正确。
6. 上传 `versions.json`、download index、latest pointer 等版本索引；去重并保留项目要求的历史。
7. 如果文档站在 build time 拉取版本索引，必须先发布索引再触发文档构建；否则站点仍会固化旧版本。
8. 验证公开下载页、安装包、旧版本 updater 和新版本启动，最后记录回滚/撤回路径。

CI 直接写多个 release 仓库或生产存储，只有在凭据最小化、幂等、冲突、重试和回滚机制已固化时才可采用。否则 CI 负责生成 draft，受控后处理统一发布 metadata 和端点。

便携版只能从已验证产物按项目规则制作，单独记录文件、数据目录和干净目录启动结果。Android APK/AAB、iOS archive/TestFlight/App Store 使用独立平台验收和签名，不宣称由 Tauri desktop updater 管理。

## 发布后验收

- tag/release 指向预期 commit 和版本，公开/草稿状态正确。
- required asset 的数量、名称、target、arch、大小、checksum、代码签名与 updater signature 和 manifest 一致。
- Windows NSIS/MSI、macOS 签名/公证、Linux 包依赖在声明支持的平台完成干净安装与启动。
- 一个真实旧版本完成检查、下载、签名校验、安装、重启和数据保留。
- 主/备下载端点返回预期内容，不是 HTML 错误页、旧缓存或 draft URL。
- updater metadata、下载页、版本索引、release notes 和已实现业务文档一致。
- secret、私钥和机器配置未进入 Git、日志、artifact 或公开 metadata。
- 缺失平台、失败恢复、撤回、回滚或 hotfix 路径已经记录。
