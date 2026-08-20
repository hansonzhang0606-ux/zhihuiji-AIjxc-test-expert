# 测试用例生成框架 - Demand 6.0（Fast Path Skill）

## 版本说明

- 版本号：6.0
- 创建日期：2026-07-21
- 基于版本：demand5.0 + `test'case_skills_proposal` 四原则
- 文档定位：**进销存系统测试用例生成 Skill 的框架规格**（默认快路径；条件触发全量路径）
- 目标：在 **相对准确** 前提下，显著降低 LLM 调用次数与人工可见噪声，交付可审查的 XMind 产物

**Demand 6.0 核心改动：**

1. **效率优先（Fast Path）**：默认跳过低价值重检/重复理解步骤；Stage 2 / 1.4 / 3.1 等改为条件触发
2. **工程可迁移**：契约层 / 适配层 / 执行层三层分离；提供从零重建（bootstrap）约定
3. **全产物可视化**：需求点、测试点、用例 **一律输出 XMind**（机器侧 JSON 仅存 `script/`）
4. **对外只暴露 XMind**：工作区 `output/` 仅放交付用 `.xmind`；原文在 `input/`（与 `output/` 平级）；中间产物在 `script/`；**目录名与文件名一律取自需求文档 title（清洗后），不获取、不使用故事/需求编号**
5. **input/output 中文子目录**：`input/需求文档`、`input/技术文档`、`input/历史文档参考`；`output` 下 XMind 亦按需求 title 中文命名

**继承自 Demand 5.0（准确度底线，不可裁掉）：**

- 模块必须来自 `module_mapping.md`，禁止自创/强行匹配
- 四大等价合并 + 开单/收账/支付等核心场景禁止去重
- 非功能：性能/安全有条件匹配；场景贡献 &lt; 60% 不补充
- 不涉及端/版本：每端/版本 1 条 P3 回归
- 端标签无收银机端；业务场景标签无「不使用」
- CHECK_POINT：必须用户确认「无需修改」才结束人审
- 并行：子 agent 只生成，主编排做人审；断点续传 / 超时自检

---

## 〇、工程对外目录（使用者视图）

本 Skill 安装/交付后，**最外层保留入口文档 + 产物 + 依赖 + 实现**：

```
testcase-generation-skills/
├── README.md         # 着陆索引（指向 bootstrap / skill）
├── bootstrap.md      # 无记忆冷启动：安装与自检
├── skill.md          # 编排入口：怎么跑流程
├── output/           # ★ 全部生成产物（各需求工作区）
├── skills/           # 依赖 Skill（如 confluence-download）
└── src/              # 实现与规格（demand/stages/scripts/contracts/templates/…）
```

- **入口文档**（须在最外层，便于无记忆模型发现）：`README.md`、`bootstrap.md`、`skill.md`  
- **禁止**把 demand、stages、scripts、contracts、templates、fixtures 等放在最外层。  
- 生成工作区路径：`testcase-generation-skills/output/{需求文档title}/`（**不再使用** `code/`）。  
- `src/` 对使用者可视为黑盒；换模型/维护时再进入。

---

## 一、总体流程框架

### 1.1 双路径模型

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                    Fast Path（默认）                        │
需求文档 ──────────►│  0 → 下载 → 1CTX → 人审①(上下文) → 1A → 人审①′(需求点)   │
         └──可选──►│       → 3A → 3B → 人审② → 4   （+ Stage2 / Full 条件分支） │──► 对外 XMind
                    └──────────────────────────────────────────────────────────┘
```

| 路径 | 适用 | LLM 主生成次数（约） | 人审次数 |
|------|------|----------------------|----------|
| **Fast Path（默认）** | 周迭代、普通功能需求、无技术改动说明 | **3 次**（上下文识别 + 需求点/越界 + 测试点合成） | **3 次**（上下文 / 需求点 / 测试点） |
| **Full Path（条件）** | 需求极短/冲突多、有代码 diff/技术改动、或用户显式要求深挖 | 在 Fast 基础上按需打开 1.4 / 2 / 3.1 | 仍为上述人审点 |

### 1.2 阶段总览

| 阶段 | Fast Path 动作 | 执行方式 | 对外产物 |
|------|----------------|----------|----------|
| **0 初始化** | 凭证、路径、目录、templates、bootstrap 自检 | [Script] + 少量 [LLM] | 无（仅工作区） |
| **1.1 下载命名** | 需求正文落盘 `input/需求文档/{title}.md` | [Hybrid] | 无（原文在 input） |
| **1CTX 上下文识别** | 按三维规则识别产品/版本/端 → `test_context.json` | [Hybrid]/[Script] | 无（中间在 script；人审看摘要） |
| **人审①（上下文）** | CHECK_POINT：确认适配的产品/版本/端是否准确 | 人工 | 锁定 C-CTX |
| **1A 需求点+越界** | **后续实现**：提取需求点 + 需求越界判断（依赖已锁定上下文） | [LLM] | `output/{需求title}_需求点.xmind` |
| **人审①′（需求点）** | CHECK_POINT：覆盖/待确认/进销存等 | 人工 | 同上（确认后锁定 C-RP） |
| **2 技术改动** | **默认跳过**；有 `input/技术文档/` 才执行 | [LLM] | `output/{需求title}_技术改动.xmind`（可选） |
| **3A 测试点合成** | Script 模块归属 + **单次 Hybrid** 出测试点 | [Hybrid] | `output/{需求title}_测试点.xmind` |
| **3B 矩阵标签裁剪** | 按《系统版本功能矩阵表》剔除模块不支持的版本/产品标签 | [Script] | 无（写回 C-TP；报告在 `script/`） |
| **人审②** | CHECK_POINT | 人工 | 同上（确认后锁定） |
| **4 用例生成** | JSON→XMind（Excel/知识库转化默认进 `script/`） | [Script]/[Hybrid] | `output/{需求title}_测试用例.xmind` |

### 1.3 Demand 6.0 核心原则

1. **默认 Fast，条件 Full**：未命中触发条件不得擅自跑重检步骤
2. **上下文先行，确认后再提取**：先识别并锁定产品/版本/端，再做需求点提取与越界判断；禁止未确认上下文就生成需求点
3. **分段生成、分段人审**：禁止「生成→机器再全面复述检查→再生成」的默认环；上下文 / 需求点 / 测试点各审一次
4. **准度靠规则与模板，不靠重复 LLM**：module_mapping、tag_rules、功能矩阵标签裁剪、等价合并、进销存底线规则优先 Script/模板
5. **对外极简**：用户主要查看 `output/` 下 XMind；原文在 `input/`；中间产物一律 `script/`
6. **命名即内容**：工作区目录名、input/output 内文件名 = **需求文档 title**（清洗后）；**禁止**拉取或拼接故事编号 / pageId 作为目录名
7. **模型可换**：Stage 只认契约路径与抽象工具名；具体 MCP/CLI 在 adapters 映射
8. **进销存底线**：单据状态机、库存账、核心交易链路不可被「效率」裁掉

---

## 二、触发机制与调度核心

### 2.1 触发关键词

与 Demand 5.0 相同：出现「生成测试用例 / 写用例 / 帮我测这个需求」等，或 Confluence 链接 + 测试语义时触发。

**Demand 6.0 新增路径选择：**

| 用户表达 | 路径 |
|----------|------|
| 未指定 / 「快速生成」 / 「出一版用例」 | **Fast Path** |
| 「深度分析」 / 「全量」 / 「带质量门禁」 | **Full Path**（打开 1.4） |
| 同时提供技术改动文档或代码 diff | Fast + **Stage 2** |
| 「只要测点不要用例」等 | 执行到人审②后停止 |

### 2.2 触发后 Fast Path 执行流

```
检测到触发
    ↓
