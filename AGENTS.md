# AGENTS.md

## 前端主题约束

- 新增或修改页面、组件、弹框、菜单、下拉、toast、portal 和独立窗口时，必须同时验证浅色、深色和跟随系统主题；颜色优先使用项目主题 CSS 变量或成对的 Tailwind `dark:` 样式，不新增只在单一主题可读的硬编码色彩。
- 弹层和 portal 必须能继承全局主题上下文；新增独立窗口或 portal 入口时复用 `useDocumentTheme`，不要只把 `.dark` / `data-theme` 挂在局部容器上。

## 启动验证约束

- 功能开发、修复或重构完成前，必须保证应用程序可以正常启动；前端改动至少运行 `npm run build` 并做真实 dev server 启动冒烟，涉及 Tauri/Rust/窗口/权限时还要验证 `npm run tauri:dev` 或明确说明无法运行原因。
- 发现白屏、启动失败、动态导入失败、Vite `Outdated Optimize Dep`、Tauri 窗口打不开等启动阻断问题时，先修复到可启动状态，再交付其它功能结果。
- `src-tauri/tauri.conf.json` 的 `app.security.freezePrototype` 不要改回 `true`，除非已经完成 WebView 依赖兼容验证并跑通真实 `npm run tauri:dev`；遇到 `Cannot assign to read only property 'toString'` 时，优先检查该配置和 `@xterm/xterm` 启动兼容补丁。

## 功能变更兼容约束

- 新增或修改功能时，必须保持已经正常工作的功能不被破坏，包括既有入口、交互流程、快捷键、配置格式、数据读写、运行时行为和公开契约。
- 若确实需要改变已有行为，先说明影响范围、迁移或回滚口径和验证方式；实现后至少覆盖新增/修改功能及相邻既有功能的回归验证，不把无关重构、格式化或“顺手修”混入同一变更。

## Kerminal MCP 与外部 Agent 边界

- Kerminal MCP Server 面向 Codex 和其它 MCP host 时只提供运行态 tools；host 自己负责工具确认、审批、权限、hook 和审计。
- 文件型配置优先由 agent 直接编辑工作区文件并运行 validator，不通过 MCP CRUD：`settings.toml`、`profiles/*.toml`、`hosts/groups.toml`、`hosts/*.toml`、`snippets/*.toml`、`workflows/*.toml`。
- 修改 Kerminal 配置文件前必须先读配置规则：仓库内当前规则是 `.updeng/docs/biz/configuration-workspace.md`，历史详细手册在 `.updeng/docs/archive/legacy-docs-20260630/config/kerminal-config-files.md`，外部 `~/.kerminal` 工作目录内是生成的 `kerminal-config.md`；规则必须说明文件用途、关联关系、字段含义、示例、禁止项和 validator。
- 主机凭据保存走 encrypted vault；`hosts/*.toml` 只保留 `secret_ref` / `key_passphrase_ref` 等 vault 引用，禁止写入 `password`、`credential_secret`、`inline_private_key`、key passphrase 或私钥正文。
- 不要为 settings/profile/host/snippet/workflow、UI 编排、历史写入或旧 pending/confirm/approval/audit 重新增加 MCP tools；这些能力应由文件操作、现有前端交互或 MCP host 策略承担。
- MCP tools 只保留必须依赖 live app、既有终端 session、保存连接凭据、SSH/SFTP、tmux、容器（含 `container.files.list`、`container.files.preview`、`container.files.write_text`、`container.files.upload`、`container.files.download`、`container.files.create_directory`、`container.files.rename`、`container.files.chmod`、`container.files.delete` 等容器内文件读写、传输和路径管理能力）、端口转发、服务器信息、命令历史查询或诊断的能力。
- `kerminal.app_guide` 是外部 Agent 的应用导航入口，返回 Kerminal 左栏、终端工作区、右栏工具、Agent 会话和配置 workspace 与 MCP 工具族的对应关系；`kerminal.config_guide` 返回与生成的 `kerminal-config.md` 同源的配置规则正文；`kerminal.capabilities` 是 MCP 工具自发现入口；`kerminal.tool_help` 按 toolId、family 或 query 返回 schema、示例参数、安全标注和故意缺席工具族说明；`kerminal.operation_guide` 是按任务意图返回工具调用顺序的操作指南，`kerminal.runtime_snapshot` 是当前运行态概览入口；新增或移除运行态工具族时，同步更新这些工具返回内容、工作空间初始化模板和外部 Agent 文档。
- 会话级工作空间必须写入 `context/mcp-endpoint.json`、`context/target-binding.json` 和 `context/terminal-snapshot.json`；`AGENTS.md` / `CLAUDE.md` 模板必须提示先读这些文件，再用 `kerminal.agent.current_session` / `kerminal.agent.target_context` 刷新 live 目标。
- `~/.kerminal/AGENTS.md` 是外部 agent 的主规则入口；修改生成模板时要同步更新相关测试、`.updeng/docs/biz/configuration-workspace.md` 和必要的历史配置手册引用。

## 代码与测试边界

