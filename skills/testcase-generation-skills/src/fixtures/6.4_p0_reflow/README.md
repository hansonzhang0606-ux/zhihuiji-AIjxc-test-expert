# 6.4 P0 回流基线 Fixture

冻结 Demand 6.4 前后行为对照：

| 文件 | 用途 |
|------|------|
| `functional_p0.input.xmind` | 仅导航步骤、无技术引用的 P0（含一个 P1 对照） |
| `techref_p0.input.xmind` | 导航 + 结构化技术引用的 P0 |
| `expected_baseline.json` | 当前实现下的候选种类与数量快照 |

## 预期

- **6.3 以前**：`functional_p0` 常为 0 candidate（只扫技术引用）。
- **6.4 以后**：`functional_p0` 至少产出 `page` / `page_relation` / `page_element`；P1 页「忽略页」不出现。
- `techref_p0` 同时产出路径候选与 `page_url` / `backend_api`。

验证：

```bash
cd src/scripts
npm run kb64:reflow:self-test
```
