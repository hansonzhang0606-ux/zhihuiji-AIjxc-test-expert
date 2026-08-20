---
stage_id: stage3a_testpoint_synthesis
version: "6.4"
execution_type: hybrid
fast_path: true
trigger: default
estimated_duration: "15-35min"
quality_gate: "stage1_approved；C-MOD 已生成；C-TP schema 通过；未匹配、路径缺口、相关接口断言缺口须人审处理"
inputs:
  - name: requirement_points.json
    required: true
    contract: C-RP
  - name: module_attribution.json
    required: true
    contract: C-MOD
  - name: test_context.json
    required: true
    contract: C-CTX
outputs:
  - path: "script/stage3/test_points.json"
    contract: C-TP
depends_on:
  - stage3_module
deprecated_predecessor: stage3.4_test_point_extraction.md
---

# Stage3A 测试点合成（Demand 6.0 Fast Path）

| 项 | 内容 |
|----|------|
| 依据 | `demand/testcase-generation-demand6.0.md` §6 |
| 契约 | `contracts/test_points.schema.json` |
| 模板（只读） | `src/templates/优先级规则.md`、`标签规则.md` |
| Script | `stage3a_finalize.js`、`nfr_rules.js`、`validate_tp.js`、`export_tp_xmind.js` |
| 人审 | [`stage3_checkpoint.md`](./stage3_checkpoint.md) |

> **模块只能来自 C-MOD / mapping。** LLM 不得自创一级/二级模块名。  
> **核心开单/收账/支付禁止等价合并。**  
> 非功能：仅当 `nfr_rules` 条件满足时生成（性能/安全等）。
> P0 页面交互须对每个目标页写且只写一次 `进入目标页（路径链）`；统一规则见 `scripts/shared/navigation_path.js`。

---

## 1. 目标

单次 Hybrid 完成：

1. 测试点提取（覆盖 C-RP + 回归 hints）  
2. 优先级 / 产品·版本·端标签（对齐锁定 C-CTX）  
3. 等价合并（四大规则）+ `merge_report`  
4. 非功能规则注入（Script 可预判）  
5. 进销存底线检查（不满足 → pending 或人审高亮）

---

## 2. 执行流程

```
检查 stage1_approved
        ↓
[Script] stage3_module.js → C-MOD
        ↓
[Script] extract_kb.js → 已确认 KB 历史切片合并 domain_facts.json（无命中不阻断）
        ↓
[LLM] 按下方 Prompt 产出草稿 JSON（test_points + merge_report）
        ↓
[Script] stage3a_finalize.js --from-draft … [--export]
        → 注入/校正模块归属
        → 附着 technical_refs
        → 生成 merge_report.path_gaps / api_assertion_gaps
        → schema + 进销存/nfr 告警
        → 写 C-TP + merge_report.json
        → 导出 output/{title}_测试点.xmind
        ↓
人审②（stage3_checkpoint.md）
```

```bash
cd testcase-generation-skills/src/scripts
node stage3/stage3_module.js --project-dir <WS>
node kb/extract_kb.js --project-dir <WS>
# LLM → draft.json
node stage3/stage3a_finalize.js --project-dir <WS> --from-draft draft.json --export
node stage3/validate_tp.js --project-dir <WS>
# 人审② 无需修改且 unmatched=0
node stage3/stage3a_finalize.js --project-dir <WS> --approve
```

---

## 3. LLM Prompt（准度核心）

### 3.1 系统角色

你是进销存产品测试设计专家。根据**已确认需求点**与**已锁定模块归属/测试上下文**，一次生成测试点清单。模块名称必须使用输入 C-MOD 中的 `module_l1`/`module_l2`；未匹配 RP 对应测试点必须 `module_match=unmatched`。

### 3.2 输入（Agent 须 Read）

1. `script/stage1/requirement_points.json`（含 `test_context`、`inventory_checks`、`regression_hints`）  
2. `script/stage3/module_attribution.json`  
3. 可选：`script/stage1/domain_facts.json`（C-MOD 后截取的**已确认** KB 历史知识 + 本需求人审临时口径；无则跳过；禁止并行 kb_applied/session_facts）  
4. 按需：`src/templates/优先级规则.md`、`标签规则.md`（相关节）  
5. 可选：`input/技术文档/*`

