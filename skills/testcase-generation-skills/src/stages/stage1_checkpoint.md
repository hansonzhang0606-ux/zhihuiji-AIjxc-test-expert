---
stage_id: stage1_checkpoint
version: "6.1.0"
execution_type: human
fast_path: true
trigger: default
estimated_duration: "5-20min"
quality_gate: "用户确认无需修改 → stage1_approved=true"
inputs:
  - name: requirement_points.json
    contract: C-RP
  - name: requirement_points_xmind
    path: "output/需求点_{title}.xmind"
outputs:
  - path: "script/config/progress_tracker.json"
    description: "stage1_approved=true"
depends_on:
  - stage1a_requirement_synthesis
---

# 人审①′（需求点）CHECK_POINT

| 项 | 内容 |
|----|------|
| 依据 | `demand/testcase-generation-demand6.0.md` §4.6、**§8.3**；**6.1 §七 人审职责** |
| 前置 | C-RP 已定稿；建议已导出 `output/需求点_{title}.xmind` |
| 真源 | `script/stage1/requirement_points.json` |
| 区别 | **人审①**只确认产品/版本/端；**本关**确认需求点 |

---

## 1. 硬性说明（Agent 必须先说）

1. **XMind 只供查看**，路径：`output/需求点_{requirement_title}.xmind`  
2. **请勿只在 XMind 里改**；要改必须在本对话说明，否则下游仍用旧 JSON  
3. 统计条数：`N = confirmed_points.length + pending_points.length`  
   - **N ≤ 20（小）** → 请直接列举改动（仍须先声明 XMind 只读，见 §1 第 1～2 条）  
   - **N > 20（大）** → 须先声明 XMind 只读，再下发改动清单模板（见 §3.2）  
4. **允许**多次补充/修改；**不强制**改完后再卡一轮确认——你可继续给改动，或直接回复「无需修改」批准；同条消息「改这些并批准」也可  
5. **进销存影响标记**（`inventory_checks`）仅在 JSON 内供 Agent 自检，**不在 XMind 展示**，用户无需关注  

禁止超时自动「无需修改」。

---

## 2. 检查焦点

| 项 | 问题 |
|----|------|
| 过滤 | 是否仍出现「现状问题:…」或需求背景出处？是否未读原文、只用了 requirement_filtered.md？ |
| 同键 / 背景 | finalize 是否已通过 `canonical_key` 与背景词门禁？（**勿**在此关手工删「重复句」代替 Script） |
| 临时知识点 | 若存在 `script/stage1/domain_facts.json`：口径是否正确？是否已反映到 RP 标题/期望？ |
| 覆盖 | 功能/异常/埋点等是否齐全？ |
| 待确认 | `pending_points`（待确认需求点）是否可接受？ |
| 越界 | `out_of_bound_hints`（越界提示）是否处理？ |
| 上下文 | 三维仍正确？（要改 → 退回人审①，本关不改三维） |

### 2.1 本关「不应反复处理」（demand 6.1 §七）

以下由 Script / 后续 Stage 处理，**不要**在人审①′要求用户手工做：

- 拖拽排序、删「同逻辑多端」副本  
- 因测试点步骤「提及」依赖对象而删 RP  
- 晋升长期 KB（须走 6.2「补充知识库」，非 Fast Path 默认）

---

## 3. 用户选项

| 用户意图 | Agent 动作 |
|----------|------------|
| **无需修改**（或等价） | `stage1a_finalize.js --approve` |
| **有改动**（小：列举；大：填清单） | 改 C-RP → `validate_rp` → 重导 XMind → 简要 diff → **等待用户继续改或「无需修改」**（不强制二次卡点） |
| **上下文不准** | 退回 `stage1_context_checkpoint`，本关不改三维 |

### 3.1 小需求（N≤20）— 直接列举

**Agent 开场白须包含：** XMind 只读声明（§1 第 1～2 条）+ 当前 N 条 + 请直接列举改动。

提示用户可用：