Stage 0：初始化（凭证 / 路径 / 目录 / templates / 适配器自检）
    ↓
Stage 0：用 Confluence/本地需求文档的 **title** 创建工作区 `{输出路径}/{title}/`（不使用故事编号）
    ↓
Stage 1.1：下载需求到 `input/需求文档/`（文件名=title）
    ↓
Stage 1CTX：识别测试上下文（产品/版本/端）→ `script/config/test_context.json`
    ↓
CHECK_POINT 人审①（上下文）：确认「该需求适配的产品/版本/端是否准确」→ 锁定后才可进 1A
    ↓
Stage 1A（后续）：需求点提取 + 需求越界判断 → script JSON → 导出 `output/{title}_需求点.xmind`
    ↓
CHECK_POINT 人审①′（需求点）：必须「无需修改」
    ↓
[可选] Stage 2：仅当 `input/技术文档/` 非空
    ↓
Stage 3A：3.3 Script 模块归属 → 单次 Hybrid 测试点+合并 → 导出到 `output/`
    ↓
Stage 3B：按功能矩阵裁剪测试点版本/产品标签（写回 C-TP + `matrix_filter_report.json`）
    ↓
CHECK_POINT 人审②（必须「无需修改」；有未匹配模块则禁止进 Stage 4）
    ↓
Stage 4：生成用例 XMind 到 `output/`（Excel/知识库默认 script/）
    ↓
向用户展示 `output/` 下的 XMind 列表
```

### 2.3 异常处理

继承 Demand 5.0 §2.3；并补充：

| 异常 | 处理 |
|------|------|
| Fast Path 下需求过短导致需求点明显不全 | 提示升级 Full Path（开启 1.4），不静默凑数 |
| 人审①（上下文）未确认 | **阻断 1A**，不得提取需求点 |
| 人审①′/② 后仍有「未匹配」模块 | **阻断 Stage 4**，要求用户改 XMind/映射表 |
| 适配器缺失（当前模型无 Bash/MCP） | 按能力分级降级：Script 改由外部跑，或提示切换适配器 |

---

## 三、阶段0：初始化

### 3.1 阶段目标

建立 **对外极简、对内可重建** 的工作区；完成凭证与 templates；校验当前模型适配器。

### 3.2 步骤框架

| 步骤 | 目的 | 执行方式 | 说明 |
|------|------|----------|------|
| **0.1** | 确认需求文档 title | [LLM] | 取自 Confluence 页面 title 或本地文件名；清洗后作为工作区目录名与产物前缀；**不获取故事/需求编号** |
| **0.1b** | Confluence 凭证检查 | [Script]/人工 | 无则索取 |
| **0.1c** | 输出路径 | [LLM] | 默认 `testcase-generation-skills/output`（工程最外层 `output/`，其下为各需求工作区） |
| **0.1d** | 并行凭证分发 | [Script] | 多需求时写入各工作区 `script/config/session_info.json` |
| **0.2** | 创建目录 | [Script] | 见 §3.3：`input/`、`output/`、`script/` 三顶栏平级 |
| **0.3** | Skills / adapters 检查 | [Script] | confluence-download + 当前模型 adapter |
| **0.4** | 校验 templates | [Script] | 只读检查 `src/templates/`（含 module_mapping / tag_rules）；**不复制**到工作区 |
| **0.5** | 生成配置 | [Script] | session（含 requirement_title）/ progress / path_mode |
| **0.6** | 初始化校验 | [Script] | 失败则阻断 |

### 3.3 工作目录结构（Demand 6.0 核心）

**原则：**

1. 工作区目录名 = **需求文档 title**（清洗后），**不使用**故事编号 / pageId  
2. `input/` 与 `output/` **平级**（均在工作区根下，不在 `script/` 内）  
3. `output/` 只放对外 XMind；`input/` 放原文且子目录 **中文命名**；中间产物在 `script/`

```
{输出路径}/{需求文档title}/
│
├── input/                             # ★ 与 output 平级：原始输入
│   ├── 需求文档/                      # 原 requirement；文件名=页面/文档 title
│   ├── 技术文档/                      # 原 technical；有内容则触发 Stage2
│   └── 历史文档参考/                  # 原 reference
│
├── output/                            # ★ 与 input 平级：对外交付（仅 XMind）
│   ├── 需求点_{需求文档title}.xmind
│   ├── 测试点_{需求文档title}.xmind
│   ├── 测试用例_{需求文档title}.xmind
│   └── 技术改动_{需求文档title}.xmind   # 可选
│   └── {需求文档title}_技术改动.xmind # △ 仅 Stage2
│
└── script/                            # ★ 对内：中间产物（可重建）
    ├── config/
    │   ├── session_info.json          # 含 requirement_title；无故事编号字段
    │   ├── test_context.json
    │   ├── progress_tracker.json
    │   └── path_mode.json
    ├── stage1/
    │   └── requirement_points.json
    ├── stage2/
    ├── stage3/
    │   ├── module_attribution.json
    │   ├── test_points.json
    │   ├── merge_report.json
    │   └── matrix_filter_report.json   # 3B 矩阵标签裁剪审计
    ├── stage4/
    │   ├── test_cases.json
    │   ├── test_cases.xlsx
    │   └── knowledge_base/
    ├── adapters_runtime/
    └── logs/
