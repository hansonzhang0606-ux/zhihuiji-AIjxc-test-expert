---
stage_id: stage1_context
version: "6.0"
execution_type: hybrid
fast_path: true
trigger: default
estimated_duration: "2-8min"
quality_gate: "C-CTX 通过 schema+语义校验；未要求本阶段写需求点"
inputs:
  - name: project_dir
    required: true
    description: "工作区根；需已有 input/需求文档/{title}.md"
  - name: requirement_title
    required: false
    description: "默认读 session_info.requirement_title"
outputs:
  - path: "script/config/test_context.json"
    contract: C-CTX
  - path: "script/stage1/context_recognition.json"
    description: "识别过程摘要（中间产物）"
depends_on:
  - stage1_download
deprecated_predecessor: stage1.3_context_recognition.md
---

# Stage1 测试上下文识别（1CTX / Demand 6.0.2）

| 项 | 内容 |
|----|------|
| 依据 | `demand/testcase-generation-demand6.0.md` §4.3 |
| 契约 | `contracts/test_context.schema.json`（FOUND-01） |
| 规则 | **`src/templates/标签规则.md`**（只读；禁止从工作区读 templates） |
| 脚本 | `scripts/stage1/stage1_context.js` |
| 人审 | 完成后进入 [`stage1_context_checkpoint.md`](./stage1_context_checkpoint.md) |

> **本阶段只产出 C-CTX。**  
> **禁止**写 `requirement_points.json`、**禁止**导出需求点 XMind。  
> **禁止**在未获人审①批准时进入 1A。

---

## 1. 阶段目标

根据需求 **Confluence 父级**（若有）+ **标题**（含 `【…】` 标识）+ **正文**，对照三维枚举识别：

| 维度 | 合法取值 |
|------|----------|
| 产品 `products` | **智慧记AI进销存**、**ailit**（星火 Skills 支持）；**智慧记**、**智慧记零售**（识别到即停止） |
| 版本 `versions` | 开单版、单店版、多店版 |
| 端 `platforms` | PC端、APP端、小程序端、H5端 |

**Confluence 父级 → 产品线（优先于标题关键词）：**

| 父页面命名 | 产品线 | 行为 |
|------------|--------|------|
| **星火 V…** | 星火 | 产品仅 智慧记AI进销存 / ailit，**继续** |
| **智慧记 V…** | 智慧记 | in_scope=[智慧记]，**停止**（Skills 不支持） |
| **智慧记零售版 V…** | 智慧记零售 | in_scope=[智慧记零售]，**停止** |

父级 title 来自 Stage0 `session_info.source.parent_title` 或 `download_manifest.parent_title`（MCP 取页时需一并取父页 title）。

产品别名 → 全称（识别用，写出时只用全称）：

| 别名（文档常见写法） | 契约全称 |
|----------------------|----------|
| 国内版 / 普通版 / AI进销存 | 智慧记AI进销存 |
| 国际版 / Ailit | ailit |
| 零售 / 零售版 | 智慧记零售 |
| 智慧记（单独，非星火父级） | 智慧记 |

写出 `script/config/test_context.json`，并生成 `regression_hints`（每个 `out_of_scope` 一项 P3；6.1 起对非星火产品线 / 非本需求端默认 `auto_skip_tp=true`，3A 不生成对应回归 TP）。

---

## 2. 执行步骤

| 步骤 | 执行 | 说明 |
|------|------|------|
| **1CTX.1** | [Script] | 解析 title；读 `input/需求文档/{title}.md`；读 `parent_title` |
| **1CTX.2** | [Script] | **父级定产品线** → 标题括号 + 全文关键词（对齐 `标签规则.md`） |
| **1CTX.3** | [Script] | 补全 in/out 互斥全集；生成 regression_hints |
| **1CTX.4** | [Script] | `validate --type test_context`；失败 exit 1 |
| **1CTX.5** | [LLM/人工] | 打印摘要表 → 进入人审①（见 checkpoint 文档） |

置信度规则：

- 标题明确命中 → `confidence: high`，`source: title`
- 仅正文命中 → `confidence: medium|high`，`source: body`
- 无法识别 → 填默认 in_scope，`confidence: low`，`source: default`，**禁止臆造枚举外值**

默认（标题【】均未写时）：

- 产品：`[智慧记AI进销存, ailit]`
- 端：`[PC端, APP端]`
- 版本：`[开单版, 单店版, 多店版]`

标题【】收窄（仅标题 + 正文「标题标识」行，**不用全文正文收窄**）：

| 维度 | 标题写了 | 标题未写 |
|------|----------|----------|
| 产品 | 仅写国内/国际 → 单产品；都写 → 双产品 | 双产品 |
| 端 | 仅写 PC/APP/小程序/H5/云店 等 → 对应端 | PC + APP |
| 版本 | 仅写开单/单店/多店 → 对应版本 | 三版本全选 |

特殊：标题含「全端 / 全版本 / 国内+国际 / 全产品」等 → 该维全部进 in_scope。

---

## 3. CLI

工作目录：`testcase-generation-skills/src/scripts`

```bash
# 识别并写 C-CTX + 打印人审摘要
node stage1/stage1_context.js --project-dir ../../output/<title>
# 或 fixture
node stage1/stage1_context.js --project-dir ../fixtures/客户来源调研弹窗

# 人审①通过后锁定（须已有合法 C-CTX）
node stage1/stage1_context.js --project-dir <工作区> --approve

# 自检
node stage1/stage1_context.js --self-test

# 校验
node lib/validate.js --type test_context --file <工作区>/script/config/test_context.json
```

可选覆盖：`--title "<标题>"`（否则 session / 目录名）。

---

## 4. 产物

### 4.1 `script/config/test_context.json`（C-CTX）

字段见 demand §4.3.4 / schema。必含：`products` / `versions` / `platforms` / `regression_hints`。

### 4.2 `script/stage1/context_recognition.json`

中间摘要：命中关键词、各维来源、是否需人审关注（low confidence）。

### 4.3 progress

本脚本 **不**自动置 `test_context_approved`；仅 `--approve` 或人审协议明确确认后写入。

---

## 5. 质量门禁

1. [ ] 需求 md 存在  
2. [ ] C-CTX 通过 schema + 语义（in∪out=全量、不相交、hints 对齐 out）  
3. [ ] 未写入 requirement_points / 未导出需求点 xmind  
4. [ ] 打印人审摘要（产品/版本/端 in/out + 置信度）

失败 → 非 0 退出；**不得**进入 1A。

---

## 6. 与旧文档

| 文件 | 状态 |
|------|------|
| `stages/stage1.3_context_recognition.md` | deprecated → 本文 |
| `scripts/stage1/stage1.3_context.js` | deprecated；枚举已迁至本脚本（产品用全称，≠versions） |

---

## 7. 版本

| 版本 | 日期 | 说明 |
|------|------|------|
| 6.0 | 2026-07-21 | 首版：上下文先行；对齐 demand 6.0.2 |
| 6.0.1 | 2026-07-24 | Confluence 父级定产品线；星火/智慧记/零售分流；不支持产品线禁止 approve |
| 6.1.0 | 2026-07-28 | regression_hints 默认 auto_skip_tp（非星火产品/非本需求端） |
