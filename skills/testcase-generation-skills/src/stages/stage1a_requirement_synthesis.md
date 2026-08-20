---
stage_id: stage1a_requirement_synthesis
version: "6.0"
execution_type: hybrid
fast_path: true
trigger: default
estimated_duration: "10-25min"
quality_gate: "test_context_approved=true；C-RP 通过 schema；越界/进销存规则已应用"
inputs:
  - name: project_dir
    required: true
  - name: test_context.json
    required: true
    contract: C-CTX
    note: "须已人审①批准"
  - name: requirement_md
    required: true
    path: "input/需求文档/{title}.md"
outputs:
  - path: "script/stage1/requirement_points.json"
    contract: C-RP
depends_on:
  - stage1_context_checkpoint
deprecated_predecessor: stage1.2_deep_understanding.md
---

# Stage1A 需求点提取 + 越界判断（Demand 6.0.2）

| 项 | 内容 |
|----|------|
| 依据 | `demand/testcase-generation-demand6.0.md` §4.5 |
| 契约 | `contracts/requirement_points.schema.json` |
| 模板（按需） | `src/templates/需求文档过滤规则.md`（**先过滤**）、`隐式需求惯例.md`（只读） |
| 脚本 | `scripts/stage1/stage1a_finalize.js`、`validate_rp.js` |
| 导出 | `scripts/stage1/export_rp_xmind.js`（S1-11） |
| 人审 | [`stage1_checkpoint.md`](./stage1_checkpoint.md)（人审①′） |

> **硬门禁：** `progress_tracker.test_context_approved !== true` → **禁止**本阶段。  
> **禁止**在 1A 内改写产品/版本/端；需改则退回人审①。  
> **禁止**重新猜三维上下文；C-RP 内 `test_context` 必须等于已锁定 C-CTX 副本。

---

## 1. 目标

在已锁定测试上下文下，**一次 LLM 主生成**完成：

1. 需求点提取 → `confirmed_points` / `pending_points`  
2. 需求越界判断 → `out_of_bound_hints`（及必要时 pending）  
3. 进销存自检字段 → `inventory_checks`  

然后 Script 定稿校验 → 导出需求点 XMind → 人审①′。

---

## 2. 执行流程

```
检查 test_context_approved
        ↓
[Script] filter_requirement_doc.js
        → 物理剔除「需求背景」等整章（含子节）
        → 写 script/stage1/requirement_filtered.md
        ↓
读 requirement_filtered.md + 锁定 test_context
        （禁止再读 input/需求文档 原文）
        ↓
[LLM] 仅对过滤后正文产出草稿 JSON
        ⚠ 禁止复用历史 draft_rp.json：每次 filter 重跑或 skill 升级后，必须基于当前
           script/stage1/requirement_filtered.md 重新产出 draft（旧 draft 可能含已被过滤的
           「需求背景」内容，会被过滤审计拒定稿）
        ↓
[Script] stage1a_finalize.js --from-draft …
        → 重跑过滤；草稿背景词审计（失败则拒定稿）
        → 注入锁定 C-CTX；写 C-RP + validate
        ↓
[Script] export_rp_xmind.js
        ↓
人审①′（stage1_checkpoint.md）
```

CLI：

```bash
cd testcase-generation-skills/src/scripts

# 门禁检查
node stage1/validate_rp.js --project-dir <工作区> --gate-only

# ★ 提取前硬过滤（1A 必跑；finalize 也会再跑一遍）
node stage1/filter_requirement_doc.js --project-dir <工作区>

# LLM 只读 script/stage1/requirement_filtered.md → 写 draft.json
node stage1/stage1a_finalize.js --project-dir <工作区> --from-draft <draft.json> [--export]

# 校验 / 导出 / 批准
node stage1/validate_rp.js --project-dir <工作区>
node stage1/export_rp_xmind.js --project-dir <工作区>
node stage1/stage1a_finalize.js --project-dir <工作区> --approve
```

---

## 3. LLM Prompt（准度核心）

### 3.1 系统角色

你是进销存/零售 SaaS 测试分析助手。只根据给定需求原文与**已锁定**的测试上下文提取需求点，不做产品/版本/端的二次猜测。

### 3.2 输入

1. `requirement_title`  
2. **`script/stage1/requirement_filtered.md`（唯一正文；禁止读 input 原文）**  
3. 已锁定 `test_context`（只读；禁止改 in/out）  
4. 规则说明：`src/templates/需求文档过滤规则.md`  
5. 可选：`script/stage1/domain_facts.json`（本需求临时知识点；无则跳过）  
6. 可选：`隐式需求惯例.md` 相关节  

### 3.2.1 文档过滤（提取前强制 · 硬过滤）

| 动作 | 要求 |
|------|------|
| 脚本 | 先跑 `filter_requirement_doc.js`，整章剔除需求背景/调研/竞品/ROI/项目背景/未来规划等 |
| 子树 | 「需求背景」下的「核心规则 / 现状问题」**一并删除**，不得抽 RP |
| 输入 | LLM **只读** `requirement_filtered.md` |
| 禁止 | 标题以「现状问题」开头、或 detail 写「保留区 1.x / 需求背景」的 confirmed |
| 写法 | 可测点写成期望行为，勿复述旧问题 |

过滤后正文过空 → `pending_points` 说明「可测正文不足」，禁止用背景段凑 RP。

finalize 会对草稿做过滤审计；命中背景型 RP → **定稿失败**。

### 3.2.2 因果等价类与分层（Demand 6.1）

生成顺序：**先抽候选因果键 → 合并 → 再写 RP**。

每条 confirmed 在草稿中建议带（不进最终 C-RP schema，finalize 会剥离）：