```

> 模板统一读工程 `src/templates/`，**不**再复制到工作区 `script/templates/`。

### 3.4 目录职责

| 位置 | 职责 | 用户是否需要打开 |
|------|------|------------------|
| `output/*.xmind` | 人审与交付 | **是** |
| `input/` | 需求/技术/历史原文 | 排查或补传技术文档时 |
| `script/stage*` | 可重建中间 JSON | 否 |
| `script/config/` | 会话与上下文 | 否 |
| `script/logs/` | 日志 | 否 |

### 3.5 文件命名规范

| 对象 | 规则 | 示例 |
|------|------|------|
| 工作区文件夹 | `{需求文档title}`（清洗后） | `客户来源调研弹窗` |
| `output` 下 XMind | `{产物类型}_{需求文档title}.xmind` | `需求点_客户来源调研弹窗.xmind` |
| `input/需求文档` | 页面 title 清洗；禁用 pageId/故事号作主名 | `客户来源调研弹窗.md` |
| `input/技术文档` | 文档标题/内容名 | `销售单保存接口变更说明.md` |
| `input/历史文档参考` | 中文可读标题 | `上版本弹窗交互说明.md` |
| 禁止 | 目录或用户可见名拼接故事编号；英文子目录名 requirement/technical/reference | — |

清洗规则：去掉 `\ / : * ? " < > |`，连续空白变 `_`，长度过长截断并保留可读前缀。

**title 来源（工作区唯一主键）：**

1. Confluence：页面 **title**  
2. 本地文件：文件名去扩展名，或文档一级标题（与用户确认）  
3. **不**从 URL、pageId、用户故事字段取编号用于建目录

---

## 四、阶段1：下载 → 上下文确认 → 需求点（Fast Path）

### 4.1 阶段目标与拆分原则

Stage1 **不再**用一次 LLM 同时做「上下文 + 需求点」。顺序强制为：

1. **先**识别测试上下文（产品 / 版本 / 端）  
2. **停下来**人审确认上下文是否准确并锁定  
3. **再**（后续实现）做需求点提取与需求越界判断  

**相对 Demand 5.0 / 原 6.0 草稿的映射：**

| 5.0 / 旧 6.0 步骤 | 现行 Fast Path |
|-------------------|----------------|
| 1.1 预处理下载 | **保留**（Hybrid：下载 Script/MCP + 轻量清洗）→ §4.2 |
| 1.3 上下文识别 | **提前独立为 1CTX**，并增加 **人审①（上下文）** → §4.3～§4.4（**本批优先实现**） |
| 1.2 深度理解 + 原「并入 1A」的需求点 | **后置为 1A**：需求点提取 + **需求越界判断** → §4.5～§4.6（**后续实现**） |
| 1.4 质量管控 | **默认跳过**；见 §4.7 触发条件 |
| 1.5 输出+人审 | 拆为：人审①（上下文）+ 人审①′（需求点 XMind） |

### 4.2 执行流程（总览）

```
1.1 获取需求文档 → input/需求文档/{title}.md
        ↓
1CTX 识别测试上下文（读标题+正文 + tag_rules 三维枚举）
        → 写出 script/config/test_context.json
        →（可选）Schema 校验 [Script]
        ↓
CHECK_POINT 人审①（上下文）—— 确认产品/版本/端是否准确
        → progress: test_context_approved=true 后才允许进 1A
        ↓
1A  需求点提取 + 需求越界判断（后续实现；必须读已锁定的 test_context）
        → 写出 script/stage1/requirement_points.json
        → Schema 校验 [Script]
        ↓
导出 output/{需求文档title}_需求点.xmind
        ↓
CHECK_POINT 人审①′（需求点）
```

---

### 4.3 1CTX：测试上下文识别（优先实现）

#### 4.3.1 目标

仅产出 **C-CTX**（`script/config/test_context.json`），**不**写需求点、**不**导出需求点 XMind。

根据需求标题括号标识（如 `【国际版】【PC+移动】`）+ 正文描述，对照下方 **三维枚举** 判定「本次涉及哪些 / 不涉及哪些」。规则读 **`src/templates/stage3/tag_rules.md`**（与 FOUND-01 枚举一致）。

#### 4.3.2 三维枚举（与业务口径对齐）

| 维度 | 字段名 | 合法取值（仅允许下列集合） | 说明 |
|------|--------|---------------------------|------|
| **产品** | `products` | 【智慧记AI进销存】【ailit】【智慧记】【智慧记零售】 | **契约一律写全称**。别名：国内版/国内版本→智慧记AI进销存；国际版/国际版本/Ailit→ailit；零售/零售版→智慧记零售 |
| **版本** | `versions` | 【开单版】【单店版】【多店版】 | 原「订阅版本 / 版本标签」；**不含**产品维度 |
| **端** | `platforms` | 【PC端】【APP端】【小程序端】 | 已移除收银机端 |

> 禁止把产品全称或「国内版/国际版」别名写进 `versions`，禁止把「开单版/单店版/多店版」写进 `products`。

#### 4.3.3 in_scope / out_of_scope

| 子集 | 含义 | 下游用途 |
|------|------|----------|
| `*_in_scope` | 本次需求明确要测 / 要改的范围 | 主路径用例打对应产品/版本/端标签；覆盖要全 |
| `*_out_of_scope` | 全量枚举减去 in_scope 的剩余项 | 每个剩余项生成 **1 条 P3 回归**（验证不受影响）；写入 `regression_hints` |

约束：

- 对任一维度：`in_scope ∪ out_of_scope = 该维全量枚举`，且二者 **不相交**
- 若标题写「全端 / 全版本 / 国内+国际 / 全产品」→ 该维全部进 `in_scope`，`out_of_scope` 为空，**不生成**该维回归
- 无法识别时：按默认值填 `in_scope`，并 `confidence: low` + 标待确认，**禁止臆造枚举外取值**

示例：需求标题 `【国际版】【PC+移动】…`（未提小程序、未提开单/单店/多店、未提国内）

- 产品：in=`[ailit]`（由「国际版」映射），out=`[智慧记AI进销存, 智慧记, 智慧记零售]` → 各 1 条 P3 回归  
- 端：in=`[PC端, APP端]`，out=`[小程序端]` → 小程序端 1 条 P3 回归  
- 版本：无明确标识 → 默认 in=`[开单版, 单店版, 多店版]`，out=`[]`（待确认）

#### 4.3.4 `test_context.json` 结构（C-CTX）

```json
{
  "schema_version": "6.0",
  "requirement_title": "客户来源调研弹窗",
  "products": {
    "in_scope": ["ailit"],
    "out_of_scope": ["智慧记AI进销存", "智慧记", "智慧记零售"],
    "confidence": "high",
    "source": "title"
  },
  "versions": {
    "in_scope": ["开单版", "单店版", "多店版"],
    "out_of_scope": [],
    "confidence": "low",
    "source": "default"
  },
  "platforms": {
    "in_scope": ["PC端", "APP端"],
    "out_of_scope": ["小程序端"],
    "confidence": "high",
    "source": "title"
  },
  "regression_hints": [
    {
      "type": "product_regression",
      "target": "智慧记AI进销存",
      "priority": "P3",
      "suggestion": "建议增加1条低优先级回归用例，验证智慧记AI进销存不受本次需求影响"
    },
    {
      "type": "product_regression",
      "target": "智慧记",
      "priority": "P3",
      "suggestion": "建议增加1条低优先级回归用例，验证智慧记不受本次需求影响"
    },
    {
      "type": "product_regression",
      "target": "智慧记零售",
      "priority": "P3",
      "suggestion": "建议增加1条低优先级回归用例，验证智慧记零售不受本次需求影响"
    },
    {
      "type": "platform_regression",
      "target": "小程序端",
      "priority": "P3",
      "suggestion": "建议增加1条低优先级回归用例，验证小程序端不受本次需求影响"
    }
  ]
}
```

执行方式：优先 **[Script]** 关键词/标题规则（可复用/改造 `stage1.3_context.js` 逻辑）；标题歧义或 confidence=low 时允许 **[LLM]** 轻量补判。输出必须通过 `contracts/test_context.schema.json`。

---

### 4.4 人审①（上下文）CHECK_POINT

**时机：** 1CTX 写完 C-CTX 之后、**任何需求点提取之前**。

**展示内容（对话或简表即可，不必先出 XMind）：**

| 维度 | 本次涉及（in_scope） | 不涉及（out_of_scope） | 置信度 |
|------|----------------------|------------------------|--------|
| 产品 | … | … | high/low |
| 版本 | … | … | … |
| 端 | … | … | … |

**向用户确认的核心问题：**

> 该需求适配的 **产品 / 版本 / 端** 是否准确？

**退出条件：**

- 用户明确确认准确（或按用户修改回写 JSON 后再确认）  
- 写入 `script/config/progress_tracker.json`：`test_context_approved=true`  
- **未批准前禁止进入 1A**

**修改：** 用户口述或勾选变更 → agent 回写 `test_context.json` → Schema 校验 → 再次确认。默认不重下需求文档。

---

### 4.5 1A：需求点提取 + 需求越界判断

> **实现：** `stages/stage1a_requirement_synthesis.md` + `scripts/stage1/stage1a_finalize.js` / `validate_rp.js`。

**前置门禁：** `test_context_approved=true`，且读取已锁定的 `test_context.json`（不得在 1A 内擅自改三维范围；若需改范围，退回人审①）。

**目标：** 在已确认上下文下，完成：

1. **需求点提取**：从原文提炼 `confirmed_points` / `pending_points`、本质/领域对象/状态机等（原 1.2 有用字段）  
2. **需求越界判断**：标注明显超出本次需求范围、或与已锁定上下文冲突的内容（越界项进 `pending_points` 或独立 `out_of_bound_hints`，人审①′高亮）  
3. **进销存自检** `inventory_checks`（影响库存/收账/单据生命周期时须有对应点，否则 pending）

**相对旧「单次 1A 大包」：** 不再在同一次调用里重新猜产品/版本/端；上下文只读已锁定 C-CTX。

#### 4.5.1 产出 JSON 结构（C-RP，摘要）

```json
{
  "requirement_title": "…",
  "requirement_essence": "一句话需求本质",
  "domain_objects": ["销售单", "客户"],
  "state_machine": ["草稿", "已保存"],
  "boundaries": ["…"],
  "confirmed_points": [
    { "id": "RP-001", "title": "…", "priority_hint": "P0", "detail": "…" }
  ],
  "pending_points": [],
  "out_of_bound_hints": [],
  "inventory_checks": {
    "affects_stock": false,
    "affects_payment": false,
    "affects_order_lifecycle": true
  }
}
```

> 完整字段以 `contracts/requirement_points.schema.json` 为准；可与 C-CTX 分文件存储（推荐），不必再内嵌整份 `test_context`。

**进销存强制自检：** 若 `affects_stock/payment/order_lifecycle` 为 true，需求点中必须出现对应链路点，否则标 `pending` 并在人审①′高亮。

### 4.6 人审①′（需求点）CHECK_POINT

> **实现：** `stages/stage1_checkpoint.md`；批准命令见该文档 / `stage1a_finalize.js --approve`。  
> **人审反馈通则：** 见 **§8.3**（XMind 只读；对话改 JSON；小/大分流；不强制二次卡点）。

- 文档：`output/{需求文档title}_需求点.xmind`（**仅供查看**；结构见 §4.8）  
- 真源：`script/stage1/requirement_points.json`  
- 焦点：覆盖是否完整、待确认/越界是否需补（**上下文三维已在人审①锁定，此处默认不再改**，除非用户要求退回 §4.4）  
- **进销存影响标记**（`inventory_checks`）不在 XMind 展示，用户无需关注；Agent 内部自检即可  
- 规模：需求点总数（confirmed+pending）**≤20** → 提示直接列举改动（须先声明 XMind 只读）；**>20** → 须先声明 XMind 只读，再下发改动清单模板（全中文，见 §8.3.6）  
- 退出条件：用户明确 **「无需修改」**（或等价确认通过）→ `stage1_approved=true`  
- 修改：用户在对话给出补充/修改/删除 → Agent 改 JSON → validate → 重导 XMind → **可继续改或直接「无需修改」批准**（**不强制**再卡一轮确认；同条消息「改完并批准」亦允许）  
- **默认不重跑 1.1 / 1CTX**

### 4.7 Full Path 触发：打开原 1.4 质量管控

满足任一条件时，在 **1A 之后、人审①′之前** 追加质量门禁（仍只增加 **有限** LLM）：

- 用户指定 Full Path  
- 原文有效正文过短（如 &lt; 300 字）或表格/图片占主导且无文字说明  
- 1A 产出的 `pending_points` 占比 &gt; 40%  
- 同页存在明显互相冲突的描述  

未命中则 **禁止** 自动跑 1.4。

### 4.8 需求点 XMind 结构

```
中心主题：{需求文档title} · 需求点
├── 一、需求本质
├── 二、测试上下文（只读展示已锁定 C-CTX）
│   ├── 产品：涉及【…】 / 不涉及【…】（各 1 条 P3 回归）
│   ├── 版本：涉及【…】 / 不涉及【…】
│   └── 端：涉及【…】 / 不涉及【…】
├── 三、已确认需求点
│   └── [P?] RP-xxx 标题
│       └── 详细说明
└── 四、待确认需求点
    └── [P?] RP-xxx 标题
        └── 详细说明
```

> **不展示**「进销存影响标记」分区；`inventory_checks` 仅保留在 JSON 内供 Agent 自检。

---

## 五、阶段2：技术改动点（条件触发）

### 5.1 触发条件

`input/技术文档/` 非空，或用户明确提供 diff/改动说明。  
**否则整阶段跳过**，不写对外文件。

### 5.2 产出

- `script/stage2/technical_changes.json`
- `output/{需求文档title}_技术改动.xmind`（可选对外）

并行模式下保留 Demand 5.0 的 Step F.5 三种场景（全无 / 部分有 / 全有）。

---

## 六、阶段3A：测试点合成（Fast Path）

### 6.1 阶段目标

在已确认需求点（+ 可选技术改动）上，用 **Script 模块归属 + 一次 Hybrid 合成** 得到测试点，并导出 XMind。

**相对 Demand 5.0 的映射：**

| 5.0 步骤 | 6.0 Fast Path |
|----------|---------------|
| 3.1 变更/风险/历史库 | **默认跳过**（历史库未建设时无增益）；有 Stage2 或用户要求风险深挖时开启精简版 |
| 3.2 非功能匹配 | **并入 3A**：按规则表 Script/规则引擎判定，不单独 LLM |
| 3.3 模块归属 | **保留 [Script]** |
| 3.4 提取+等价合并 | **并入 3A 主 Hybrid** |
| 3.5 再校验+人审 | **人审保留**；机器侧 Script 去重/schema；禁止默认级联重跑全文 |

### 6.2 执行流程

```
读取人审①′锁定的 requirement_points.json（+ 已锁定 test_context + 可选 technical）
        ↓
[可选] 3.1 精简风险分析 —— 仅 Full/有 Stage2
        ↓
3.3 模块归属 [Script]（module_mapping 版本校验）
        ↓
未匹配？ → 写入测试点 XMind「未匹配」分区，人审②必须处理；禁止进 Stage4
        ↓
3A Hybrid：测试点提取 + 优先级/标签 + 等价合并 + 非功能规则注入
        → script/stage3/test_points.json + merge_report.json
        ↓
3B 矩阵标签裁剪 [Script]（§6.9）
        → 按 module_l1/l2 ×《系统版本功能矩阵表》剔除不支持的版本/产品标签
        → 写回 C-TP + script/stage3/matrix_filter_report.json
        ↓
导出 output/测试点_{需求文档title}.xmind（建议在 3B 之后导出，保证 XMind 标签已裁剪）
        ↓
CHECK_POINT 人审②
```

> **说明：** 3B 为新增子步骤，**不修改** 3.3 / 3A 既有步骤 md 与 C-CTX / C-MOD / C-TP schema；仅就地更新 C-TP 中已有 `version_tags` / `product_tags` 数组内容。

### 6.3 非功能规则（继承 5.0，Script 化）

| 类型 | 条件 | 否则 |
|------|------|------|
| 性能 | 仅搜索 / 查询 / 批量 / AI 提取 | 不生成 |
| 安全 | 新增输入框 **且** 支持长文本 | 不生成 |
| 场景补充 | 对需求贡献 &lt; 60% | 不补充 |
| 核心场景 | 开单、收账、支付等 | **禁止去重** |

### 6.4 四大等价合并（继承 5.0，生成时内嵌）

1. **实现逻辑等价**（强）：同接口/同分支/同数据源，入参不同 → 等价类+边界取样  
2. **数据特征等价**（强）：格式/范围/业务属性相似 → 合并  
3. **用户预期等价**（中）：同一用户目标、入口不同但最终同逻辑 → 测代表性入口  
4. **风险预测等价**（弱）：缺陷模式同源 → 深测一个、其余抽检  

**合并决策顺序：** 核心场景禁合并 → 规则一→二→三→四 → 贡献 &lt; 60% 不补充。

**价值口径（Demand 6.0 统一）：**  
只保留 **「场景对需求贡献 &lt; 60% 不补充」**。不再使用含糊的「&lt; 30% 价值贡献」；低价值合并一律走等价规则 + 优先级（非 P0/P1 且非核心链路才可弱合并）。

### 6.5 模块强校验（继承 5.0）

- 模块 **只能** 来自 `src/templates/stage3/module_mapping.md`
- 版本变更必须同步 3.3 脚本/文档
- 匹配失败 → 标注 **未匹配**，严禁猜测
- 用户新增模块 → 回写 mapping 并升版本号

### 6.6 测试点 XMind 结构

```
中心主题：{需求文档title} · 测试点
├── 一、测试本质
├── 二、已确认测试点（按需求点顺序）
│   └── 需求点：RP-001
│       └── [P0] TP-xxx 标题  # 仍展示优先级标签，但不按 P0–P3 排序
│           ├── 模块：销售 / 销售单
│           ├── 步骤要点
│           └── 期望要点
├── 三、待确认测试点
├── 四、未匹配模块的测试点   # 有则阻断 Stage4
```

> **对外 XMind 不展示「等价合并报告」**（合并细节仅在 `script/stage3/merge_report.json` / C-TP 内嵌字段，供机器与调试）。  
> **排序：** 测试点 / 测试用例对外 XMind **按关联需求点（RP）顺序**排列，便于对照需求点人工检查；**不按** P0–P3 优先级排序（优先级仍显示在标题上）。用例树仍按一级/二级模块分组，组内按 RP 序。

### 6.7 人审② CHECK_POINT

> **人审反馈通则：** 见 **§8.3**。

- 文档：`output/测试点_{需求文档title}.xmind`（**仅供查看**）  
- 真源：`script/stage3/test_points.json`（须已经过 **3B** 裁剪）  
- 审计：`script/stage3/matrix_filter_report.json`（标签裁剪与告警）  
- 焦点：覆盖需求点、模块归属、合并是否过猛、优先级、未匹配项、**矩阵裁剪后标签是否合理**  
- 规模：`test_points` **≤40** → 直接列举改动；**>40** → 下发改动清单模板  
- 退出：用户 **「无需修改」** 且 **未匹配列表为空** → `stage3_approved=true`  
- 修改：对话给改动 → 改 JSON → validate → **可再跑 3B（幂等）** → 重导 XMind；**可继续改或直接批准**（不强制二次卡点）  
- 默认 **只局部改 C-TP / 必要时重跑 3.3**；禁止无指令全量重做 1A / 1CTX

### 6.8 进销存测试点底线（Demand 6.0 新增，准度锚点）

生成 3A 时强制检查（可用 Script 清单）：

| 若需求涉及 | 测试点至少覆盖 |
|------------|----------------|
| 单据 | 关键状态迁移（含失败/驳回若文档提及） |
| 库存 | 数量/仓库（有则批次或序列号）至少一条端到端 |
| 收账/支付 | 成功路径 + 一条典型失败/撤销（若产品支持） |
| 多端 | 涉及端主路径；不涉及端 P3 回归各 1 条 |

不满足则自动进入 `pending` 或人审②高亮，不得静默省略。

### 6.9 3B 矩阵标签裁剪（Demand 6.0.4 新增）

#### 6.9.1 目标

模块归属准确之后，按**不同上下文（产品 / 订阅版本）对该模块是否真正支持**，裁剪测试点上的版本标签（及必要时产品标签）。

**示例：** 模块为「商品 / 套餐」，矩阵中开单版本为 ❌ → 从该测试点 `version_tags` 去掉「开单版」，仅保留「单店版」「多店版」。  
**不是**删除整条测试点，也**不是**改模块归属。

#### 6.9.2 定位与约束

| 项 | 约定 |
|----|------|
| 子步骤 ID | `stage3b_matrix_tag_filter` |
| 执行方式 | **纯 [Script]**，不调用 LLM |
| 挂点 | **3A 产出 C-TP 之后、人审② 之前**（建议导出 XMind 前执行） |
| 权威数据 | `src/templates/stage3/project_context.md` →「系统版本功能矩阵表」 |
| 对现有影响 | **不改** `stage3_module` / `stage3a` / C-CTX / C-MOD / C-TP schema；只写回已有 tag 字段 + 新建审计报告 |

与上下文关系：

| 层 | 谁做 | 作用 |
|----|------|------|
| C-CTX | 1CTX + 人审① | 本次测哪些产品/版本/端 |
| 3A 标签初值 | LLM | 一般 ⊆ C-CTX.in_scope |
| **3B** | Script + 矩阵 | 再 ∩「该模块在该产品线下真正支持的版本」 |

端标签：矩阵无端维度 → **3B 不裁** `platform_tags`（仍只跟 C-CTX）。

#### 6.9.3 矩阵列 ↔ 标签映射

| 矩阵列 | 产品维度 | 版本标签 |
|--------|----------|----------|
| 开单版本 | 国内系（智慧记AI进销存 / 智慧记 / 智慧记零售） | `开单版` |
| 单店版本 | 国内系 | `单店版` |
| 多店版本 | 国内系 | `多店版` |
| 国际单店 | `ailit` | `单店版` |
| 国际多店 | `ailit` | `多店版` |

补充（来自 `project_context` 正文）：`ailit` **无开单版** → 凡 `product_tags` 含 ailit，一律不得保留 `开单版`。

#### 6.9.4 单条测试点算法

对每条 `tp`（`module_match != unmatched`）：

1. 按 `product_tags`（缺省则回退 C-CTX.in_scope.products）查矩阵，得到该模块的 **允许版本集合** `allowed`  
2. `new_version_tags = tp.version_tags ∩ C-CTX.versions.in_scope ∩ allowed`  
3. 写回 `tp.version_tags`；若有裁剪则记入报告  
4. **产品标签（建议执行）：** 若某产品在该模块下相关矩阵列全为 ❌（如「云店装修」对国际两列），从 `product_tags` 去掉该产品  
5. **unmatched：** 跳过裁剪

#### 6.9.5 边界与告警（对人展示中文）

| 情况 | 处理 | 告警文案 |
|------|------|----------|
| 裁剪后 `version_tags` 仍 ≥1 | 正常写回 + 报告记 diff | （可选）已按功能矩阵剔除不支持的版本标签 |
| 裁剪后为空 | 告警；**不自动删 TP**；人审② 高亮 | **该功能模块无匹配标签** |
| 模块名不在矩阵 / 知识库无规则 | 告警；保留原标签 | **该功能模块在知识库中没有设置标签匹配规则** |
| C-MOD 与 TP 模块名不一致 | 以 **TP 上模块**为准裁剪 | **测试点模块与归属结果不一致，已按测试点模块裁剪标签** |
| unmatched 跳过 | 不裁剪 | **未匹配模块，跳过标签裁剪**（可选） |

默认 **不因空标签硬阻断 Stage4**（只告警 + 人审可见）；若需严控可配置开关。

报告路径：`script/stage3/matrix_filter_report.json`。`code` 仅脚本过滤用；**控制台 / 人审摘要 / XMind 备注只展示中文 `message`**。

#### 6.9.6 实现产物（新建，不改旧契约文件）

| 文件 | 作用 |
|------|------|
| `stages/stage3b_matrix_tag_filter.md` | 步骤说明 |
| `scripts/stage3/stage3b_matrix_tag_filter.js` | 入口 |
| `scripts/stage3/version_function_matrix.js` | 矩阵解析或与 md 同步的内嵌表 |
| `script/stage3/matrix_filter_report.json` | 审计报告 |

Stage4：用例默认**继承** TP 已裁剪标签；若 4 内又扩标签，可对同一 Script 再跑一遍（规则不另造）。

#### 6.9.7 验收示例

1. 套餐 + 上下文含开单/单店/多店 → 裁掉开单版  
2. 门店管理 → 仅留多店版（及国际多店对应）  
3. 云店装修 + 含 ailit → 去掉 ailit 产品标签（或仅保留国内）  
4. 销售（矩阵全 ✅）→ 标签不变  
5. 重复跑 3B → 报告无新增 diff（幂等）

---

## 七、阶段4：用例生成

### 7.1 阶段目标

将已确认测试点转为 **原子用例**，主交付为 `output/` 下 XMind。

### 7.2 步骤

| 步骤 | 执行方式 | 输出 |
|------|----------|------|
| 4.1 JSON 用例 | [Script]/[Hybrid] | `script/stage4/test_cases.json` |
| 4.2 XMind 导出 | [Script] | **`output/`** `{需求文档title}_测试用例.xmind` |
| 4.3 Excel | [Script] | **默认** `script/stage4/test_cases.xlsx`（用户明确要求再复制到 `output/`） |
| 4.4 知识库转化 | [Hybrid] | **默认** `script/stage4/knowledge_base/` |

### 7.3 用例质量要求（继承 5.0）

- 标题、前提、步骤、每步期望完整；用例原子、互不依赖结果
- XMind：中心 → 一级模块 → 二级模块 → `[P?] 标题` → 前提/步骤 → 期望；支持插图
- 质量度量目标：原子性 ≥95%，完整性 ≥98%，步骤-期望对应 100%，综合 ≥90

### 7.3.1 用例预览与修改（对齐 §8.3）

Stage4 产出 `output/{title}_测试用例.xmind` 后，若用户要审阅/修改：

- **XMind 只读预览**；真源为 `script/stage4/test_cases.json`  
- 用例条数 **≤40**：提示对话直接列举改动；**>40**：下发改动清单  
- 用户可随时贴改动再改 JSON；**不强制**改完后再卡一轮确认——用户说「无需修改 / 可以了」即结束本轮修改（无独立 `stage4_approved` 时，以进入交付/结束对话为准）  
- 禁止静默把「只改了 XMind」当成已生效

### 7.4 知识库转化（继承 5.0，默认不对用户展示）

- 以控件为单元；上下游最多 3 层；已有关系去重  
- 产物留在 `script/`，除非用户要求导出

---

## 八、产物与可视化规范

### 8.1 对外交付清单（唯一用户界面：`output/`）

| 文件 | 何时存在 |
|------|----------|
| `output/需求点_{需求文档title}.xmind` | Stage1A + 人审①′ 前 |
| `output/测试点_{需求文档title}.xmind` | Stage3A + **3B** 完成后 |
| `output/测试用例_{需求文档title}.xmind` | Stage4 完成后 |
| `output/技术改动_{需求文档title}.xmind` | 仅 Stage2 执行时 |

**禁止** 在 `output/` 放置：`.md` 设计稿、`.json`、`.log`、Excel（除非用户显式索取）。  
**禁止** 在工作区根目录散落中间文件；根下仅允许 `input/`、`output/`、`script/` 三个顶栏目录。

### 8.2 同构原则

每个 `output/` 下 XMind 必须有 `script/` 下对应 JSON 源，保证：

- Script 可校验、可断点续跑
- 换模型后只换生成器，不换目录契约
- **以 JSON 为准**：XMind 仅预览；用户改动经对话回写 JSON 后再导出（见 §8.3）；**不做** XMind→JSON 自动回写

### 8.3 人审反馈通则（XMind 只读 + 对话改 JSON）

> 适用于：**人审①′（需求点）**、**人审②（测试点）**、**Stage4 用例预览修改**。  
> **人审①（上下文）**仍以短确认产品/版本/端为主，本通则不强制套用。

#### 8.3.1 原则

| 原则 | 说明 |
|------|------|
| 真源 | 仅 `script/**/*.json`；下游 Stage 只读 JSON |
| XMind | **仅供查看**；在 XMind 中的修改 **不生效** |
| 生效路径 | 对话给出改动 → Agent 改 JSON → validate → 重导 XMind |
| 批准 | 用户明确「无需修改」（或等价）→ 写对应 approved；禁止超时默认通过 |
| 迭代 | **允许**多次给出改动并再改；**不强制**「改完必须再卡一轮确认」——可同轮「改完并批准」，或改完后直接说「无需修改」 |

#### 8.3.2 规模分流

| 对象 | 「小」直接列举改动 | 「大」下发清单模板 |
|------|--------------------|--------------------|
| 需求点（confirmed+pending） | ≤ **20** | > 20 |
| 测试点（test_points） | ≤ **40** | > 40 |
| 测试用例（test_cases） | ≤ **40** | > 40 |

大单单批建议 ≤20 行改动；超出分批发回。

#### 8.3.3 Agent 开场白（必须）

1. 给出 XMind 路径，声明：**只供查看，改动请在本对话说明**  
2. 告知当前条数与分流（小/大）  
3. 选项：无需修改 / 有改动 /（①′）上下文不准退回人审①  
4. **大需求（下发清单模板）时，也必须包含第 1 条的 XMind 只读声明**，不可省略  

#### 8.3.4 改动意图与锚点

补充 / 修改 / 删除 / 待确认→已确认 / 待确认→删除；优先 `RP-xxx` / `TP-xxx` / 用例 id。不清则追问，禁止瞎改。

**展示语言：** 面向用户的模板、开场白、摘要须**全中文**；禁止输出 Pending、Confirmed 等英文状态词，须用「待确认」「已确认」等中文。

#### 8.3.5 明确不做

不做 XMind→JSON 自动解析回写。可选二期：XMind mtime 新于 JSON 时 approve 前警告。

#### 8.3.6 需求点改动清单模板（N>20 时下发）

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

### 8.4 设计文档不再以 Markdown 作为对外标准

Demand 5.0 的 `需求点设计.md` / `测试点设计.md` **降级为可选调试导出**（写入 `script/debug/`），正式规范以本章 `output/` XMind 为准。

---

## 九、工程可迁移与从零重建

### 9.1 三层架构

```
┌─────────────────────────────────────────────────────────┐
│ 契约层（换模型不改）                                      │
│  SKILL.md / demand6.0 / stages 契约 / templates / schemas │
├─────────────────────────────────────────────────────────┤
│ 适配层（换模型只改这里）                                   │
│  adapters/{cursor,claude,openai,generic}.md               │
│  抽象工具 → 具体工具映射（file/shell/confluence）           │
├─────────────────────────────────────────────────────────┤
│ 执行层（尽量纯 Node Script）                               │
│  scripts/stage0~4/*.js 、xmind export、module/tag 规则引擎 │
└─────────────────────────────────────────────────────────┘
```

### 9.2 模型能力分级（继承 5.0，服务 Fast Path）

| 等级 | 能力 | Fast Path 策略 |
|------|------|----------------|
| L1 | 读写文件 | Script 由外部 CI/本地跑；模型只做 1A/3A 文本生成 |
| L2 | L1 + Shell | 默认可跑完全程 Script |
| L3 | L2 + MCP | 可直连 Confluence；无 MCP 则降级本地文档 |

### 9.3 Stage 文档 Front-matter（继承 5.0）

每个可执行 Stage 文档头部声明：`stage_id`、`execution_type`、`inputs`、`outputs`、`quality_gate`、`estimated_duration`、`fast_path`（true/false）、`trigger`（默认/条件）。

### 9.4 Bootstrap（从零重建清单）

新环境按下列顺序可重建工程（详见工程根 **`bootstrap.md`**）：

1. 确认工程根有 `README.md` / `bootstrap.md` / `skill.md` / `output` / `skills` / `src`
2. `cd src/scripts && npm install`
3. 选择并复制 `src/adapters/` 中与当前模型匹配的映射（FOUND-08）
4. 配置 Confluence 凭证或准备本地需求文件
5. 运行自检：见 `bootstrap.md`（产物进工程根 `output/`）
6. 用样例需求跑通 Fast Path 至人审①（上下文确认）（编排见 `skill.md`）

**验收标准：** 在未阅读历史对话的前提下，仅凭仓库文档 + bootstrap，换模型后能跑通样例。

### 9.5 工具抽象（继承 5.0）

Stage 正文只写：`file.read` / `file.write` / `shell.exec` / `confluence.get_page` …  
由当前 adapter 映射到 Cursor / Claude / 其他实现。

---

## 十、并行执行模型

继承 Demand 5.0 §九，差异如下：

| 项 | 5.0 | 6.0 |
|----|-----|-----|
| 子 agent 工作段 | 1.2~1.4 / 3.1~3.4 | **1CTX** / **1A** / **3A** |
| 人审 | 主编排 + CHECK_POINT | 人审①看上下文摘要；人审①′/② **看 XMind、改对话/JSON**（§8.3） |
| 面板展示文件 | md 路径 | **`output/` xmind 路径**（上下文阶段可无 xmind） |
| dashboard.output_files | stage1/2/3/4 多文件 | 指向上述 XMind |
| 断点续传检查点 | 多 JSON | 以 `test_context.json`（+approved）、`requirement_points.json`、`test_points.json` 等为主 |

并行度仍建议 ≤3；超时与断点策略同 5.0。

---

## 十一、完整执行序列（统一标注）

```
┌────────┬──────────────────────────────┬────────────┬────────────────────────────┐
│ 序号   │ 阶段                         │ 方式       │ 说明                       │
├────────┼──────────────────────────────┼────────────┼────────────────────────────┤
│ 1      │ Stage 0 初始化               │ [Script]   │ 含 adapter/bootstrap 自检  │
│ 2      │ 1.1 需求下载与命名           │ [Hybrid]   │ 文件名=内容标题            │
│ 3      │ 1CTX 测试上下文识别          │ [Hybrid]   │ ★ 本批优先；写 C-CTX       │
│ ⛔     │ 人审①（上下文）CHECK_POINT   │ 人工       │ 确认产品/版本/端准确      │
│ 4      │ 1A 需求点提取+越界判断       │ [LLM]      │ 后续实现；须已锁定上下文   │
│ 4b     │ (可选) 1.4 质量门禁          │ [LLM]      │ 仅 Full / 条件触发         │
│ 5      │ Schema 校验 + XMind 导出     │ [Script]   │ output/需求点.xmind        │
│ ⛔     │ 人审①′（需求点）CHECK_POINT  │ 人工       │ 无需修改才继续             │
│ 6      │ Stage 2 技术改动             │ [LLM]      │ 默认跳过；读 input/技术文档│
│ 7      │ 3.3 模块归属                 │ [Script]   │ 强校验                     │
│ 7b     │ (可选) 3.1 风险              │ [LLM]      │ 默认跳过                   │
│ 8      │ 3A 测试点合成+合并+非功能    │ [Hybrid]   │ ★ 单次主生成               │
│ 8b     │ 3B 矩阵标签裁剪              │ [Script]   │ 按功能矩阵剔版本/产品标签 │
│ 9      │ XMind 导出                   │ [Script]   │ output/测试点.xmind        │
│ ⛔     │ 人审② CHECK_POINT            │ 人工       │ 无未匹配 + 无需修改        │
│ 10     │ Stage 4 用例 + XMind         │ [Script]   │ output/测试用例.xmind      │
│ 11     │ Excel / 知识库               │ [Script]   │ 默认仅 script/             │
└────────┴──────────────────────────────┴────────────┴────────────────────────────┘
```

---

## 十二、回退与异常处理

| 场景 | 处理 |
|------|------|
| 1CTX 枚举非法 / confidence 过低 | 人审①修正；禁止未批准进 1A |
| 人审①（上下文）修改 | 回写 test_context.json → 再确认；默认不重下载 |
| 1A pending / 越界占比过高 | 建议 Full Path；不自动瞎补需求点 |
| 人审①′（需求点）修改 | 对话改 JSON→重导出 XMind；默认可继续改或直接「无需修改」批准（§8.3）；不重跑 1CTX |
| 3.3 未匹配 | 人审②前必须清空；否则禁止 Stage4 |
| 3B 标签裁剪后为空 / 模块无矩阵规则 | 中文告警（§6.9.5）；默认不删 TP；人审② 高亮；可选开关硬阻断 |
| 人审②修改 | 对话改 C-TP→（可再跑 3B）→重导出；允许迭代；默认不重跑 1A/1CTX |
| Stage4 质量不达标 | 回退测试点，不直接在用例层「发明」业务 |
| 子 agent 超时 | 断点续跑；可选用已有 JSON 进对应人审 |
| Confluence 失败 | 降级本地 `input/需求文档/` |

---

## 十三、知识库与模板

### 13.1 统一约定（Demand 6.0）

| 规则 | 说明 |
|------|------|
| **唯一根路径** | 所有 Stage / Script 只读工程内 **`testcase-generation-skills/src/templates/`** |
| **禁止复制** | Stage0 **不**把 templates 复制进 `output/{title}/`；工作区**不**再维护 `script/templates/` |
| **禁止误读** | 下游 **禁止** 从工作区 `script/templates/` 或 `output/.../templates/` 读映射/规则（该路径不应存在） |
| **解析方式** | Script 以 `src/` 为基准拼路径（如 `path.join(SRC_ROOT, 'templates', 'stage3', 'module_mapping.md')`）；**勿**用 `--project-dir`（工作区）拼接 templates |

### 13.2 模板清单

| 文档 | 路径（相对工程） | 用途 | 阶段 |
|------|------------------|------|------|
| 隐性需求模板 | `src/templates/stage1/implicit_requirements.md` | 1A 按需引用 | 1A |
| 需求文档过滤 | `src/templates/stage1/requirement_doc_filter.md` | **1A 提取前过滤**（背景/调研等） | **1A** |
| 质量问题分级 | `src/templates/stage1/quality_issues.md` | 仅 Full/1.4 | 条件 |
| 模块映射表 | `src/templates/stage3/module_mapping.md` | **强校验** | 3.3 |
| 项目背景 / 功能矩阵 | `src/templates/stage3/project_context.md` | **版本功能矩阵标签裁剪** | **3B** |
| 优先级规则 | `src/templates/stage3/priority_rules.md` | 3A | 3A |
| 标签规则 | `src/templates/stage3/tag_rules.md` | 无收银机端/不使用 | **1CTX（优先）**、1A、3A |
| 星火功能信息 | `src/templates/stage3/星火功能信息.txt` | 模块补充（**若缺失则跳过并告警**） | 3.3 |
| 用例 Excel 模板 | `src/templates/stage4/数据模板_用例管理.xlsx` | Excel 导出 | 4（写入 `script/stage4/`） |

**Demand 6.0 欠账显式化（不假装已有）：**

- 历史测试点 / 易错点知识库：未建设前 **3.1 默认关闭**
- 代码 diff 自动对接：未实现前 Stage2 仅吃「已提供的改动说明文件」
- 星火功能信息文件：缺失时 3.3 仅用 module_mapping，并在日志告警

---

## 十四、与 Demand 5.0 / 实现层对齐说明

### 14.1 从 5.0 删除或降级的默认行为

| 项 | 处理 |
|----|------|
| 1.2/1.4 多份分析 JSON 默认全跑 | 降级；Fast 为 **1CTX→确认→1A**，不再一次糊成大包 |
| 对外 md 设计文档 | 降级为 script/debug |
| 根目录暴露多阶段 output 树 | 改为 `input/`+`output/`+`script/` 平级；对外仅 `output/*.xmind`；目录=需求 title |
| 3.5 修改后默认级联 3.2~3.5 全重跑 | 改为局部重跑；全量需用户确认 |
| 「精简」口号但步骤全开 | 改为可执行的跳过表 §1.2 / §11 |

### 14.2 实现层后续改造清单（本文档义务，不含实现细节）

1. 新增/改写 `skill.md` 调度为 Fast Path（含 1CTX→人审①→1A→人审①′）  
2. stages：提供 `stage1_context.md`（优先）、`stage1_context_checkpoint.md`、`stage1a_requirement_synthesis.md`（后续）、`stage3a_testpoint_synthesis.md`、`stage3b_matrix_tag_filter.md`（3B）  
3. XMind 导出扩展：需求点/测试点（不仅用例）  
4. 目录创建逻辑改为 §3.3  
5. 清理 stages/scripts 中残留「收银机端」等与标签规则冲突项  
6. 补 `src/adapters/`；入口文档保持工程根 `bootstrap.md` + `skill.md` + `README.md`
7. Stage2 仍可无独立实现时：保持「有输入才提示人工/LLM 轻量处理」

### 14.3 依赖 Skill

`skills/confluence-download/` 保持独立（demand6.0 体系）；本框架只约定：

- Stage0 可发现并调用
- 下载落盘路径必须是 `input/需求文档/`，**文件名=页面 title（清洗后）**
- 工作区目录名 = 同一 title；**不使用故事编号**

---

## 十五、关键改动总结（Demand 6.0）

### 15.1 对应 proposal 四原则

| 原则 | 落地章节 |
|------|----------|
| 1 效率优先，低价值跳过 | §1、§4.7、§5、§6.1、§11 |
| 2 可迁移、从零重建 | §9 |
| 3 设计与用例均 XMind | §4.8、§6.6、§7、§8 |
| 4 对外只暴露 XMind，中间进 script，命名=需求 title；input/output 平级中文子目录 | §3.3～§3.5、§8 |

### 15.2 准确度保留

- 模块强校验、等价合并、核心禁去重、非功能条件、P3 回归、CHECK_POINT  
- **上下文先行 + 人审①锁定产品/版本/端**（§4.3～§4.4）  
- 新增进销存底线检查（§4.5 `inventory_checks`、§6.8）
- 需求越界判断（§4.5，后续实现）
- **3B 功能矩阵标签裁剪**（§6.9：模块支持范围 ∩ 上下文，剔除不支持的版本/产品标签）

---

## 十六、版本变更记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| 5.0 | 2026-07-18 | 整合 skill、并行修正、CHECK_POINT、模型接口、质量度量 | 测试框架设计组 |
| **6.0** | **2026-07-21** | **对外目录仅 skill.md / output / skills / src；产物统一落工程 `output/`（废弃 `code/`）；规格与脚本迁入 `src/`；Fast Path、title 主键、工作区内 input∥output∥script、进销存底线等** | 测试框架设计组 |
| 6.0.1 | 2026-07-21 | 模板约定：全 Stage 只读 `src/templates/`，取消复制到工作区 `script/templates/`（§3.2 0.4、§13） | 测试框架设计组 |
| **6.0.2** | **2026-07-21** | **Stage1 拆分：1CTX 上下文先行 → 人审①确认产品/版本/端 →（后续）1A 需求点+越界 → 人审①′；禁止未锁定上下文进 1A** | 测试框架设计组 |
| **6.0.3** | **2026-07-22** | **§8.3 人审反馈通则；output XMind 命名改为 `{类型}_{title}.xmind`；测试点 XMind 不再展示等价合并报告** | 测试框架设计组 |
| **6.0.4** | **2026-07-22** | **新增 §6.9 3B 矩阵标签裁剪：按 `project_context` 功能矩阵剔除模块不支持的版本/产品标签；告警中文；不改 3.3/3A 既有契约** | 测试框架设计组 |

---

**文档结束**
