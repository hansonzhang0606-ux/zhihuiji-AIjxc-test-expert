---
stage_id: stage3_checkpoint
version: "6.4.0"
execution_type: human
fast_path: true
trigger: default
estimated_duration: "5-25min"
quality_gate: "用户「无需修改」且 unmatched_count=0、path_gaps/api_assertion_gaps 均为空 → stage3_approved=true"
inputs:
  - name: test_points.xmind
    required: true
  - name: test_points.json
    required: true
    contract: C-TP
outputs:
  - name: stage3_approved
    path: "script/config/progress_tracker.json"
depends_on:
  - stage3b_matrix_tag_filter
---

# 人审② — 测试点确认（Demand 6.0.3 / 6.0.4）

| 项 | 内容 |
|----|------|
| 依据 | `demand/testcase-generation-demand6.0.md` §6.7、§6.9、**§8.3**；**6.1 §七 人审职责** |
| 展示 | `output/测试点_{title}.xmind`（**只读**） |
| 真源 | `script/stage3/test_points.json`（须经 **3B** 裁剪） |
| 审计 | `script/stage3/matrix_filter_report.json`；**6.1** `script/stage3/merge_report.json`（absorb / facts / regression_skipped） |
| 批准 | `node stage3/stage3a_finalize.js --project-dir <WS> --approve` |

---

## 1. Agent 必须停住（展示顺序）

面向用户时 **按下列顺序** 输出，避免一上来就丢声明导致用户忽略：

1. **摘要**（先看内容）：测试本质、测试点清单（可按 P0/P1/P2/P3 分区）、合并记录、**merge_report 扩展**（`absorb_candidates` / `regression_skipped` / `facts_applied` / 纯度告警若有）、由 `path_gaps` 与 `api_assertion_gaps` 渲染的两个缺口专节、**测试点标签匹配是否准确**（若有）  
2. **统计**（再看规模）：`K = test_points.length`、**unmatched_count**、P0/P1 数量、矩阵裁剪告警条数等  
   - **K ≤ 40** → 请直接列举改动【补充/修改/删除】  
   - **K > 40** → 请按清单模板填写后整段发回  
3. **允许**多次改动；**不强制**二次卡点——可继续改，或直接「无需修改」批准  
4. **最后询问时再声明**（与「请问是否 OK」同段出现，勿放到开场最前）：  
   - XMind（`output/测试点_{title}.xmind`）**只供查看**；真源是 `script/stage3/test_points.json`  
   - 改动请在本对话说明，直接改 XMind **不生效**  
   - 然后问：测试点是否 OK？如需继续改动请说明【删除】/【新增】/【修改】；无改动请回复「无需修改」以批准进入 Stage 4 生成用例。

若存在 `matrix_filter_report.json` 的 `warnings`，须在摘要或统计段向用户朗读中文 `message`（如「该功能模块无匹配标签」）。

禁止超时默认「无需修改」。

---

## 2. 用户选项

| 条件 | 动作 |
|------|------|
| 「无需修改」且 `unmatched_count===0`、两个 gap 数组为空 | `--approve` |
| 仍有未匹配 | **禁止** approve；引导补 mapping / 改 RP / 改 JSON |
| `path_gaps` 非空 | **禁止** approve；补 C-TP 导航步骤或已确认 facts 后重新 finalize |
| `api_assertion_gaps` 非空 | **禁止** approve；补对应 technical ref 的 assertions 后重新 finalize |
| 有改动 | 改 C-TP → `validate_tp` → **可选再跑 3B** → finalize/`export_tp_xmind` → diff 摘要 → 可继续改或批准 |
| 同轮「改这些 + 无需修改/可以过了」 | 先应用改动并校验通过，再 approve（未匹配仍禁止） |

默认不重跑 1A/1CTX。

### 2.1 缺口专节（唯一真源）

人审展示必须直接读取 `script/stage3/merge_report.json`：

1. **路径缺口**：逐项展示 `tp_id / page_id / platform / reason`，可选展示 `element_name`。
2. **接口断言缺口**：逐项展示 `tp_id / technical_ref_index / missing_fields / reason`。

人工答复应用到 C-TP 或 facts 后，必须重新 finalize 并再次读取这两个数组。禁止把展示文案、聊天清单或 XMind 节点保存成第二份缺口数据。

### 2.2 小（K≤40）— 直接列举

```text
【补充】…
【修改】TP-003：优先级改为 P0；期望第 2 条改为…
【删除】TP-008
```

### 2.3 大（K>40）— 清单模板