| 字段 | 含义 |
|------|------|
| `trigger` | 触发/操作 |
| `primary_object` | 主业务对象 |
| `condition` | 关键条件 |
| `primary_outcome` | 主可观察结果 |
| `point_kind` | 可选：`rule` \| `scenario` |

规则：

- 同 `(trigger, primary_object, condition, primary_outcome)` → **只留一条** confirmed  
- `rule` 若可被某 `scenario` 完全蕴含 → 写入 scenario 的 detail，或 pending，不双 confirmed  
- 禁止仅靠「注意去重」软约束；finalize / validate 会对同键冲突 **定稿失败**

### 3.2.3 临时知识点（若存在 domain_facts.json）

- 遵守每条 `statement`；**不得**在 title/detail 中出现对应 `forbid_patterns`  
- 无该文件 → 跳过，不失败  
- 禁止读取 `session_facts.json` / `kb_applied.json` 并行文件  

### 3.3 必须产出的草稿字段

```json
{
  "requirement_title": "<与工作区一致>",
  "requirement_essence": "一句话本质",
  "domain_objects": ["..."],
  "state_machine": ["..."],
  "boundaries": ["..."],
  "confirmed_points": [
    { "id": "RP-001", "title": "...", "priority_hint": "P0", "detail": "..." }
  ],
  "pending_points": [
    { "id": "RP-010", "title": "...", "pending_reason": "...", "detail": "..." }
  ],
  "out_of_bound_hints": [
    { "id": "OOB-001", "summary": "...", "reason": "...", "source_excerpt": "..." }
  ],
  "inventory_checks": {
    "affects_stock": false,
    "affects_payment": false,
    "affects_order_lifecycle": true
  }
}
```

**不要**在草稿里改 `test_context`（由 finalize 注入锁定副本）。

### 3.4 提取规则

| 规则 | 说明 |
|------|------|
| 过滤优先 | 先划保留区，再提取；过滤区不得进 confirmed |
| 覆盖 | 保留区内的功能说明 / 规则 / 异常 / 埋点 / 非目标 / 现状问题 落到 confirmed 或 pending |
| ID | `RP-001` 起连续编号；越界用 `OOB-001` |
| 优先级 | P0 主路径阻断；P1 重要；P2 一般；P3 低优/回归相关 |
| 待确认 | 原文歧义、缺验收标准 → `pending_points`，写清 `pending_reason` |
| 隐性需求 | 仅当模板规则与**保留区**原文强相关时补充，并在 detail 注明「隐性」 |
| 本质句 | `requirement_essence` 概括本期可测改动，禁止复述市场/ROI/立项背景 |

### 3.5 越界判断（必须做）

对照锁定上下文：

- 原文若要求实现/改造 **out_of_scope** 的产品/版本/端 → `out_of_bound_hints`  
- 「非目标」已声明不做、但又在功能里当成要做 → 越界或 pending  
- 不得把 out_of_scope 端写成主路径 confirmed 而不加说明  

### 3.6 进销存自检

| 字段 | 何时 true |
|------|-----------|
| `affects_stock` | 涉及库存数量/成本/出入库/盘点等 |
| `affects_payment` | 涉及收账/支付/结算资金 |
| `affects_order_lifecycle` | 涉及单据保存/提交/审核/作废等状态 |

为 true 时，`confirmed_points` 或 `pending_points` 中须有对应链路点；否则 Script 会补 pending 或校验失败提示。

---

## 4. Script 定稿职责（finalize）

1. 断言 `test_context_approved`  
2. 重跑 `filter_requirement_doc`；只读过滤后正文  
3. 过滤审计 + **canonical_key 同键冲突** + **domain_facts forbid**（无文件跳过）  
4. 注入锁定 C-CTX；剥离草稿扩展字段后写 C-RP  
5. 关键词辅助：补全/校验 `inventory_checks`；扫描明显越界句 → 合并 `out_of_bound_hints`  
6. `validate` C-RP（含同键弱检 / facts，若仍可读）  
7. 写 `script/stage1/requirement_points.json`  
8. 清除或保持 `stage1_approved=false`（重新定稿时清 false）  
9. 可选导出 XMind  

门禁失败信息写入 **finalize 抛错 / validate_rp.errors**，**不**新建 `quality_gate_report.json`。

---

## 5. 质量门禁

1. [ ] `test_context_approved=true`  
2. [ ] 已生成 `requirement_filtered.md`；1A **只读**该文件（未读 input 原文）  
3. [ ] finalize 过滤审计通过（无「现状问题:」/需求背景型 RP）  
4. [ ] C-RP 通过 schema（含嵌入的 test_context 语义）  
5. [ ] C-RP.`test_context` 与 `script/config/test_context.json` 一致（finalize 保证）  
6. [ ] inventory 为 true 时有对应点或明确 pending  
7. [ ] 未改三维枚举  

失败 → 非 0；不得人审①′通过。

---

## 6. 与旧文档

| 文件 | 状态 |
|------|------|
| `stage1.2_deep_understanding.md` | deprecated → 本文 |
| `stage1.5_output_validation.md` | deprecated → `stage1_checkpoint.md` + validate_rp |

---

## 7. 版本

| 版本 | 日期 | 说明 |
|------|------|------|
| 6.0 | 2026-07-21 | 首版：依赖已锁定 C-CTX；含越界与进销存 |
| 6.0.1 | 2026-07-24 | Prompt 软过滤 |
| 6.0.2 | 2026-07-24 | **硬过滤**：脚本剔除需求背景整章；1A 只读 filtered.md；finalize 审计拒收背景型 RP |
