<!-- @author kongweiguang -->

# 架构评估格式

```markdown
# 架构深化候选

## 总览

| 候选 | 推荐强度 | 证据 | 主要收益 | 风险 |
| --- | --- | --- | --- | --- |

## <候选名称>

- 文件/符号：
- 当前摩擦与证据：
- 建议边界与接口：
- 保持不变的行为：
- 局部性/杠杆收益：
- 测试改善：
- SOLID/设计模式及理由：
- 真实 adapter/替换场景：
- 第一迁移切片：
- 完整迁移与旧入口删除条件：
- 验证：
- 回滚：
- 推荐强度：Strong | Worth exploring | Speculative
```

只有用户要求可视化时才补 Mermaid/FigJam/临时 HTML。一次性报告不要默认进入仓库；长期有效的结论写入 discovery，实施结果写入 business/integrations。
