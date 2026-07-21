<!-- @author kongweiguang -->

# 状态与本地持久化

## 选择存储

| 数据 | 推荐位置 |
| --- | --- |
| 临时组件状态 | 前端现有 state/store |
| 跨窗口权威运行时资源 | Rust managed state |
| 少量偏好与简单 key/value | Store plugin 或结构化 app config |
| 查询、关系、事务、历史 | SQLite 和项目已有 data layer |
| 密钥、token、私钥 | OS credential facility/secure storage |

不要因为已安装 SQLite 就把所有设置写表，也不要把可恢复的重要状态只留在前端 localStorage。

## 数据目录与身份

使用 Tauri path API/项目 abstraction 解析 app data、config、cache、log、resource 目录；不依赖 cwd 或源码路径。明确 portable mode、多 profile、多用户、workspace identity、备份与卸载语义。

对 workspace/project 记录优先暴露 opaque ID 和 display metadata；canonical absolute path 留在 Rust persistence boundary，避免通过 IPC、日志或 metrics 泄漏。

## Store 与配置文件

- 定义 schema version、default、unknown field 和损坏恢复。
- 写入采用 atomic replace，避免部分 JSON。
- 多窗口/多进程写入要有单 writer、lock 或明确 last-write policy。
- 不在普通 Store 保存 credential、signing material 或生产 secret。
- preference 与 runtime truth 分离，避免启动时用陈旧缓存覆盖权威状态。

## SQLite

- migration 只前进且有版本记录；升级前备份/恢复策略与数据风险匹配。
- 项目没有现成 migration framework 时，可用 SQLite `PRAGMA user_version` 作为 schema 版本源：读取当前版本，拒绝高于应用支持范围的数据库，按版本顺序执行每个迁移，并在同一个 transaction 内完成 DDL/数据变换和 `user_version=N` 更新。只有全部步骤成功才 commit；失败必须 rollback，不能先写版本号再执行迁移。
- 非平凡迁移先用真实旧版本 fixture 做逐版本和跨版本升级，验证重复启动不会二次改写；涉及不可逆数据变换时在 transaction 外先完成可恢复备份，并验证该版本确实能恢复。
- schema、query 和 transaction 在 data layer，Command 不拼 SQL。
- 使用 parameter binding，限制 query/result size，定义 busy timeout 和 connection ownership。
- 跨表更新用 transaction；外部副作用与 DB 不能原子时记录 operation state/补偿。
- migration/corrupt DB 失败不能静默丢数据；隔离、quarantine 或只读恢复，并向用户给出明确状态。
- 删除父记录时明确 session/cache/history 的 cascade 或保留规则。

## Session 恢复

持久化 path 使用 workspace-relative、版本化结构。恢复 tabs、cursor、selection、scroll、expanded tree、layout、active tool、navigation history 时逐项验证路径仍在 root、资源仍可用、版本兼容。

单个 session 损坏应隔离，不影响其它 workspace。后端有 save/load API 不等于 UI 已经接入自动保存和第二次启动恢复；业务文档必须区分这两个事实。

## 并发与清理

缩短 connection/lock scope，不跨 `.await` 持同步 guard。background flush 有 debounce、shutdown flush 上限和失败可见性。测试并发写、进程中断、磁盘满、只读目录、migration failure 和恢复后再次写入。

## 验证

- fresh DB、逐版本/跨版本 migration、重复 migration、transaction 中途失败与 rollback、unsupported newer version。
- transaction rollback、constraint、busy/concurrent access。
- corrupt config/session/DB 的隔离、备份和重建。
- absolute/parent path rejection 与 atomic failure。
- restart 后真实读取，不只测试 serialize/deserialize。
- 数据目录、日志、备份和导出中没有 secret 或不必要绝对路径。
