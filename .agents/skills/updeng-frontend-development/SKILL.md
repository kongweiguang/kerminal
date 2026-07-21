---
name: updeng-frontend-development
description: |
  项目级前端架构、页面与交互交付规范，覆盖模块边界、TypeScript/API 契约、权限、路由、表单/表格/弹窗、真实运行、截图对照和响应式验收。
  用于跨框架组织前端代码或交付端到端用户功能；只改测试策略时使用前端测试 Skill，React/Vue Skill 仅在项目实际采用对应框架时加载，纯后端任务不要加载。
---

<!-- @author kongweiguang -->

# 前端开发能力

涉及目录、模块、状态、副作用、TypeScript 或 API 类型边界时，先读 `references/architecture.md`；需要规范来源时再读 `references/standards-sources.md`。

## 工作流程

1. 修改前先读项目文档，以及最近似页面、组件、API 模块。
2. 追踪真实数据路径：UI 事件 -> 接口客户端 -> 后端契约 -> UI 状态/渲染。
3. 保持项目既有设计系统和组件库。
4. 实现完整用户路径：路由/页面、接口客户端、类型、加载/错误状态、表单校验、空状态/错误态。
5. 如果任务要求测试/demo UI，保留有用调试状态。
6. 目标可运行时，执行类型检查/构建和浏览器验证。
7. 涉及 UI 视觉或交互时，必须运行真实页面、截图、和原型/参考并排比对，差异未消除前不提交。
8. API 契约变化要同步关注后端开发能力和文档同步能力。
9. 完成前确认前端仍能启动：至少运行项目构建；能启动 dev server 时做真实页面 HTTP/浏览器冒烟。遇到白屏、动态导入失败、Vite optimize dependency 过期、路由入口不可用等启动阻断，先修复启动再交付功能结论。

## 实现规则

- 已有应用中不要擅自创造全新视觉语言，除非任务是绿地设计。
- 请求/响应类型保持明确，避免 `any`。
- 项目有 API 层时，不要在随机组件里直接请求后端。
- 权限、加载、空数据、错误、过期数据状态要可见。
- 只有当前仓库出现重复后，再抽可复用 helper。
- 麦克风、实时、流式问题先从 UI 捕获/事件分发路径查起。
- 不因局部页面需求改全局组件行为；确需改全局组件时同步检查所有调用点。
- 前端字段、枚举、空值处理必须和后端契约一致，不靠猜测补字段。
- 修改既有功能时保护已有入口、快捷键、配置格式、持久化数据和公开契约；确需改变行为时，写清影响范围、迁移或回滚口径，并覆盖相邻既有功能回归验证。
- 诊断、调试、runtime 状态和内部实现细节默认不直接暴露给普通用户；只有排障页、开发模式、日志或明确的高级设置需要展示时才进入界面，并使用用户能理解的文案。

## 后台管理系统常见约定

- API 文件优先复用当前仓库统一请求工具，接口命名和路由保持后端前缀一致。
- 类型文件按当前仓库习惯定义请求、表单、查询和响应对象；分页查询对象保留仓库已有分页字段。
- 列表页保留当前仓库已有的加载、选择、搜索、分页、提交和导出状态。
- 常见行为命名沿用最近似页面，不为单个页面发明另一套事件名。
- 后端使用权限标识时，前端按钮权限指令要与后端保持一致；权限标识统一为 `${module}:${business}:${action}`。
- 日期范围查询继续沿用当前仓库现有日期范围工具和参数结构。

## 运行态视觉验证

只要改动影响页面、组件、样式、布局、状态展示或交互态，就执行这个门禁；它和 typecheck/build 一样是完成条件。

1. **运行真实界面**：启动项目现有前端 dev server，例如 `pnpm dev`、`npm run dev` 或仓库文档指定命令；已有服务占端口时换可用端口并记录 URL。
2. **截图运行页面**：用编程浏览器或 Codex Browser 打开目标路由，等待数据和字体稳定后截图；至少覆盖桌面视口，必要时补移动/窄屏视口。
3. **打开参考源**：如果任务有原型 HTML、Figma 截图、设计图、旧页面或用户给的图片，同时打开并截图。没有参考源时，以最近似页面和项目设计系统为对照。
4. **逐项比对**：检查布局分区、主辅色和状态色、间距留白、字号字重行高、控件类型、文案、图标、表格/卡片语义、hover、active、disabled、loading、empty、error、权限态和弹窗/抽屉层级。
5. **循环修正**：发现关键差异就改，改完重新截图再比；关键差异未消除时，验证结论是 fail，不能提交或标记任务完成。
6. **记录证据**：在 `verification.md` 或 `tasks.md` Round Log 写入运行 URL、截图路径、参考源、已比对状态、剩余差异和是否接受。

主题验证是视觉门的一部分：新增或修改页面、组件、弹框、菜单、下拉、toast、portal 和独立窗口时，至少检查浅色、深色和跟随系统主题。颜色优先使用项目主题变量、设计 token 或成对的 `dark:` 样式；portal、弹层和独立窗口要继承全局主题上下文，不要只在局部容器挂 `.dark` 或 `data-theme`。

Web 前端默认用浏览器截图；原生桌面或 WebView 外壳用运行窗口截图。不要只根据代码阅读判断视觉完成。

## 常用例子

列表页状态清单：

```ts
const [loading, setLoading] = useState(false)
const [rows, setRows] = useState<ItemVo[]>([])
const [total, setTotal] = useState(0)
const [queryParams, setQueryParams] = useState<ItemQuery>({
  pageNum: 1,
  pageSize: 10,
  params: {},
})
```

API 服务封装：

```ts
export function listItem(query: ItemQuery) {
  return request<TableDataInfo<ItemVo>>({
    url: '/biz/item/list',
    method: 'get',
    params: query,
  })
}

export function updateItem(data: ItemForm) {
  return request<R<void>>({
    url: '/biz/item',
    method: 'put',
    data,
  })
}
```

前后端契约核对：

```markdown
- 路径：GET /biz/item/list
- 权限：biz:item:list
- 查询：pageNum、pageSize、params.beginTime、params.endTime
- 返回：TableDataInfo<ItemVo>
- 页面状态：loading、empty、error、pagination
```

## 验证

优先使用项目本地脚本：

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

如果本地目标明确，用 Codex Browser 打开并验证变更流程。涉及 UI 时执行运行态视觉验证和主题三态检查；无法运行或截图时，说明缺失依赖、失败命令或环境限制。
