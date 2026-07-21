---
name: updeng-frontend-testing-standards
description: |
  前端单元、组件、service、integration、E2E、视觉回归、fixture 和浏览器验证规范。
  用于新增或修改前端测试、测试基础设施、mock/fixture、覆盖策略、Playwright 流程或视觉回归门禁；不要仅因修改前端生产代码就加载。
---

<!-- @author kongweiguang -->

# 前端测试规范

## 适用边界

- 用于设计、补齐或评审前端自动化测试和真实浏览器验证。
- 不替代框架代码规范：React 代码使用 `updeng-react-development-standards`，Vue 代码使用 `updeng-vue-development-standards`。
- 工程结构、分包和测试目录归属争议使用 `updeng-frontend-development` 的 architecture reference 协调。
- 需要解释测试工具来源和官方建议时，先读 `references/standards-sources.md`。

## 测试金字塔

- 纯函数、协议映射、状态 reducer、format/parse、权限判断：优先单元测试。
- 组件交互、表单校验、loading/empty/error/disabled、键盘和可访问语义：优先组件测试。
- 服务层、API envelope、mock/API 切换、缓存、重试和错误转换：使用服务层集成测试或 mock server。
- 路由、鉴权、跨页面工作流、上传下载、浏览器权限、Tauri/native 桥接和视觉对照：使用 Playwright/Cypress e2e 或组件浏览器测试。
- 不用大型端到端测试覆盖所有小分支；把大多数逻辑留给快速测试。

## E2E 硬规则

- 写 Playwright/Cypress 测试前，先运行真实页面或读取现有页面对象/测试，确认实际流程和选择器；不要想象 UI 应该长什么样。
- 选择器优先级：role/name > label > placeholder/text > test id > CSS/XPath。CSS class、DOM 层级和 nth-child 只能作为最后手段。
- 新测试先复用既有 page object、fixture、login helper、seed helper 和断言 helper；没有再创建。
- 单个用户请求“加一个测试”时只加一个聚焦测试；用户要求“完整测试套件/全面覆盖”时再扩展套件。
- E2E 断言关键结果，不只断言按钮可点击；成功路径至少验证 URL、核心内容、状态变化或持久化结果之一。

## 测试位置

- 默认贴近被测文件：`Button.test.tsx`、`useSearch.test.ts`、`orderService.test.ts`。
- Vue SFC 可使用 `Component.spec.ts` 或项目既有命名；React 可使用 `*.test.tsx`。
- e2e 和跨路由流程集中放在 `tests/e2e/`、`e2e/` 或 Playwright/Cypress 配置指定目录。
- 视觉回归和截图基准放在 e2e/visual 目录或工具配置指定 snapshot 目录，不混进组件源码目录。
- 全局 setup、custom render、test router、test store、mock server 和通用 matcher 放在 `src/test/` 或 `packages/test-utils/`。
- 领域私有 fixture、builder、断言 helper 放在领域 `test-support/`，只在跨领域复用后提升为共享测试工具。

## 测试数据

- fixture 表达真实业务边界，不只写最短 happy path。
- builder 用默认合法对象，按测试意图覆盖字段；不要在每个测试复制完整大对象。
- mock server 响应应模拟真实 envelope、错误码、分页、权限、延迟和异常，而不是直接返回页面想要的形状。
- 时间、随机数、ID、网络和本地存储要可控；测试中不要依赖当前日期、执行顺序或外部服务状态。
- 不在测试数据中写真实 token、密码、密钥、手机号、身份证或生产 URL。

## 断言规则

- 优先断言用户可见行为、可访问名称、状态变化和协议边界；不要过度断言实现细节、class 顺序或内部 state。
- 异步测试显式等待用户可见结果或网络状态；不要用固定 sleep 掩盖竞态。
- 错误态必须断言用户可见提示和敏感信息不泄露。
- 权限测试至少覆盖可见、禁用、隐藏、接口拒绝或路由拦截中的实际项目策略。
- 表单测试覆盖必填、格式、边界长度、提交中禁用、后端错误回填和成功后跳转/刷新。
- 列表测试覆盖搜索、重置、分页、排序、空状态、错误态、批量选择和删除确认。

## 浏览器与视觉验证

- UI/交互/样式变更必须启动真实页面，使用浏览器验证目标路由。
- 前端变更完成前至少运行项目构建；能启动 dev server 时必须做真实页面冒烟。白屏、动态导入失败、Vite optimize dependency 过期、路由入口不可用等问题是启动验证失败，先修复再收口。
- 有设计图、原型、旧页面、截图或参考 HTML 时必须并排比对；没有参考时选最近似项目页面作为基线。
- 截图前等待字体、数据、动画、异步请求和布局稳定。
- 检查 desktop、mobile 和关键断点；固定格式控件要保证尺寸稳定，不因 loading、hover、错误文案或长文本导致跳动。
- 关键状态至少覆盖 default、loading、empty、error、disabled、permission denied、modal/drawer open。
- 涉及主题、颜色、弹层、portal、toast、菜单、下拉、独立窗口或全局 layout 的变更，至少验证浅色、深色和跟随系统主题；portal/独立窗口要继承全局主题上下文。
- 视觉差异无法消除时记录差异、原因和接受口径，不把截图验证省略成“看起来可以”。
- 能使用 Playwright trace、screenshot、video 或 browser snapshot 时，把它们作为失败定位和交付证据；不要只描述人工观察。

## 工具选择

- React 组件测试优先 React Testing Library + Vitest/Jest；Vue 组件测试优先 Vue Test Utils + Vitest。
- 新 Vite 项目优先 Vitest；已有 Jest 项目继续沿用 Jest，除非有明确迁移收益。
- e2e 优先 Playwright 或项目既有 Cypress；不要同时引入两个浏览器测试框架。
- 网络 mock 优先 MSW、Playwright route 或项目既有 mock server；避免散落手写 fetch mock。
- 可访问性可用 Testing Library 查询、Playwright locator、axe 或项目既有工具补充。
- 生产测试代码不使用固定 sleep；用 locator、network、URL、可见文本、aria 状态或业务事件等待。

## 验证命令

按项目实际选择：

```powershell
npm run typecheck
npm run lint
npm run test
npm run test:e2e
npm run build
```

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

- 只改测试时仍要确保相关生产代码编译通过。
- 修改测试基础设施、setup、mock server、路由、构建配置或 package 脚本时，运行受影响测试套件和至少一次构建。
- 无法运行浏览器测试时，说明缺少浏览器安装、dev server、后端服务、环境变量或测试账号。
- 真实浏览器/视觉验证记录应包含 URL、视口、主题状态、截图或 trace 路径、参考源和可接受剩余差异；不要把只读代码检查当成 UI 验证。
