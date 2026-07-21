<!-- @author kongweiguang -->

# 架构与项目初始化

## 内容

- 项目基线与模块边界
- 启动组合与状态所有权
- 新项目初始化
- Window 信任角色
- 验证门禁

## 项目基线

先确认前端框架、Tauri/Rust 版本、包管理器、应用入口、plugin、Capability、Command、测试和构建脚本。已有项目先沿一条相近功能从 UI 追到 wrapper、Command、service/state；新项目从最小 Tauri 2 模板开始，第二个真实功能出现重复后再抽象。

## 边界和模块

- 前端负责展示状态、输入组合、optimistic UI 和 view lifecycle。
- Rust 负责特权 IO、filesystem path、secret、native API、durable transaction，以及不能被 WebView 绕过的策略。
- Command 负责 IPC 适配，不应成为业务规则唯一可测试位置。
- 逻辑复用、包含策略、协调资源或需要隔离测试时，才引入 service/adapter。

中等规模项目可以逐步演进为：

```text
src-tauri/src/
  lib.rs
  commands/
  services/
  domain/
  adapters/
  error.rs
  state.rs
```

不要预先创建空层级；小项目可以在 `lib.rs` 邻近保留少量内聚模块。

## 启动组合

保持一个可见 composition root，按确定顺序注册 plugin、managed state、setup、handler、window/tray callback 和 shutdown cleanup。

- 依赖资源初始化成功后再暴露使用它的 Command。
- 不通过无关 module side effect 隐式注册。
- watcher/listener 只注册一次，并保存清理 handle。
- desktop/mobile setup 使用匹配的 `cfg`。
- 启动失败尽量输出可诊断、可恢复的可见错误，避免空白 WebView。

## 状态所有权

| 状态 | 推荐 owner |
| --- | --- |
| 组件交互 | 项目已有前端组件/store |
| 跨窗口权威运行时资源 | Rust managed state |
| 小型持久设置 | app data/config 或 Store plugin |
| 可查询关系数据 | SQLite 和项目已有 data layer |
| 密钥 | OS credential facility 或已有 secure abstraction |

managed service 只暴露窄方法，不暴露全局 connection 或公共可变 map。缩短 lock scope，定义 shutdown，并避免同一权威值在 Rust 与多个前端 store 中无 reconciliation 地重复保存。

## 新项目初始化

开始前确认应用名、identifier、前端框架、包管理器、目标平台、模板来源和是否初始化 Git。没有明确授权时，不初始化 Git、不覆盖已有目录、不复制凭据。

生成后：

1. 通过结构化配置和源码引用替换 identifier。
2. 检查 `Cargo.toml`、`tauri.conf.json`、scripts、capabilities、icons 和 signing/updater placeholder。
3. 删除不属于产品范围的模板功能。
4. 按 lockfile 安装，运行前端 build 与 Rust check。
5. 启动一次 Tauri，实际执行一条 UI -> Rust 路径。

普通初始化不配置生产 updater key、signing identity、remote release target 或 CI secret，除非用户明确要求交付设置。

## Window 是信任角色

Window label 不只是名称。为 main、settings、splash、quick-entry、notification 等窗口定义允许的 route、Command、plugin 和数据，不默认共享宽 Capability。

明确 window 创建/关闭 owner、single-instance、状态同步、listener cleanup，以及目标窗口已关闭时的行为。

## 验证

- `frontendDist`、dev URL 和项目 script 一致。
- plugin、state、handler、setup 只注册一次。
- 新模块对应真实边界并有聚焦测试。
- 缺失 resource 和 startup failure 可观测、可恢复。
- Window 角色与 Capability assignment 和实际功能一致。
- clean checkout 能按项目文档完成 install、check 和 dev 启动。
