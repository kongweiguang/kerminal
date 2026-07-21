---
name: updeng-frontend-architecture-standards
description: |
  前端工程结构、feature/module 边界、service/API/state 分层、TypeScript 公共契约、monorepo/package 和测试目录布局规范。
  用于创建或修改前端架构、模块所有权、依赖方向、共享 package 或目录结构；不涉及结构决策的普通页面/组件修改不要加载。
---

<!-- @author kongweiguang -->

# 前端工程结构规范

## 适用边界

- 用于规划或评审前端工程结构、模块分包、目录归属、测试包布局和构建质量门禁。
- 不替代 React/Vue 具体代码规范：React 组件和 Hooks 细节使用 `updeng-react-development-standards`；Vue SFC、Composition API 和 Pinia 细节使用 `updeng-vue-development-standards`。
- 需要测试策略细化时使用 `updeng-frontend-testing-standards`。
- 需要解释规范来源时，先读 `references/standards-sources.md`。

## 规范来源与优先级

- 优先级：用户最新要求 > `AGENTS.md` 和当前项目规则 > 既有项目结构 > 本技能 > Google/Airbnb/React/Vue 官方或开源规范 > 其他第三方建议。
- Google TypeScript Style Guide 作为 TypeScript 可读性、模块导入、类型表达和长期维护基线。
- Google HTML/CSS Style Guide 与 Airbnb CSS/JS Style Guide 作为 DOM、样式、命名、文件组织和可读性参考。
- React/Vue 官方文档决定框架约束；工程结构不违反框架官方规则。
- 已实际拉取并学习 GitHub 开源 skills/rules：Gentleman-Skills 的 `typescript`、ECC Codex plugin 的 `rules/typescript` 与 `rules/web`、Sentry skill-writer；吸收为下文 public API、feature-first、语义 HTML、设计 token 和验证规则。
- 外部规范只作为生产级基线，不强制推翻已有成熟项目结构。

## 分包原则

- 按业务能力和运行边界分包，不按“components/utils/pages”机械堆叠所有代码。
- 公共包必须满足至少两个真实消费者、稳定 API、独立测试和明确 ownership；否则先留在领域模块内。
- monorepo 包命名要表达用途，例如 `ui`、`api-client`、`shared-types`、`feature-auth`、`app-admin`，避免 `common2`、`new-utils`。
- 包之间保持单向依赖：应用包依赖功能包，功能包依赖基础包；基础包不反向依赖具体应用。
- 不把全局状态、请求 client、业务枚举和组件库互相耦合成一个大包。

## 推荐目录

单应用项目：

```text
src/
  app/                 # 应用入口、路由、provider、全局错误边界
  pages/               # 路由页面，薄组合层
  features/            # 按业务能力组织的功能模块
    <domain>/
      components/
      hooks/           # React
      composables/     # Vue
      services/
      state/
      types.ts
      test-support/
  components/
    ui/                # 设计系统或跨领域 UI
    layout/
  services/
    api/
    client.ts
    auth.ts
  styles/
  test/
```

monorepo 项目：

```text
apps/
  admin/
  portal/
packages/
  ui/
  api-client/
  shared-types/
  test-utils/
  eslint-config/
```

- `pages` 只组织路由、布局和页面级组合；长期业务逻辑进入 `features/<domain>`。
- 领域内私有组件留在领域目录；跨领域组件才进入 `components/ui` 或独立 `ui` 包。
- API client 和协议类型靠近服务层；页面不直接拼 URL、解析 envelope 或操作 token。
- mock、fixture、builder 和测试 helper 与消费者靠近；跨项目复用后再提升到 `test-utils`。

## TypeScript 硬规则

- 导出的函数、共享工具、公共 class 方法、组件 props、服务层入参和返回值必须显式建模。
- 局部变量可让 TypeScript 推断；公共 API 不靠隐式 `any` 或推断暴露长期契约。
- 外部输入、后端响应、本地存储、URL 参数和第三方 SDK 返回值先按 `unknown`/schema 收窄，不直接断言成业务类型。
- 对象形状可扩展时优先 `interface`；联合、交叉、tuple、mapped type、utility type 使用 `type`。
- 重复出现的内联对象形状抽成命名类型；深层内联对象拆成独立 interface/type。
- React props 或 Vue props/emits 对外暴露时必须命名，不能让组件签名成为不可复用的匿名类型堆。

## API 与类型边界

- 所有 HTTP/RPC/native 调用进入服务层或 API client；页面组件只调用语义化方法。
- 协议类型与领域展示类型分开：后端返回结构、分页 envelope、错误 envelope 和文件下载在 client 层适配。
- TypeScript 新代码默认 strict；公共类型不使用 `any` 承接长期协议，不确定输入用 `unknown` 后收窄。
- 运行时边界需要校验：用户输入、URL 参数、本地存储、第三方 SDK、后端返回和导入文件都不可盲信。
- 枚举、状态、权限、字典和颜色映射集中维护；不要在多个页面硬编码同一业务语义。

## 状态与副作用边界

- 首选局部状态；只有跨路由、跨功能或多消费者共享时才引入全局状态。
- 服务层负责请求、重试、取消、缓存策略和错误转换；组件负责交互状态和展示。
- 不把纯派生数据放进远程状态或全局 store；渲染阶段可计算的内容保持局部。
- 权限、租户、语言、主题、实验开关和登录态是应用级状态，需要清晰 provider/store 边界。
- 文件、浏览器 API、Tauri/native API、WebSocket、定时器和第三方 SDK 必须有生命周期清理。

## 样式与组件系统

- 设计系统组件和业务组件分开；业务组件不要污染 `ui` 包。
- CSS/Tailwind/design token 使用项目统一方式；不要在页面里堆临时颜色、魔法间距和重复阴影。
- Google/Airbnb 样式规则用于可读性和一致性，但最终以项目 formatter、lint 和设计系统 token 为准。
- 新增组件必须覆盖 loading、empty、error、disabled、readonly、permission denied 和 responsive 状态。
- 图标、按钮、表单、表格、弹窗、抽屉、菜单和 toast 优先复用项目现有组件。
- 语义 HTML 优先：header、nav、main、section、article、aside、footer、button、label 能表达语义时不要堆 div。
- CSS class 不同时承担样式和 JS 选择器职责；需要脚本 hook 时使用独立 data 属性或项目约定的测试/JS hook。
- 动画优先使用 transform、opacity 等合成友好属性；避免频繁动画 width、height、top、left、margin、padding、font-size。

## 测试包布局

- 单元和组件测试默认贴近被测文件：`*.test.ts(x)`、`*.spec.ts(x)` 或项目既有命名。
- e2e、跨路由流程、真实浏览器权限和视觉回归放在 `tests/e2e`、`e2e` 或 Playwright 配置目录。
- 全局测试 setup、custom render、mock server、通用 matcher 放在 `src/test` 或 `packages/test-utils`。
- 领域私有 fixture 和 builder 放在领域 `test-support`，不要提升为全局工具。
- 测试目录和生产目录同样受文件规模控制：超过 800 行要按行为、fixture、页面、适配器或断言 helper 拆分。

## 质量门禁

- 最低门禁：typecheck、lint、unit/component test、production build。
- UI/交互变更必须运行真实页面并截图；有原型、设计图、旧页面或用户截图时做并排比对。
- 路由、鉴权、表单、表格、分页、导入导出、上传、删除、状态切换和错误态需要覆盖交互验证。
- CI 中避免只跑 `build`；至少把 lint、typecheck、test 分开，便于定位失败。
- 无法运行某项验证时说明缺少依赖、环境变量、浏览器、后端服务或测试数据。