摘要与统计展示完毕后，发出下列模板；**XMind 只读声明放在末尾询问段**（见 §1 第 4 条），不要单独顶在开场最前：

由于测试点总数 K={K} > 40，以下提供改动清单模板（如需修改请填写；无需修改直接回复「无需修改」）：

【测试点改动清单】  
[删除] - TP-xxx：删除原因  
[新增] - 新点标题 | 优先级（P0/P1/P2/P3）| 模块 | 关联 RP-xxx | 步骤要点 | 期望要点  
[修改] - TP-xxx：修改后标题 | 修改后描述/步骤/期望  
[待确认→已确认] - TP-10x：补充说明/确认结论  
[待确认→删除] - TP-10x：删除原因  

### 未匹配（若有）  
处理：补 mapping / 改模块 / 删除该 TP | 说明  

---  
**声明：** XMind（output/测试点_{title}.xmind）仅供查看；真源是 test_points.json；如有改动请在对话中说明，直接修改 XMind 不会生效。  

请问：测试点是否 OK？如需继续改动请说明【删除】/【新增】/【修改】；无改动请回复「无需修改」以批准进入 Stage 4 生成用例。

**禁止**在模板或开场白中使用英文状态词；须用「待确认」「已确认」等中文。

单批建议 ≤20 行。

### 2.4 本关「应处理 / 不应反复处理」（demand 6.1 §七）

| 应处理 | 不应反复处理 |
|--------|----------------|
| 临时知识点（`domain_facts` / `facts_applied`）口径是否正确 | 拖拽排序（Stage4 `sort_key` 已处理） |
| `absorb_candidates` 是否该独立成条（覆盖争议） | 删除「同逻辑多端」副本（Stage4 禁止端膨胀） |
| 是否真正需要跨对象集成条 | 因步骤「提及」依赖对象而删 TP（纯度只检标题/期望） |
| finalize 失败项：悬空 RP、auto_skip 回归误生成 | 在 XMind 里改标签当真源 |

### 2.5 可选：质量门禁一页总览（6.1 P2）

用户明确要求汇总时：

```bash
node lib/quality_gate_summary.js --project-dir <工作区> --write
```

Agent 可朗读 `human_review_pending` 与 stage3/stage4 计数；**默认流程不自动生成**。

### 2.6 ⏱ 时间追踪（04 生成测试点，approve 后强制）

`--approve` 成功后、进入 Stage4 **之前**，按 [`time_tracking.md`](../scripts/time-tracking/prompts/time_tracking.md) §四 收集：

- 环节名：**人审② 测试点确认（对应「生成测试点」）**；step_code=`04`，参考值 3~5 小时
- 强制询问 → 解析 → **二次确认** → 写本地 JSONL（用户故事用会话缓存值）
- 拒绝反馈 → 最多追问 2 次，记录 0 标注「用户未反馈」，**不阻塞**进入 Stage4

> ⛔ **立即触发+阻塞（v5.4）**：approve 成功后**必须先完成上述时间收集**（含二次确认+写本地 JSONL），**禁止先展示「进入 Stage4」选项**；用户拒绝记录 0 后，才允许进入 Stage4。

```bash
python src/scripts/time-tracking/scripts/record_time_saved.py \
  --employee "{姓名}" --user-story "{PRJ-xxx 需求名}" \
  --step "生成测试点" --step-code "04" --hours {小时} --biz-line "{biz_line}"
```

---

## 3. 禁止

- 未匹配未清时进入 Stage4 / approve  
- `path_gaps` 或相关 `api_assertion_gaps` 非空时 approve
- 无用户指令全量重做 Stage1  
- 把「只改了 XMind」当成已生效  

---

## 4. 版本

| 版本 | 日期 | 说明 |
|------|------|------|
| 6.0 | 2026-07-22 | 未匹配硬门禁 + stage3_approved |
| 6.0.3 | 2026-07-22 | §8.3：XMind 只读；≤40/清单；可迭代、不强制二次卡点 |
| 6.0.4 | 2026-07-23 | 大清单须含 XMind 只读说明；模板全中文 |
| 6.0.5 | 2026-07-23 | 人审②展示顺序：摘要→统计→末尾再声明并询问 |
| 6.1.0 | 2026-07-28 | merge_report 扩展摘要；demand §七 裁决边界 |
| 6.1.1 | 2026-07-28 | 可选 quality_gate_summary --write |
| 6.4.0 | 2026-08-06 | 人审从两类 gap 真源渲染；非空阻断批准 |
| 6.4.1 | 2026-08-19 | 嵌入时间追踪：approve 后强制收集 04 生成测试点 |
