<!-- @author kongweiguang -->

# Tauri 性能与资源诊断

## 先定义指标

明确用户场景、目标平台、debug/release、数据规模、冷/热状态和预算。常见指标：

- process start 到首个可交互 frame。
- Command/service p50、p95、错误率和取消延迟。
- IPC payload 大小、序列化时间和事件频率。
- CPU、RSS、thread、handle、child process、listener/window/model 数量。
- frontend route/chunk、render/layout、输入响应。
- binary、resource、sidecar、installer 和 updater artifact 大小。

预热后多次测量，保留机器、OS、架构、toolchain、commit 和样本分布。单次更快或 debug binary 更小不能证明生产回归已修复。

## 启动

把启动拆成 Rust process/setup、plugin/state 初始化、window 创建、frontend asset/load、hydration/render、首个 IPC。加入轻量 timestamp/span，找真实 critical path。

- 非关键 migration/index/network 延后，但必须有可见状态和失败恢复。
- 不重复初始化 plugin、DB、watcher 或 preload 巨大数据。
- production 资源从 bundle/app data 解析，不扫描源码/cwd。
- cold start 与 warm start 分开报告。

## Rust、IPC 与资源

- 计时真实 service/IO，不只测 Command dispatch。
- 查找 async executor 上的 blocking、过大 lock scope、无界 concurrency/queue/retry/output。
- 避免重复打开文件/DB、重复全量 hash/serialization 和高频 Event。
- subprocess output、watcher、Channel、cache 和 background task 有上限。
- 使用项目已有 tracing/profiler；先加窄 span，再引入新 profiling dependency。
- 重复操作后检查 memory、thread、handle、child、listener、window 是否回稳。

长稳测试至少覆盖启动/关闭、workspace/window 切换、打开/关闭资源、取消与失败重试。发现增长时区分缓存上限、延迟释放和真实 leak。

## WebView 与前端

- 用浏览器性能工具区分 script、render、layout、network 和 bundle load。
- progress 做 throttle/batch，不按每字节/循环 render。
- 大列表确实需要时 virtualize，并限制 IPC 结果进入全局 state 的规模。
- 排查重复 subscription、全局 state 扩散、eager route、巨大 dependency 和 model 未 dispose。
- 优化不能破坏输入响应、keyboard、screen reader 和错误反馈。

## 体积

分别比较 uncompressed Rust binary、frontend assets、resources、sidecars、symbols 和最终 installer/updater artifact。先用 dependency/feature/bundle analyzer 找贡献，再决定 feature、compression、strip、LTO 或 codegen 配置。

每项取舍要验证 build time、crash diagnostics、startup、签名和 updater 行为；不要为了体积删除必要 license、runtime library 或 recovery data。

## 报告格式

写清 baseline、假设、instrumentation、修改、after result、variance、正确性回归和未验证平台。性能门禁应能重复执行，并把机器/版本/p50/p95 与预算一起保存。
