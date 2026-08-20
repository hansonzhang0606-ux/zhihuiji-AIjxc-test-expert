---
stage_id: stage4_test_case_generation
version: "6.4.0"
execution_type: script
fast_path: true
trigger: default
estimated_duration: "5-15min"
quality_gate: "stage3_approved；unmatched_count=0；C-TC schema 通过；质量报告达标"
inputs:
  - name: test_points.json
    required: true
    contract: C-TP
  - name: test_context.json
    required: true
    contract: C-CTX
outputs:
  - path: "script/stage4/test_cases.json"
    contract: C-TC
  - path: "output/测试用例_{title}.xmind"
    contract: C-TC-XMIND
  - path: "script/stage4/final_artifact.json"
    contract: FinalArtifactManifest
depends_on:
  - stage3_checkpoint
---

# Stage4 用例生成（Demand 6.0 Fast Path）

| 项 | 内容 |
|----|------|
| 依据 | `demand/testcase-generation-demand6.0.md` §7、**§8.3** |
| 契约 | `contracts/test_cases.schema.json`（C-TC） |
| 模板（只读） | `src/templates/数据模板_用例管理.xlsx` |
| Script | `stage4/stage4_execute.js`、`stage4/export_tc_xmind.js` |
| 预览修改 | 本文 §5（对齐 demand §7.3.1 / §8.3） |

> **门禁：** 须 `stage3_approved=true` 且 `unmatched_count===0`。  
> **模板：** 只读 `SRC_ROOT/templates`；工作区**无** `templates/` 副本仍须能跑。  
> **知识库转化：** 默认关闭；开启时仅写 `script/stage4/knowledge_base/`，**禁止**根目录 kb md。

---

## 1. 目标

将已确认测试点（C-TP）转为原子用例（C-TC），主交付为 `output/测试用例_{title}.xmind`。

| 产物 | 路径 | 说明 |
|------|------|------|
| C-TC | `script/stage4/test_cases.json` | 真源 |
| XMind | `output/测试用例_{title}.xmind` | 对外预览 |
| Excel | `script/stage4/test_cases.xlsx` | 默认不进 `output/` |
| 质量报告 | `script/stage4/quality_report.json` | 不达标亦落盘 |
| 完成报告 | `script/stage4/stage4_completion_report.json` | 审计 |
| 最终产物清单 | `script/stage4/final_artifact.json` | C-TC/XMind 相对路径与 SHA256 |

---

## 2. 执行流程

```
检查 stage3_approved + unmatched_count=0
        ↓
[Script] 读 C-TP + C-CTX
        ↓
[Script] TP → TC（继承三维标签；步骤用 outline 配对）
        ↓
写 C-TC + 质量校验报告
        ↓
导出 output/测试用例_{title}.xmind
        ↓
刷新 final_artifact.json（C-TC + XMind SHA256）
        ↓
写 Excel → script/stage4/（可选 --copy-excel-to-output）
        ↓
（可选）知识库 --kb → 仅 script/stage4/knowledge_base/
        ↓
用例预览修改（§5，§8.3；可迭代，不强制二次卡点）
```

```bash
cd testcase-generation-skills/src/scripts

# 须已人审②批准
node stage4/stage4_execute.js --project-dir <WS>

# 仅重导 XMind（已有 C-TC）
node stage4/export_tc_xmind.js --project-dir <WS>

# 仅重导 Excel（已有 C-TC，不覆盖 JSON；适用于人审后多次改 JSON 的场景）
node stage4/export_tc_excel.js --project-dir <WS>

# 校验
node lib/validate.js --type test_cases --file <WS>/script/stage4/test_cases.json

# 冒烟（fixture，不依赖 LLM）
node stage4/stage4_execute.js --self-test
```

---

## 3. 输入 / 输出契约

### 3.1 读

| 契约 | 路径 |
|------|------|
| C-TP | `script/stage3/test_points.json` |
| C-CTX | `script/config/test_context.json` |
| merge_report（可选） | `script/stage3/merge_report.json`（absorb 等） |
| 进度 | `script/config/progress_tracker.json`（`stage3_approved`） |
| Excel 模板 | `src/templates/数据模板_用例管理.xlsx` |

**输入白名单**仅限上表 C-TP、C-CTX、merge_report、progress_tracker 与只读 Excel 模板。  
**禁止**再读：KB、`domain_facts.json`、Confluence、`input/需求文档` 原文、`templates/kb`、`output/stage3/*`、工作区 `templates/`。  
业务断言以 **已批准 C-TP** 为唯一来源（Demand 6.1）。