- 测试代码和正式运行代码必须分开：测试夹具、mock、fake、fixture、断言辅助、smoke/harness 入口放在 `tests/`、`__tests__/`、`*.test.*` 或明确的 test-support 目录/命名空间中，不要混入 `src/`、`src-tauri/src/` 等生产路径。
- 正式代码只保留必要的可注入接口、稳定抽象和运行时实现；若测试需要共享辅助能力，应放在测试支持模块里，并确保生产构建和运行时不会依赖这些测试辅助。

## 并行任务协作约束

- 多个 Codex 会话可以并行开发；多个 direct、多个 active plan、长任务、共享路径、脏工作区、worker-assisted、evolution 或复杂 plan 都必须登记到 `.updeng/docs/coordination/lanes.json`；计划、分支/worktree、owner session、主要写入路径、共享热点文件和同步口径必须可见。
- 默认使用独立 worktree/分支承载新并行任务；当前已有脏工作区无法立即迁移时，必须先登记 coordination 条目并把共享文件列入 `sharedPaths`，再继续最小合并。
- 修改其他并行单元的 `ownedPaths` 或任何 `sharedPaths` 前，先读取对应计划、最新文件和当前 diff；只做最小兼容修改，并在本轮 Round Log 或 coordination ledger 记录同步结果。
- 同一文件并行修改不要求停工，但要求可见：不要静默覆盖对方改动，不要宽泛格式化共享文件，不要把“顺手修”混进共享热点文件。

<!-- UPDENG_START -->
<!-- @author kongweiguang -->
## Updeng

本区块由 Updeng 管理。Updeng 是 Codex 的本地弱流程层：负责结构化状态、持久计划、历史对话和项目 Skill 路由；设计、编码、subagent、worktree、handoff、合并、review、验证和清理由 Codex 原生能力执行。项目自己的长期规则写在托管标记之外。

### 入口与上下文

- 使用工具前读取 `.agents/skills/updeng-workflow/SKILL.md`；再读取 Hook 强匹配的 Skills，不要一次加载全部 Skills。通用治理和持久计划已作为 workflow 的一级 reference 按需加载。
- 只评估当前项目 `.agents/skills/` 已安装能力。没有 Updeng 角色 Agent；主控会话可按任务边界使用 Codex 原生 subagent，并明确传递任务、owned paths、相关 Skills、验收、验证和集成说明。
- 理解或定位代码时，仓库根目录存在 `.codegraph/` 就先用 CodeGraph；没有索引再用 `rg`、文件读取和测试。优先相信当前代码、调用方、最近似实现、真实运行和已验证项目文档。
- 按需读取状态：direct 读取 AGENTS、目标和相关实现；plan 再读取 `plans/index.json`、当前三文件计划和 blockers；需要经验沉淀时才读取 metrics，不把历史对话默认塞进每轮上下文。

### 路由与执行

- 分别判断三个轴：`direct/plan`、`local/worktree`、`controller/subagent`。不要因为任务用了 worktree 或 subagent 就自动增加一套流程状态。
- 范围清楚、低风险、可逆、可在一次聚焦改动内完成的任务走 direct，直接实现、验证和判断文档影响。
- 多步骤、跨模块、公共契约、可恢复执行、会话续作、委派、worktree、发布、迁移、安全或生产副作用走 plan。Hook 创建或复用三文件计划并绑定当前主控会话；修改源码前先核实代码并完善初稿。
- 一个 child plan 只绑定一个 Codex 主控会话。大型 roadmap 拆成多个可独立交付的 child plan，每个 plan 可由一个独立 Codex 会话执行；主控会话内部再按需要启动 subagent。
- 当前 checkout 只允许一个可控写入者。已有其它写会话、无关脏状态、后台任务或独立 review 时优先使用 Codex worktree；共享文件、schema、migration、manifest、生成物和公共契约由唯一 integration owner 串行修改。
- 非 Git 项目无法使用 worktree；此时依据 `runtime/tasks/` 和 owned paths 串行写入，不伪造 worktree 隔离。

### 计划与状态

- `.updeng` 本地使用且被 Git 忽略；Git 项目中它链接到 Git common dir 下的共享状态，因此各分支/worktree 能看到同一份计划、运行任务、blocker 和对话历史。
- `plans/index.json` 管 roadmap、child plan 顺序、跨 plan 依赖、生命周期和主控会话；`runtime/tasks/*.json` 只表示当前运行的会话/subagent，Stop/SubagentStop 后移除，不作为完成历史。
- 每个 plan 文件夹只能有 `plan.md`、`tasks.json`、`operations.jsonl`：`plan.md` 写生产级方案叙事，不写状态和复选框；`tasks.json` 是任务状态与 task capsule 的唯一来源；`operations.jsonl` 记录实际工具、验证、worktree、handoff、merge、commit、决策和备注。
- 每个 task capsule 必须包含风险、参考、禁止改动、回滚、Skills、owned/shared paths、依赖、验收、文档影响、结构化验证和 blocker。`pending` 可暂存明确的待完善占位，但进入 review/done 前必须全部替换为真实内容。
- 多个未完成计划并存时，继续执行必须点名 `PLAN-*`；Hook 不根据含糊的“继续”猜计划。主控会话是 `plans/index.json`、task 语义状态和 `blockers.json` 的单写者，subagent 返回结果而不竞争更新共享状态。
- 原主控会话仍可恢复时不要新建会话。旧会话确实关闭或丢失后，在新 task 中明确写“接管 `PLAN-*`”；Hook 只在旧 runtime 已停止时迁移当前 controller task，并把 handoff 写入 `operations.jsonl`。
- 不可逆、合规、安全、架构级、生产、凭据缺失或外部授权问题写入 `blockers.json` 并停止；可逆低风险默认值也可记录，但不应无故阻塞。
- 使用 `updeng status .` 查看正在运行的会话和未完成任务，使用 `updeng doctor .` 校验结构化状态、Hooks 和 Skills。Hook 变更后在新任务中用 `/hooks` 复核并信任当前 revision。