### 3.2.1 场景切片与主断言纯度（Demand 6.1）

| 规则 | 说明 |
|------|------|
| 切片 | 按 **primary_object（主业务对象）** 拆场景后再挂 C-MOD 模块；一片一模块 |
| 必须拆 | 多个主对象且各自有独立可观察结果 |
| 不拆 | 其他对象仅出现在前置/步骤依赖中 |
| 集成 | 仅当必须验证多对象协同 → `module_l2=集成测试`（或 mapping 等价）；允许多对象主断言 |
| 纯度 | **只约束** `title` + `expected_outline`；步骤可提及依赖对象 |
| 草稿可选字段 | `primary_object`、`asserted_objects[]`、`dependency_objects[]`（finalize 剥离，不进 C-TP schema） |
| 禁止 | 把单需求业务对照表（如门店/员工）写进通用 Prompt 硬编码 |

未匹配 RP → `module_match=unmatched`，**禁止自创**模块名。

### 3.2.2 可合并 vs 必须拆 / absorb

- 同因果键（trigger×primary_object×condition×primary_outcome）→ 合并；不同主对象或主结果不可蕴含 → 必须拆  
- 纯计算/纯触发且已被主路径步骤覆盖 → 可标 `coverage_candidate: "absorb"`（写入 `merge_report.absorb_candidates`，默认不独立成 Stage4 TC）  
- 禁止标题/步骤写「见其他 TP」「同上」等模糊指代（定稿失败）

### 3.2.3 临时知识点固化

若存在 `domain_facts.json`：遵守 `statement`，禁止 `forbid_patterns`；断言须落入某 TP 的标题或期望（可追溯于 `merge_report.facts_applied`）。**Stage4 不再读该文件。**

### 3.2.4 导航与接口引用（Demand 6.4）

- 适用页面交互的 P0，每个目标页在 `steps_outline` 中恰有一条导航步骤：`进入目标页（起始页 → 操作 → 目标页）`。
- 到达目标页后的元素操作不得重复完整路径；历史分隔符仅供读取兼容，新写统一使用 `→`。
- API-only、后台任务、纯 NFR、无 UI 场景不生成页面路径。
- 已确认的 `backend_api technical_refs` 可携带结构化 `assertions[]`；禁止从自然语言猜 Path、字段或期望。
- 缺失信息只写入 `merge_report.path_gaps[]` / `api_assertion_gaps[]`，由人审②渲染，不另建缺口清单。

### 3.3 必须产出的草稿字段

```json
{
  "test_essence": "一句话测试本质",
  "test_points": [
    {
      "id": "TP-001",
      "title": "…",
      "priority": "P0",
      "module_l1": "销售",
      "module_l2": "销售",
      "module_match": "matched",
      "product_tags": ["ailit"],
      "version_tags": ["单店版", "多店版"],
      "platform_tags": ["PC端", "APP端"],
      "source_rp_ids": ["RP-001"],
      "steps_outline": ["…"],
      "expected_outline": ["…"],
      "is_core_scenario": false,
      "is_regression": false,
      "nfr_type": null
    }
  ],
  "merge_report": {
    "rules_applied": ["core_no_merge"],
    "entries": []
  }
}
```

说明：
- `product_tags`/`version_tags`/`platform_tags` 须对齐 C-CTX 的 in_scope（回归点可打 out_of_scope 对应产品/端）；JSON **仍落盘数组**。
- XMind 展示由 `formatDisplayLabels` 按维合并：上例为 `PC端/APP端` · `国际版`（ailit 下单店+多店为全选，版本不展示）。
- 产品展示简称：智慧记AI进销存→国内版，ailit→国际版；版本简称：开单/单店/多店。
- 版本、角色仅非全选时展示；见 `templates/标签规则.md` §6.2。
- `nfr_type` ∈ `performance|security|compatibility|integration|null`。

### 3.4 提取与优先级

