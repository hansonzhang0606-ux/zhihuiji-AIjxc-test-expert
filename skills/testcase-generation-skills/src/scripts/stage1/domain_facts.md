# domain_facts — 本需求临时知识点（WP-61-FACTS 接口说明）

> 依据：`src/demand/testcase-generation-demand6.1.md` §5.0；编排：`src/demand/outline6.1.md` WP-61-FACTS。  
> 契约：`src/contracts/domain_facts.schema.json`  
> **本文只定接口与消费边界；不实现 6.2 extract，不接线 Stage4。**

---

## 1. 唯一路径

| 项 | 值 |
|----|-----|
| 工作区文件 | `script/stage1/domain_facts.json` |
| Schema | `src/contracts/domain_facts.schema.json` |
| schema_version | `"6.1"` |

**禁止作为 Stage 输入的并行文件名：**

- `session_facts.json`
- `kb_applied.json`（6.2 截取结果必须 **merge 进** `domain_facts.json`，`source=kb_applied`）

---

## 2. 模块：`scripts/stage1/domain_facts.js`（已实现）

| 导出 | 行为 |
|------|------|
| `FACTS_REL` | `script/stage1/domain_facts.json` |
| `loadDomainFacts(projectDir)` | 无文件 → `ok=true, data=null, missing=true`；有则 schema 校验 |
| `emptyFacts(requirementTitle)` | 合法空文档 |
| `validateFacts(data)` | 契约校验 |
| `mergeFacts(base, incoming, opts)` | 按 id 合并；默认 human_review 盖 kb_applied |
| `assertNoAliasInputs(projectDir)` | 禁止并行 `session_facts.json` / `kb_applied.json` |
| `auditDraftAgainstFacts(draft, factsDoc)` | forbid_patterns 扫描 title/detail |
| `writeDomainFacts(projectDir, data)` | 校验后写入 |

```bash
node stage1/domain_facts.js --self-test
node stage1/domain_facts.js --project-dir <工作区> [--check-aliases]
```

**不做：** 不读 `templates/kb/**`；不写长期库；不被 Stage4 require。

---

## 3. 消费矩阵（硬约束）

| 消费者 | 读 | 写 | 说明 |
|--------|----|----|------|
| 人审①′ / 对话澄清 | ✓ | ✓ | 结构化写入 / 改 `facts[]` |
| Stage1A Prompt / finalize | ✓ | 否* | 注入断言；写反 `forbid_patterns` → 失败或 pending |
| Stage3A Prompt / finalize | ✓ | 否* | 注入；**固化**进 C-TP 标题/期望后，下游不再依赖本文件 |
| Stage4 | **禁止** | 禁止 | 只读已批准 C-TP |
| 6.2 extract（若已实现） | 否 | merge 写入 | 只通过 `mergeFacts`；`source=kb_applied` |
| 6.2 长期库晋升 | 可读 session_only=false 候选 | 否（旁路「补充知识库」） | 非本模块职责 |

\* finalize 可更新 `updated_at` 元数据，但不应在 1A/3A 静默改写业务 `statement`（人审改口径除外）。

---

## 4. 与 Demand 6.2 对接点（仅接口）

```text
6.2 extract(modules, keywords, C-CTX)
    → 命中行列表
    → 映射为 facts[]（source=kb_applied, session_only=false 通常）
    → mergeFacts(loadDomainFacts() || empty, incoming)
    → 写回 script/stage1/domain_facts.json
```

- 6.1 **不实现** extract。  
- 无 6.2 / 无命中 → 不创建文件，或保持人审已有内容。  
- 冲突：同语义不同 `statement` → 人审裁决；实现默认保留 `human_review`。

---

## 5. 最小合法样例

```json
{
  "schema_version": "6.1",
  "requirement_title": "示例需求标题",
  "facts": [
    {
      "id": "DF-001",
      "statement": "对象A 在条件C下结果为 R1",
      "forbid_patterns": ["结果为 R2"],
      "source": "human_review",
      "session_only": true
    }
  ],
  "updated_at": "2026-07-28T00:00:00.000Z"
}
```

空文件等价（允许不落盘）：

```json
{
  "schema_version": "6.1",
  "requirement_title": "示例需求标题",
  "facts": []
}
```

---

## 6. 验收对照（outline §五）

| 场景 | 本规格保证 |
|------|------------|
| S1 | 无文件 → load 视为空，不失败 |
| S3 | forbid_patterns 形状合法，供 1A/3A 机检 |
| S7 | 消费矩阵禁止 Stage4 读本文件 |
| S10 | 本模块不写 `templates/kb` |
