---
stage_id: stage3_module
version: "6.0"
execution_type: script
fast_path: true
trigger: default
estimated_duration: "1-3min"
quality_gate: "stage1_approved=true；C-MOD 含 attributions + unmatched[]；mapping 仅来自 src/templates"
inputs:
  - name: requirement_points.json
    required: true
    contract: C-RP
outputs:
  - path: "script/stage3/module_attribution.json"
    contract: C-MOD
depends_on:
  - stage1_checkpoint
deprecated_predecessor: stage3.3_module_attribution.md
---

# Stage3 模块归属（3.3 Script / Demand 6.0）

| 项 | 内容 |
|----|------|
| 依据 | `demand/testcase-generation-demand6.0.md` §6.2 / §6.5 |
| 规则 | **只读** `src/templates/模块匹配规则.md`（禁止工作区 templates） |
| 脚本 | `scripts/stage3/stage3_module.js` |
| 关键词表 | `scripts/stage3/module_keyword_mapping.js`（须与 mapping 版本同步） |

> **硬门禁：** `stage1_approved≠true` → 禁止本阶段。  
> **严禁**对未命中项臆造模块；写入 `unmatched[]`，下游人审②必须处理。  
> **与 6.1 切片关系：** 若上游已按 `primary_object` 拆成多条 RP，则 **一片一 RP 一模块**；跨对象联测应落到 mapping 内「集成测试」。本 Script 仍只做关键词归属，不负责切片。
> **与 6.2 知识库关系：** C-MOD 写出后、3A 前运行 `kb/extract_kb.js --project-dir <工作区>`；仅按已匹配模块截取已确认历史知识，供测试点分析使用。

---

## 1. 目标

将 C-RP 中每个需求点匹配到 mapping 内的一级/二级模块，产出 **C-MOD**。

---

## 2. CLI

```bash
cd testcase-generation-skills/src/scripts
node stage3/stage3_module.js --project-dir <工作区>
node stage3/stage3_module.js --self-test
```

---

## 3. 输出 C-MOD（`module_attribution.json`）

```json
{
  "schema_version": "6.0",
  "requirement_title": "…",
  "mapping_version": "1.1",
  "mapping_version_ok": true,
  "attributions": [
    {
      "rp_id": "RP-001",
      "rp_title": "…",
      "module_l1": "销售",
      "module_l2": "销售",
      "module_match": "matched",
      "match_keyword": "销售单",
      "confidence": "high"
    }
  ],
  "unmatched": [],
  "unmatched_count": 0
}
```

- `mapping_version_ok=false` 时脚本 **告警** 仍继续（S3-03），须人工同步文档与 `module_keyword_mapping.js`。
- 重跑会清除 `stage3_approved`，并设置 `stage4_blocked_unmatched`。

---

## 4. 与旧文档

| 旧 | 新 |
|----|-----|
| `stage3.3_module_attribution.md` | **deprecated** → 本文 |
| `stage3.3_module.js` | **deprecated** → `stage3_module.js` |

---

## 5. 版本

| 版本 | 日期 | 说明 |
|------|------|------|
| 6.0 | 2026-07-22 | Demand 6.0：读 C-RP；SRC_ROOT templates；C-MOD 扁平 unmatched[] |