【补充】…  
【修改】RP-003：…  
【删除】RP-008  
【待确认→已确认】RP-10x：…  
【待确认→删除】RP-10x：…

自然语言亦可；锚点不清则追问，禁止瞎改。

### 3.2 大需求（N>20）— 清单模板

**Agent 须先声明 XMind 只读（§1 第 1～2 条），再发出**下列模板供复制：

【重要说明】  
1. XMind 文件（output/需求点_{title}.xmind）**仅供查看**，在 XMind 里修改**不会生效**。  
2. 如需改动，请**在本对话中说明**；Agent 会修改 JSON 后重新导出 XMind。

由于总需求点数 N={N} > 20，以下提供改动清单模板（如需修改请填写；无需修改直接回复「无需修改」）：

【需求点改动清单】  
[删除] - RP-xxx：删除原因  
[新增] - 新点标题 | 优先级（P0/P1/P2/P3）| 详细描述  
[修改] - RP-xxx：修改后标题 | 修改后描述  
[待确认→已确认] - RP-10x：补充说明/确认结论  
[待确认→删除] - RP-10x：删除原因  

请问：需求点是否 OK？如需继续改动请说明【删除】/【新增】/【修改】；无改动请回复「无需修改」以批准进入 Stage 3 生成测试点。

**禁止**在模板或开场白中使用英文状态词（如 Pending、Confirmed）；须用「待确认」「已确认」等中文。

大单单批建议 ≤20 行；超出请分批。

---

## 4. 批准命令

cd testcase-generation-skills/src/scripts  
node stage1/stage1a_finalize.js --project-dir <工作区> --approve

→ `stage1_approved=true`。

### 4.1 ⏱ 时间追踪（02 需求评审，approve 后强制）

approve 成功后、进入 Stage3 **之前**，按 [`time_tracking.md`](../scripts/time-tracking/prompts/time_tracking.md) §四 收集：

- 环节名：**人审①′ 需求点确认（对应「需求评审」）**；step_code=`02`，参考值 2~3 小时
- 强制询问 → 解析 → **二次确认** → 写本地 JSONL（用户故事用会话缓存值）
- 拒绝反馈 → 最多追问 2 次，记录 0 标注「用户未反馈」，**不阻塞**进入 Stage3

> ⛔ **立即触发+阻塞（v5.4）**：approve 成功后**必须先完成上述时间收集**（含二次确认+写本地 JSONL），**禁止先展示「进入 Stage3」选项**；用户拒绝记录 0 后，才允许进入 Stage3。

```bash
python src/scripts/time-tracking/scripts/record_time_saved.py \
  --employee "{姓名}" --user-story "{PRJ-xxx 需求名}" \
  --step "需求评审" --step-code "02" --hours {小时} --biz-line "{biz_line}"
```

---

## 5. 话术骨架

请审阅需求点（**XMind 只读预览，改动请在本对话说明**）：  
output/需求点_{title}.xmind  
真源 JSON：script/stage1/requirement_points.json  
当前需求点 N 条 → {请直接列举改动 | 请按清单模板填写}

请回复其一：  
1) 无需修改（批准进入 Stage 3 生成测试点）  
2) 有改动：说明【删除】/【新增】/【修改】（列举 / 填清单）  
3) 上下文不准（退回人审①）

说明：可多次给改动；不强制改完再确认一轮——改完说「无需修改」即可批准。

---

## 6. 版本

| 版本 | 日期 | 说明 |
|------|------|------|
| 6.0 | 2026-07-21 | 人审①′与人审①分离 |
| 6.0.3 | 2026-07-22 | §8.3：XMind 只读；小/大分流；可迭代、不强制二次卡点 |
| 6.0.4 | 2026-07-23 | 大清单须含 XMind 只读说明；模板全中文；XMind 不展示进销存影响标记 |
| 6.1.0 | 2026-07-28 | 对齐 demand §七：domain_facts / canonical；明确不应拖排序类手工 |
| 6.2.0 | 2026-08-19 | 嵌入时间追踪：approve 后强制收集 02 需求评审 |
