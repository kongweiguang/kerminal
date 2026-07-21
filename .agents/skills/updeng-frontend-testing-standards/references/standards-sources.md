<!-- @author kongweiguang -->

# 前端测试规范来源

## 读取时机

- 需要解释测试分层、测试位置、工具选择或视觉验证来源时读取。
- 需要在 React/Vue 官方建议、Testing Library、Playwright/Cypress 和项目惯例之间做取舍时读取。
- 普通测试实现只按 `SKILL.md` 执行。

## 官方与主流来源

- React 官方 Testing 页面：React 推荐用能模拟真实用户行为的测试策略，避免过度依赖实现细节。
- Vue 官方 Testing Guide：Vue 建议根据场景选择单元、组件、端到端测试，并推荐 Vitest、Vue Test Utils、Cypress/Playwright 等工具。
- Testing Library：查询和断言应尽量贴近用户如何找到元素，减少实现细节耦合。
- Vitest 官方文档：Vite 生态测试运行器，默认支持 `.test.`/`.spec.` 文件约定和浏览器/组件测试能力。
- Jest 官方文档：成熟 JS 测试运行器，适合已有 Jest 项目继续维护。
- Playwright 官方文档：真实浏览器端到端、组件、截图和跨浏览器验证。
- Cypress 官方文档：端到端和组件测试，适合已有 Cypress 项目。
- MSW 官方文档：用 Service Worker/Node 拦截网络请求，适合前端服务层和组件集成测试。

## 已拉取学习的 GitHub skill/规范仓库

- `Gentleman-Programming/Gentleman-Skills/curated/playwright`：吸收先探索真实页面再写测试、selector 优先级、复用 page object、区分单个测试和完整套件、测试标签和文档边界。
- `YBsmorom/ecc-codex-plugin/rules/typescript/testing`：吸收关键用户流优先 E2E，并把 Playwright 作为默认真实浏览器验证工具之一。
- `YBsmorom/ecc-codex-plugin/rules/web/design-quality`：吸收 UI 输出不能停留在模板化外观，视觉验证要覆盖层级、状态、交互和产品可信度。
- `claude-mpm-skills/universal/debugging/verification-before-completion`：吸收“完成声明必须有新鲜验证证据”的规则，用于测试和 UI 验收结论。
- `getsentry/skills/skills/triage-frontend-issues`：吸收硬规则先行、跳过不确定项、计划与执行分离的 skill 写法；用于测试高风险变更的确认口径。

## 本项目取舍

- 用户可见行为优先于实现细节；测试不应因为内部状态重构而无意义失败。
- 单元/组件测试靠近源码，e2e/视觉集中到浏览器测试目录。
- 新 Vite 项目优先 Vitest；已有 Jest/Cypress 项目优先沿用现状。
- UI 变更必须真实浏览器验证；截图和设计/旧页面对照是交付证据，不是可选装饰。

## 参考链接

- https://react.dev/learn/writing-tests
- https://vuejs.org/guide/scaling-up/testing.html
- https://testing-library.com/docs/
- https://vitest.dev/guide/
- https://jestjs.io/docs/getting-started
- https://playwright.dev/docs/intro
- https://docs.cypress.io/
- https://mswjs.io/docs/