- 每个 confirmed RP ≥1 条主路径测试点；pending 可标待确认（标题加「待确认」或后续人审）  
- `regression_hints`：**仅** `auto_skip_tp !== true` 的 hint → 1 条 P3、`is_regression=true`；标 skip 的默认**不生成** TP（人审①已将 `auto_skip_tp` 改为 `false` 的除外）  
- 优先级读 `优先级规则.md`：核心路径 P0/P1，回归 P3  

### 3.5 等价合并（顺序）

1. **核心场景禁合并**（开单/收账/支付）→ `rules_applied` 含 `core_no_merge`  
2. 实现逻辑等价 → `logic_equivalence`  
3. 数据特征等价 → `data_feature_equivalence`  
4. 用户预期等价 → `user_intent_equivalence`  
5. 风险预测等价 → `risk_prediction_equivalence`  
6. 场景对需求贡献 &lt; 60% → 不补充（`value_below_60`）  
7. 覆盖吸收 → `absorb_coverage`（候选进 `absorb_candidates`，非 entries 合并）

合并写入 `merge_report.entries[{rule,kept,merged_away,reason}]`。  
6.1 扩展（同文件）：`absorb_candidates` / `purity_violations` / `canonical_key_conflicts` / `facts_applied` / `vague_references`。

### 3.6 非功能（与 Script 一致）

| 类型 | 仅当 |
|------|------|
| performance | 搜索/查询/批量/AI 提取 |
| security | 新增输入框 **且** 支持长文本 |
| 其他 | 文档明确要求时 |

否则 `nfr_type=null`，不硬凑。

### 3.7 进销存底线

若 `inventory_checks` 为 true：

| 标志 | 至少覆盖 |
|------|----------|
| affects_order_lifecycle | 关键状态迁移（含失败若文档提及） |
| affects_stock | 数量/仓库（有则批次或序列号）端到端一条 |
| affects_payment | 成功 + 一条典型失败/撤销（若支持） |

不满足 → 增加「待确认」测试点或在人审②高亮，**禁止静默省略**。

---

## 4. Script 定稿职责

`stage3a_finalize.js`：

- 用 C-MOD 校正/补齐模块字段；未匹配 RP 补占位 TP  
- 质量门禁：主断言纯度、模糊指代、悬空 RP、canonical_key、domain_facts forbid/追溯、**auto_skip 回归** → 写入 **merge_report 扩展字段**  
- 在 schema 校验前确定性生成并排序 `path_gaps[]` / `api_assertion_gaps[]`
- schema + `validate_tp`（含进销存/nfr 告警）  
- 写 `test_points.json`、`merge_report.json`（无平行 `quality_gate_report`）  
- `--export` → `output/测试点_{title}.xmind`  
- `--approve`：要求 `unmatched_count===0` 且两个阻断缺口数组均为空

---

## 5. 版本降级/增购过期场景规则（人审沉淀，写入 domain_facts）

> 以下规则已在本需求 `domain_facts.json` 中固化，若同类型需求复现，应作为默认假设：

| 规则 | 说明 |
|------|------|
| 操作描述 | 测试步骤中只写“将版本降级”，不写“通过运营后台/运营平台” |
| 员工处理 | 版本降级后员工全部停用；不保留“员工不超限则保留原员工”场景 |
| 门店过期 | 门店增购过期后超限 → 弹窗让老板选择保留门店 |
| 员工过期 | 员工增购过期后超限 → 将最后增加的 N 个（超限个数）员工置灰 |

## 6. 版本

| 版本 | 日期 | 说明 |
|------|------|------|
| 6.0 | 2026-07-22 | 合并旧 3.2/3.4；单次 Hybrid + Script 定稿 |
| 6.0.1 | 2026-07-24 | 补充展示标签合并规则（formatDisplayLabels）说明 |
| 6.1.0 | 2026-07-28 | 切片/纯度/absorb/facts 固化；merge_report 扩展；回归 auto_skip |
| 6.1.1 | 2026-07-28 | 补充版本降级/增购过期场景规则 |
| 6.4.0 | 2026-08-06 | 每页一次导航；路径/API 断言缺口与批准阻断 |
