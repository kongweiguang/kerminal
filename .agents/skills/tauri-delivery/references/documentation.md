<!-- @author kongweiguang -->

# Tauri 发布与业务文档

## 内容

- 事实来源与文档归属
- 代码和业务文档同步
- 下载页与版本索引
- Command 与权限说明
- 构建和发布验证

## 事实来源与文档归属

文档只从已实现代码、当前配置、测试结果和已验证产物提取事实。不得把设计方案、计划功能或尚未合并的行为写成当前能力，也不能猜 Command、permission、文件名、平台、架构、签名或 URL。

沿用仓库现有文档体系，不因为 Skill 曾使用某个框架就引入 VitePress、Docusaurus 或新的 metadata 格式。典型归属：

| 内容 | 放置位置 |
| --- | --- |
| 当前代码已经实现的具体业务规则、状态和边界 | `.updeng/docs/business/<业务模块>/` 或项目现有业务文档 |
| 方案、原型、备选设计、调研资料和未实现需求 | `.updeng/docs/discovery/<业务模块>/` 或项目现有 discovery 区域 |
| 开发、构建、调试与环境要求 | README 或现有开发指南 |
| 用户可执行任务和真实产品行为 | 现有用户指南 |
| 稳定公开 Command/API 契约 | 现有 API/reference 文档 |
| Plugin、Capability、权限和安全约束 | 安全/权限文档 |
| 下载、平台支持和版本历史 | 下载页与版本索引 |
| 本次用户可见变化 | release notes/changelog |

一个详细事实只保留一个权威位置，其它位置链接引用，避免复制后漂移。

## 可选源文档映射

项目已经维护文档站，或用户明确需要按源码增量同步时，可以在现有文档站根目录采用结构化映射；不要仅因使用本 Skill 就引入 VitePress、Docusaurus 或新 metadata。沿用已有格式；没有格式时可使用最小 `.docs-meta.json`：

```json
{
  "schemaVersion": 1,
  "sourceRoot": "../app",
  "updatedAt": "<ISO-8601>",
  "mappings": [
    {
      "source": "src-tauri/src/commands/account.rs",
      "document": "docs/reference/commands.md",
      "section": "account",
      "sha256": "<source-content-hash>"
    }
  ]
}
```

映射只回答“哪个源码事实由哪篇文档的哪个章节拥有”，不保存任务状态或生成整篇文档。增量同步时读取实际 diff，验证旧 hash，只修改受影响章节并保留人工内容；全量重建只在结构腐化、大重构或用户明确要求时进行。更新映射后运行项目真实 docs build、死链/引用检查，并核对生成内容仍来自已实现代码和验证产物。

## 代码和业务文档同步

功能落地时检查受影响业务模块，而不是只更新 release notes：

1. 从实际入口追踪 UI -> wrapper -> IPC/Plugin -> Rust service -> state/storage/OS 副作用。
2. 记录当前已经生效的业务目标、触发条件、角色/权限、关键状态、核心规则、副作用、失败/恢复和数据边界。
3. 删除或修正已被代码替代的旧行为；保留仍真实存在的人工说明。
4. 设计决策和候选方案留在 discovery，只有实际实现的结果进入 business。
5. 使用代码、测试和真实运行结果复核文档，不根据计划文档宣称完成。

业务文档描述“系统现在如何工作”，不是功能宣传、接口清单、TODO 或设计提案。纯内部重构若业务行为没变化，只需确认原文仍准确；不要制造无内容的文档改动。

## 下载页与版本索引

下载项和版本记录从 artifact manifest 构造，只列出已验证平台。按产品现有体验记录必要的版本、平台、架构、格式、系统要求、文件大小、checksum/signature 状态和最终 URL。

- 新版本按项目规则插入并去重，保留要求的历史版本和撤回状态。
- updater metadata、download index、latest pointer 和下载页必须指向同一真实产物。
- 主/备端点切换只改变 URL 时，checksum 与 updater signature 仍应一致。
- 上传后下载回读并验证内容；不能只看对象存在或 `HEAD 200`。
- 文档站若构建时抓取版本索引，先上传索引，再触发站点构建与部署。
- 发布后检查页面没有 draft/private URL、旧缓存、错误架构或尚未公开的资产。

触发文档部署、写对象存储或修改生产站点属于远程写入，仍需明确授权。

## Command 与权限说明

只记录稳定公开行为，不把内部函数逐个抄进文档。确有外部使用价值时说明：

- Command/plugin 能力的用途、输入、输出、稳定错误码和副作用。
- 允许调用的 window/role/platform、Capability permission 和 scope。
- 取消、超时、重试、幂等和数据保留行为。
- 一个最小安全示例。

名称和 wire field 从真实 `generate_handler!`、`#[tauri::command]`、serde DTO、generated schema、Capability 和前端 wrapper 获取。公开文档不得暴露内部路径、secret、私有 endpoint、token 或为了方便而给出的无限 scope。

## 构建和发布验证

- 运行仓库实际 docs build、link/reference check 和 schema/metadata 校验。
- 检查下载、安装、自动更新、权限和本次业务变更页面。
- 核对所有样例使用当前 API、package 版本和真实字段。
- 验证版本索引与公开 release、manifest、URL、checksum 和 signature 一致。
- 记录无法验证的文档部署、平台页面或外部缓存，不把本地预览当线上完成。
