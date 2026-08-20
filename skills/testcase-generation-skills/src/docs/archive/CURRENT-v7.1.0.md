> **【历史留档】** 本文对应 v7.1.0 运行时规格摘要，已并入 `skill.md` + `src/stages/`。  
> **Agent / 脚本禁止引用。** 仅人工考古。

# 测试用例生成 — 当前规格（CURRENT）【归档副本】

| 项 | 内容 |
|----|------|
| 版本 | 7.1.0 |
| 日期 | 2026-08-10 |
| 用途 | Agent / 人阅读的**唯一**运行时规格摘要 |
| 编排入口 | 根目录 [`skill.md`](../../skill.md) |
| 历史需求 | [`archive/demand/`](./demand/)（仅留档） |

---

## 1. 范围与非目标

**做：** Confluence/本地需求 → 需求点 → 测试点 → 用例（XMind/Excel）；旁路补充模块矩阵知识库。  
**不做：** 独立 Confluence 下载 Skill；Full Path 全量分析；用 `模块匹配规则` 顶替业务知识真源。

---

## 2. Fast Path 阶段序与执行者

```text
Stage0 初始化（Script）
  → Stage1 下载落盘（Script / MCP 可选）
  → Stage1 1CTX（Script）
  → 人审① 上下文（User）
  → Stage1A 需求点（LLM）+ finalize（Script）
  → 人审①′ 需求点（User）
  → [可选 Stage2]
  → Stage3 模块归属（Script）
  → KB extract → domain_facts（Script）
  → Stage3A 测试点（LLM）+ finalize（Script）
  → Stage3B 矩阵标签（Script）
  → 人审② 测试点（User）
  → Stage4 用例（Script）+ 预览改（User）
  → [可选] Stage5 P0 Excel → DevOps 导入（Script + User 手工上传）
```

| 旁路 | 触发 | 入口 |
|------|------|------|
| 补充知识库 | 「补充知识库/知识点/更新知识库」 | `skills/knowledge-base/SKILL.md` |

同句要求生成用例 + 补充知识库 → **先问**选哪条，禁止静默并行。

---

## 3. 工作区与产物

| 约定 | 值 |
|------|-----|
| 产物根 | `output/`；标题含 `vX.Y.Z` → `output/vX.Y.Z/{title}/` |
| 工作区内 | 仅 `input/` ∥ `output/` ∥ `script/` |
| 需求原文 | `input/需求文档/{title}.md` |
| 中间 JSON | `script/` |
| 对外 XMind | 工作区 `output/*.xmind` |
| 模板 | **只读** `src/templates/`（禁止复制进工作区） |
| 主键 | 需求文档 title（禁止 pageId 作目录主名） |

---

## 4. 契约索引

| 契约 | Schema |
|------|--------|
| C-CTX | `src/contracts/test_context.schema.json` |
| C-RP | `src/contracts/requirement_points.schema.json` |
| C-TP | `src/contracts/test_points.schema.json` |
| C-TC | `src/contracts/test_cases.schema.json` |
| domain_facts | `src/contracts/domain_facts.schema.json` |
| final_artifact | `src/contracts/final_artifact.schema.json` |
| 工作区 | `src/contracts/workspace.md` |

---

## 5. 生成侧硬门禁

1. 人审①前：不得进入 1A；`test_context_approved=true` 后方可。  
2. 人审①′前：C-RP 须 schema 通过；XMind 只读，改动在对话。  
3. 模块名：**不得自创**；以矩阵分层 + 匹配规则解析。  
4. Stage3A 前：按 C-MOD 截取**已确认**知识库 → `domain_facts`（可空）。  
5. 适用 P0：每目标页一条导航；缺口进 `path_gaps` / `api_assertion_gaps`。  
6. Stage4：**仅**读已批准 C-TP（+ merge_report）；**禁止**读 `domain_facts` / 知识库 Markdown。  
7. Stage4「可以了」≠ 入库；须用户另说「补充知识库」。  
8. Stage5（可选）：见 `src/stages/stage5_platform_import.md`（本文归档时未单列）。

---

## 6. 知识库旁路硬门禁

双通道（详见 KB `SKILL.md`）：

| 通道 | 用例范围 | 产出 |
|------|----------|------|
| 导航/技术引用 | 仅 P0 | relation / url / api |
| 业务规则 | P0/P1；禁非功能与 P2/P3 | page / page_element / supplement |

- 元素阻塞：`name` / `interaction` / `result`；`backend_api` 等仅告警。  
- 业务 page 缺 URL：告警；显式 `page_url` 缺 URL：阻塞。  
- apply 须 `--confirm-content`；内容审前不得改 `kb_root`。  
- 不猜 URL/API；空字段写 `-`。  
- 默认样例根：`src/templates/模块矩阵知识库/`。

---

## 7. templates

见 [`../templates/README.md`](../templates/README.md)。

---

## 8. 变更记录

| 版本 | 说明 |
|------|------|
| 7.0.0 | 精简重构：CURRENT 唯一规格；demand 归档；去掉 confluence-download；templates 扁平化 |
| 7.1.0 | Stage5：P0 平台 Excel；运行时见 stage5_platform_import.md |
