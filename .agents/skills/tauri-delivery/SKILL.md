---
name: tauri-delivery
description: |
  Tauri 2 打包、代码签名、桌面更新器、CI 发布编排、产物发布、下载元数据和已落地发布文档。用于构建 NSIS/MSI/DMG/AppImage/DEB 等交付物，配置 bundle、signing 或 updater，准备或发布桌面/移动端版本，排查发布 CI 与原生可选依赖，或根据真实产物更新下载页和版本索引。普通开发构建不要使用此 Skill。
---

<!-- @author kongweiguang -->

# Tauri 交付

把打包、签名、更新、发布和文档视为一条产物链，但分别设置验证门禁。文件名、平台、架构、大小、校验和、签名和 URL 必须来自真实输出，不能从模板或记忆猜测。

## 选择范围

| 需求 | 按需读取 |
| --- | --- |
| 本地安装包、bundle 配置、资源、sidecar 或代码签名 | 打包与签名 |
| 桌面应用内检查、下载、安装和重启更新 | 桌面更新器 |
| 版本、tag、CI 矩阵、draft、上传、公开和失败恢复 | 发布执行 |
| 下载页、版本索引、发布说明或已实现业务文档 | 发布与业务文档 |

本地打包失败时不要加载全部发布资料。

## 交付流程

1. 读取真实 package manager script、lockfile、Tauri/Cargo 配置、目标平台、CI、签名与 updater 设置，以及上一版产物。
2. 明确本次边界：本地构建、签名候选、未公开 draft，还是公开发布。
3. 只同步仓库中真正权威的版本与配置文件，不套用固定文件清单。
4. 先运行前端和 Rust 快速验证，再进入耗时的目标平台 release build。
5. 在目标 OS/架构构建，依据真实输出生成结构化 artifact manifest。
6. 验证应用身份、版本、架构、签名、校验和、安装启动、更新元数据和平台矩阵。
7. commit、tag、push、CI dispatch、上传、端点变更和公开发布均须获得对应远程写入授权；不完整产物保持未公开。
8. 根据已验证产物更新 release notes、下载页和版本索引，再验证真实下载、干净安装和旧版本升级链路。

## 按需读取

- bundle 格式、资源、图标、sidecar、签名、manifest 和安装验收：[packaging-and-signing.md](references/packaging-and-signing.md)
- updater 插件、Capability、密钥、端点、Tauri 2 产物和真实升级测试：[updater.md](references/updater.md)
- 版本、tag、CI、draft、原生依赖、发布顺序和失败恢复：[release-operations.md](references/release-operations.md)
- 代码与业务文档一致、下载页、版本索引和文档站发布：[documentation.md](references/documentation.md)

远程命令和上传同时使用 `updeng-remote-ops-safety`；性能、体积或更广测试设计使用 `tauri-quality`；Android/iOS 原生构建与权限使用 `tauri-mobile-development`。

## 安全边界

- 不打印、提交、暂存或嵌入签名私钥、密码、token、keystore、provisioning profile 或远程凭据。
- 未经明确授权，不 push commit/tag、不移动 tag、不上传产物、不公开 release，也不修改生产 updater/download 端点。
- 必需平台、签名和元数据未齐全前，release 保持 draft/private。
- 已公开版本失败后不得静默复用版本号或移动 tag；说明影响并使用新版本恢复。
- 不为普通发布任务擅自生成、轮换或替换生产签名密钥。

## 完成门禁

报告实际执行的验证与构建命令、manifest 中的产物和架构、签名与 updater 验证、真实检查过的公开端点、同步的文档、未验证平台，以及回滚或修复路径。仅本地编译成功不等于发布成功。