### 3.2 写

| 文件 | 路径 |
|------|------|
| test_cases.json | `script/stage4/` |
| test_cases.xlsx | `script/stage4/` |
| quality_report.json | `script/stage4/`（含 `demand61` 扩展字段） |
| stage4_completion_report.json | `script/stage4/` |
| final_artifact.json | `script/stage4/`（C-TC/XMind 均写完后生成；`--no-excel` 仍生成） |
| 测试用例_{title}.xmind | `output/` |
| knowledge_base/* | `script/stage4/knowledge_base/`（仅 `--kb`） |

### 3.3 TP → TC 映射要点

- `TP-xxx` → `TC-xxx`；`source` = `[tp.id, ...source_rp_ids]`
- 继承 `product_tags` / `version_tags` / `platform_tags` / `priority` / 模块（JSON 仍为数组）
- **端差异**：用 `platform_tags` 表达，**禁止**为同逻辑再复制 APP/PC 独立用例
- **触发方式**：多种等价触发默认选一种（`preferred_trigger` 可配置；实现上不按触发裂变条数）
- **absorb**：`merge_report.absorb_candidates` 中的 TP **不**生成独立 TC
- **排序**：导出前按 `module_l1/l2 + sort_key` 稳定排序，便于审核执行
- **标题分型**：功能/规则类建议「条件，则结果」；`nfr_type` 非空不强制（写入 quality 告警，默认不阻断）
- XMind / Excel「用例标签」列：用 `formatDisplayLabels` 按维合并展示
- `nfr_type` 非空 → `module_l1=非功能`，`module_l2` 映射为性能/安全/兼容性/集成
- `steps_outline[i]` + `expected_outline[i]` → `{ order, action, expected }`
- C-TP 普通步骤按原顺序保留，导航字符串不截断、不重复展开；同页元素动作不补写整条导航链
- `backend_api` 仅在至少有一条契约有效 assertion 时追加一个 API 检查步骤；只有 Method/Path 时仅保留 `technical_refs` 展示
- 同一 UI 场景触发多个 API 时，UI 步骤只保留一份，每个稳定 API ref 各追加一个检查步骤
- operator 固定渲染：`eq=等于`、`contains=包含`、`not_contains=不包含`、`exists=存在`、`not_exists=不存在`、`unique=中数据不重复`
- XMind 将 API 检查作为普通步骤导出；技术引用节点仅展示 Method/Path 与断言条数摘要
- `precondition`：可从标题/标签启发式生成；空则写「无」

### 3.4 Demand 6.1 质量扩展（quality_report.demand61）

| 字段 | 含义 |
|------|------|
| `sort_applied` | 是否已稳定排序 |
| `absorb_skipped_tp_ids` | 被裁剪的 TP |
| `title_typing` | 因果标题检查结果 |
| `platform_explosion` | 同标题多条嫌疑 |
| `domain_facts_read` | 恒为 `false` |

---

## 4. 质量门禁（沿用 5.0 指标）

目标（demand §7.3）：

| 指标 | 目标 |
|------|------|
| 原子性 | ≥95%（不引用其他 TC 结果） |
| 完整性 | ≥98%（标题/前提/步骤/模块/优先级） |
| 步骤-期望对应 | 100% |
| TP API 断言到 TC API 检查对应 | 100%（缺失或重复即失败） |
| 综合分 | ≥90 |

不达标：`quality_report.json` 落盘 `script/stage4/`，脚本非 0 退出；**禁止**在用例层发明业务规则——回退改 C-TP。

---

## 5. 用例预览与修改（demand §7.3.1 / §8.3）

产出 XMind 后若用户要改：

1. **声明：** `output/测试用例_{title}.xmind` **只供查看**；真源 `script/stage4/test_cases.json`  
2. 统计 `N = test_cases.length`：  
   - **N ≤ 40** → 请直接列举改动  
   - **N > 40** → 下发改动清单模板  
3. **允许**多次改 JSON 再 `export_tc_xmind`；**不强制**二次卡点  
4. 用户说「无需修改 / 可以了」→ 本轮结束（无独立 `stage4_approved` 时以交付/结束对话为准）
5. 禁止把「只改了 XMind」当成已生效
6. **周迭代子需求**：本轮用例交付后，须询问用户是否继续下一个子需求（见 `stage0_weekly_iteration.md`）：

> 子需求「{名称}」用例已生成完毕。  
> 是否继续下一个子需求的用例生成？（回复「继续」/「下一个」或指定序号；全部完成可回复「全部完成 / 先到这里」）

### 5.0 ⏱ 时间追踪（06 用例细化，「可以了」后强制）

用户回复「无需修改 / 可以了」**后**、询问补充知识库/Stage5 **之前**，按 [`time_tracking.md`](../scripts/time-tracking/prompts/time_tracking.md) §四 收集：

- 环节名：**用例生成（对应「用例细化」）**；step_code=`06`，参考值 4~8 小时（可用「采纳」取上限，或回答如「0.5人天」）
- 强制询问 → 解析 → **二次确认** → 写本地 JSONL（用户故事用会话缓存值）
- 拒绝反馈 → 最多追问 2 次，记录 0 标注「用户未反馈」，**不阻塞**后续询问

```bash
python src/scripts/time-tracking/scripts/record_time_saved.py \
  --employee "{姓名}" --user-story "{PRJ-xxx 需求名}" \
  --step "用例细化" --step-code "06" --hours {小时} --biz-line "{biz_line}"
```

### 5.1 小（N≤40）— 直接列举

```text
【补充】…
【修改】TC-003：步骤 2 期望改为…
【删除】TC-008
```

### 5.2 大（N>40）— 清单模板

**Agent 须先声明 XMind 只读（§5 第 1 条），再发出**下列模板：

【重要说明】  
1. XMind 文件（output/测试用例_{title}.xmind）**仅供查看**，在 XMind 里修改**不会生效**。  
2. 如需改动，请**在本对话中说明**；Agent 会修改 JSON 后重新导出 XMind。

由于测试用例总数 N={N} > 40，以下提供改动清单模板（如需修改请填写；无需修改直接回复「无需修改」）：

【用例改动清单】  
[删除] - TC-xxx：删除原因  
[新增] - 新用例标题 | 优先级（P0/P1/P2/P3）| 模块 | 关联 TP-xxx | 前提 | 步骤要点 | 期望要点  
[修改] - TC-xxx：修改后标题 | 修改后步骤/期望  

请问测试用例是否 OK？如有改动请按上述格式说明；无改动请回复「无需修改」。

**禁止**在模板或开场白中使用英文状态词；须用中文表述。

单批建议 ≤20 行。改完后：`validate` → `export_tc_xmind` → 向用户给 diff 摘要。

---

## 6. CLI 参数

| 参数 | 说明 |
|------|------|
| `--project-dir <WS>` | 工作区根（必填，除非 `--self-test`） |
| `--skip-gate` | 跳过 `stage3_approved`（仅联调；正式编排禁止） |
| `--no-excel` | 不写 xlsx |
| `--copy-excel-to-output` | 额外复制 xlsx 到 `output/`（须用户明确要求） |
| `--kb` | 开启知识库转化（默认关；产物仅 `script/stage4/knowledge_base/`） |
| `--self-test` | fixture 冒烟 |

---

## 7. 独立验收（WP-S4）

1. fixture C-TP → `stage4_execute.js --project-dir … --skip-gate`（或 self-test）  
2. `validate --type test_cases` 通过  
3. 出现 `output/测试用例_{title}.xmind`；根目录无 Excel / kb md  
4. 质量报告在 `script/stage4/`  
5. §5 话术可走通（小/大分流）  

**不依赖** Stage1/3 LLM。

---

## 8. 版本

| 版本 | 日期 | 说明 |
|------|------|------|
| 5.x | 2026-07-09 | 旧路径 `output/stage3` / `output/stage4` |
| **6.0.3** | **2026-07-22** | WP-S4：C-TP→C-TC；`output/测试用例_{title}.xmind`；Excel/KB 默认 script/；§8.3 预览修改 |
| **6.1.0** | **2026-07-28** | Demand 6.1：禁读 domain_facts；absorb 裁剪；sort_key；标题分型；quality_report.demand61 |
| **6.1.1** | **2026-07-28** | 新增 `export_tc_excel.js`：人审后改 C-TC 时可单独重导 Excel，避免 stage4_execute 回退人审结果 |
| **6.4.0** | **2026-08-06** | WP-64-STAGE4/EXPORT：保留导航、确定性 API 双断言、映射门禁、XMind 保真与最终产物 SHA256 清单 |
| **6.5.0** | **2026-08-19** | 嵌入时间追踪：「可以了」后强制收集 06 用例细化 |
