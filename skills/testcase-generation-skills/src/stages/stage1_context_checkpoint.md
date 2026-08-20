---
stage_id: stage1_context_checkpoint
version: "6.1"
execution_type: human
fast_path: true
trigger: default
estimated_duration: "1-5min"
quality_gate: "用户确认产品/版本/端准确 → test_context_approved=true"
inputs:
  - name: test_context.json
    required: true
    contract: C-CTX
outputs:
  - path: "script/config/progress_tracker.json"
    description: "test_context_approved=true"
depends_on:
  - stage1_context
---

# 人审①（上下文）CHECK_POINT

| 项 | 内容 |
|----|------|
| 依据 | `demand/testcase-generation-demand6.1.md` §5.1（回归策略）；上下文识别沿用 6.0 §4.4 |
| 前置 | 已跑通 `stage1_context.js`，C-CTX 校验通过 |
| 后续 | **仅当** `test_context_approved=true` 才允许 1A（需求点+越界） |

---

## 1. 必须向用户展示

从 `script/config/test_context.json` 展示（对话表格即可，无需 XMind）：

| 维度 | 本次涉及（in_scope） | 不涉及（out_of_scope） | 置信度 | 来源 |
|------|----------------------|------------------------|--------|------|
| 产品线 | 星火 / 智慧记 / 智慧记零售（来自 Confluence 父级） | — | — | parent |
| 产品 | … | … | high/medium/low | parent/title/body/default |
| 版本 | … | … | … | … |
| 端 | … | … | … | … |

若 `context_recognition.json` 含 `unsupported_product_line`：**禁止 approve**，告知用户 Skills 仅支持星火（智慧记AI进销存/ailit），确认是智慧记/零售需求后**停止**。

附：`regression_hints` 条数及 **auto_skip 条数**（默认 skip 的 hint 不会在 3A 生成回归 TP；人审①可显式将 `auto_skip_tp` 改为 `false` 以保留）。

脚本已打印同等摘要时，Agent 可直接引用终端输出，避免重复造表。

### 1.1 回归策略（6.1）

展示 `regression_hints` 时须区分：

| 字段 | 含义 |
|------|------|
| `auto_skip_tp: true` | **默认不生成** 3A 回归 TP（非星火产品线：智慧记/智慧记零售；非本需求端：out_of_scope 平台） |
| `auto_skip_tp: false` 或未标 | 3A 应对该 hint 生成 1 条 P3、`is_regression=true` |

人审确认项（追加）：

> **上述回归策略是否符合预期？** 若需对 skip 项补回归，请说明并将对应 hint 的 `auto_skip_tp` 改为 `false` → validate → 再 approve。

---

## 2. 核心确认问题

> **该需求适配的产品 / 版本 / 端是否准确？**

选项（须用户明确回复，禁止超时默认通过）：

1. **准确 / 无需修改** → 执行批准（**仅星火产品线**）
2. **需修改** → 按用户说明改 `test_context.json`（仅合法枚举）→ `validate` → 再次回到本 CHECK_POINT  
3. **确认为智慧记 / 智慧记零售（非星火）** → **停止**，不 approve，不进入 1A  
4. **不确定** → 保持 `test_context_approved=false`，澄清后再审；**禁止进 1A**

---

## 3. 批准动作

```bash
cd testcase-generation-skills/src/scripts
node stage1/stage1_context.js --project-dir <工作区> --approve
```

效果：

- `progress_tracker.json` 写入 `test_context_approved: true`
- 各维若仍为识别结果，可将 `source` 标为 `user_confirmed`（脚本 `--approve` 行为）
- **不**设置 `stage1_approved`（那是人审①′ / 需求点）

---

## 3.1 ⏱ 时间追踪（01 文档整理，approve 后强制）

`--approve` 执行成功后、进入 1A **之前**，按 [`time_tracking.md`](../scripts/time-tracking/prompts/time_tracking.md) §四 收集：

- 环节名：**人审① 上下文确认（对应「文档整理」）**；step_code=`01`，参考值 2~4 小时
- 强制询问节省时间 → 解析（小时/人天，1人天=8小时）→ **二次确认** → 写本地 JSONL
- 首次追踪若会话尚未缓存用户故事，在本轮询问中一并收集「PRJ 编号+名称」
- 用户拒绝反馈 → 最多追问 2 次，仍拒绝则记录 0 并标注「用户未反馈」，**不阻塞**进入 1A

```bash
python src/scripts/time-tracking/scripts/record_time_saved.py \
  --employee "{姓名}" --user-story "{PRJ-xxx 需求名}" \
  --step "文档整理" --step-code "01" --hours {小时} --biz-line "{biz_line}"
```

---

## 4. 硬门禁

| 条件 | 动作 |
|------|------|
| `test_context_approved !== true` | **禁止**启动需求点提取（1A） |
| `unsupported_product_line` 或产品 in_scope 为智慧记/零售（非星火） | **禁止** approve；停止流程 |
| 用户改了三维范围 | 必须重新 validate + 再确认；不得静默沿用旧 approved |
| 用户要求重识别 | 重跑 `stage1_context.js`（会清除 approved，见脚本） |

---

## 5. 话术示例

```
已根据需求标题/正文识别测试上下文，请确认是否准确：

产品：涉及【ailit】 / 不涉及【智慧记AI进销存、智慧记、智慧记零售】（置信度 high）
版本：涉及【开单版, 单店版, 多店版】 / 不涉及（无）（置信度 low，默认）
端：涉及【PC端, APP端】 / 不涉及【小程序端】（置信度 high）

回归：共 5 条 hint，其中 4 条 auto_skip（智慧记/智慧记零售/小程序/H5 默认不生成 TP）；1 条活跃（智慧记AI进销存交叉回归）

请回复：
1) 准确，无需修改
2) 需要修改（请说明改哪一维）
```

---

## 6. 版本

| 版本 | 日期 | 说明 |
|------|------|------|
| 6.0 | 2026-07-21 | 首版：上下文人审①与需求点人审①′分离 |
| 6.1 | 2026-07-28 | 回归策略：`auto_skip_tp` 与人审①检查单 |
| 6.2 | 2026-08-19 | 嵌入时间追踪：approve 后强制收集 01 文档整理 |