### 生产门槛

- 非 trivial 实现前完成任务胶囊；计划必须覆盖当前事实、范围/非目标、架构与边界、失败/恢复、验收、验证、风险、回滚、文档和完成定义，不能只写 MVP、demo 或 happy path。
- 作者标识是硬要求：所有新增、重写或本轮修改的人工维护文件都必须在文件头或文件级注释标注 `@author kongweiguang`；修改遗留文件发现缺失时同一任务补齐。仅文件格式不支持注释、机器生成文件、锁文件、vendor、缓存和二进制资源例外，JSON/JSONL 不得写非法注释。
- Updeng 管理的计划、业务、discovery、integration 和交付说明默认使用中文。项目没有更具体约定时，公共契约、核心业务规则、复杂状态机、并发/事务/权限/恢复等非显然代码写必要中文注释，解释原因和边界；不要给显然代码添加复述式注释。
- 保持既有入口、交互、快捷键、配置、序列化、数据读写和公开契约；确需改变时写明调用方影响、迁移、兼容窗口和回滚。
- 测试强度匹配风险：先运行最窄有效检查，再运行目标 checkout 的集成门禁。只报告真实结果；不能运行时说明具体原因、未覆盖范围和剩余风险。
- 同一任务连续 2 轮修复后验证仍不绿，或连续 3 轮没有新证据/实质进展，停止盲试，记录 blocker、已验证假设和所需输入。
- 前端改动至少通过构建并启动真实 dev server 冒烟；桌面、WebView、窗口、权限、插件或原生桥接改动必须运行真实应用，无法运行时说明环境缺口。
- UI、前端和桌面窗口变更必须检查真实界面并截图；有设计图、原型、旧页面或用户截图时按相同 viewport 对比，关键视觉或交互差异未核实前不得视为完成。
- subagent/worktree 结果必须由主控会话复读 diff、解决冲突，并在目标 checkout 重新运行集成验证；局部通过不能替代合并结果验证。
- 交付前使用 `updeng-quality-engineering` 的问题优先姿态检查行为回归、数据、权限、并发、资源、兼容、漏测、文档漂移和范围外改动。

### 文档真实性

- `docs/business/<模块>/` 只记录当前代码已经实现且验证的业务逻辑：触发条件、规则、状态/数据流、失败行为、实现入口、边界和验证。设计稿、未来功能和调研不能写成现状。
- `docs/discovery/<模块>/` 保存未实现需求、候选方案、设计、原型和参考资料；`docs/integrations/<模块>/` 只记录已实现且验证的外部契约，未验证厂商资料仍留在 discovery。
- 每次功能或行为变更都判断文档影响。plan task 的 `documentation.impact` 在未决定时保持 pending；落地后设为 required 并填写真实 business/integration 路径，或设为 none 并写具体理由。进入 review/done 前唯一 required documentation check 必须通过。
- direct 没有 tasks.json 门禁，也必须在完成说明前判断文档影响。代码未落地或未验证时不得提前写业务现状。
- metrics 保存经脱敏的历史对话和人工总结候选，用于用户主动要求的 Skill/知识沉淀；不得从 metrics 自动采用新规则。

### Git、文件与收口

- 开始前查看 `git status --short`，区分本任务与未归因改动。不得擅自回滚、覆盖、stash 或删除用户改动；写共享文件前重读最新内容和 diff。
- 提交前只 stage 当前 task owned paths 中实际修改的具体文件；禁止 `git add .`、`git add -A` 和宽泛目录 staging。不得使用 `git reset --hard` 或强推，除非用户明确授权且已确认恢复点。
- 不把真实 secret、私钥、证书、`.env`、生产数据、完整 prompt、长日志、本机敏感路径、缓存或临时产物写入代码、文档和提交。外部发布、生产写入、数据删除、密钥操作和付费调用必须有明确目标、授权与恢复方案。
- 完成前复读 diff，逐项检查 touched files 的作者标识，清理临时日志/开关/fixture，解决文档影响，更新 task 验证证据和 operations；合并完成后归档计划并删除不再需要的 Codex worktree。Updeng Hook 只提示和记录，不替代 Codex sandbox、approval 与用户授权。
<!-- UPDENG_END -->
