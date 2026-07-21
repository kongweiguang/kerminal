<!-- @author kongweiguang -->

# 前端工程结构规范来源

## 读取时机

- 需要解释前端工程结构、分包、测试包和代码风格来源时读取。
- 需要处理项目惯例和 Google/Airbnb/React/Vue 规范冲突时读取。
- 普通实现只按 `SKILL.md` 执行。

## 顶尖厂与官方来源

- Google TypeScript Style Guide：TypeScript 可读性、模块导入、类型表达、命名和团队一致性基线。
- Google JavaScript Style Guide：JavaScript 源文件结构、命名、导入、注释和语言特性使用基线。
- Google HTML/CSS Style Guide：HTML/CSS 格式、语义、可维护性和样式组织参考。
- Airbnb JavaScript Style Guide：业界广泛使用的 JS/React 可读性和一致性规范，适合作为补充参考。
- Airbnb CSS/Sass Style Guide：CSS/Sass 组织、命名和结构参考。
- React 官方文档：组件、Hooks、Effects 和状态规则以官方为准。
- Vue 官方文档与 Style Guide：SFC、组件命名、props、v-for key、Composition API 和测试建议以官方为准。
- Vite、Vitest、Playwright 官方文档：构建、测试和真实浏览器验证以工具官方行为为准。

## 已拉取学习的 GitHub skill/规范仓库

- `google/styleguide`：实际拉取并读取 Google styleguide 仓库，吸收 TS/HTML/CSS 作为可读性、语义和格式基线。
- `airbnb/javascript`：实际拉取 Airbnb JavaScript/React 规范仓库，吸收为导入、模块、对象/数组、函数、React 和测试可读性补充基线。
- `airbnb/css`：实际拉取 Airbnb CSS/Sass 规范仓库，吸收 OOCSS/BEM 思路、样式与 JS hook 分离、低耦合样式组织。
- `Gentleman-Programming/Gentleman-Skills/curated/typescript`：吸收“公共类型显式、避免 any、使用 unknown 收窄、类型导入、运行时常量与类型同步”的硬规则。
- `YBsmorom/ecc-codex-plugin/rules/typescript`：吸收导出 API 显式类型、named object shapes、React props 显式建模、JSDoc 作为 JS 迁移补充、生产代码不用 console.log。
- `YBsmorom/ecc-codex-plugin/rules/web`：吸收 feature/surface-first 组织、CSS custom properties/design tokens、语义 HTML、合成友好动画和设计质量检查。
- `getsentry/skills/skills/skill-writer`：吸收 skill 结构方式：runtime `SKILL.md` 放路由和执行规则，来源和深解释放扁平 references。

## 本项目取舍

- Google/Airbnb 属于外部基线，不能推翻项目既有 lint、formatter、目录 ownership 和设计系统。
- React/Vue 官方正确性规则优先级高于第三方风格指南。
- 工程结构默认按领域和依赖边界组织；只有项目很小时才接受简单 `pages/components/services` 分层。
- 测试默认靠近被测代码，e2e/视觉/跨路由流程集中到浏览器测试目录。

## 参考链接

- https://google.github.io/styleguide/tsguide.html
- https://google.github.io/styleguide/jsguide.html
- https://google.github.io/styleguide/htmlcssguide.html
- https://github.com/airbnb/javascript
- https://github.com/airbnb/css
- https://react.dev/learn
- https://vuejs.org/guide/
- https://vuejs.org/style-guide/
- https://vite.dev/guide/
- https://vitest.dev/guide/
- https://playwright.dev/docs/intro
