# 测试用例生成框架 - Demand 6.4（P0 回流策略与路径可召回约束）

## 版本说明

| 项 | 内容 |
|----|------|
| 版本号 | 6.4 |
| 创建日期 | 2026-08-06 |
| 基于版本 | Demand 6.2（KB 模型）+ Demand 6.3（回流管道 / 独立 KB Skill） |
| 文档定位 | **规格设计**：P0 用例回流；Stage3 路径与接口断言缺口；Stage4 UI/接口双断言；写前完整性门禁 |
| 状态 | **已实现（见 outline6.4）**；不替代 6.2 目录模型，不另建第二套审核管道 |
| 触发背景 | 现有 XMind 回流仅抽「技术引用」节点时，纯功能 P0 用例（无 URL/API）产出 0 candidate，无法沉淀页面/元素知识 |

### 与相邻 Demand 的硬边界

| 文档 | 职责 |
|------|------|
| **6.0 / skill.md** | Fast Path 生成；本需求为其 Stage3/4 **增加路径写法约束** |
| **6.1** | 临时 `domain_facts`；Stage4 仍禁止直接读 facts |
| **6.2** | 知识库 Markdown 真源、表头、状态、截取纪律 |
| **6.3** | 回流触发、两级审核、ChangeSet、来源适配骨架 |
| **6.4（本文）** | 回流严格只取 P0；生成侧路径约束；可信接口引用的断言规则；写前缺口门禁 |

> **关系：** 6.4 只增加生成约束和回流候选规则；落盘仍走 6.3 ChangeSet / 两级审核，目标仍是 6.2 Markdown。  
> 6.4 不允许 Stage3/4 再次直读长期 KB 或 Confluence；它们只消费前序已归一化的 C-RP、`domain_facts`、C-TP `technical_refs` 和人工审核结果。

### 核心原则

1. **回流严格只取 P0**：P1/P2/P3 不进入回流候选，也不存在人工“升格回流”。  
2. **每个目标页只写一次导航路径**：后续在当前页的元素操作不得重复完整路径。  
3. **单一缺口真源**：路径缺口只写 `merge_report.path_gaps[]`；接口断言缺口只写 `merge_report.api_assertion_gaps[]`，人审清单均由此渲染。  
4. **禁止推断接口**：只有 C-TP 中已固化的 `backend_api technical_refs` 能触发 Stage4 接口检查。  
5. **能力分级**：只有 Method/Path 时仅展示技术引用；同时具备结构化 assertions 时才生成字段级接口断言。  
6. **写前分级门禁**：只用 `blocking_gaps` 阻断；可选列缺失进入 `warning_gaps`，不得“一缺全停”。  
7. **含接口 P0 优先展示**：只影响 P0 集合内部排序，不扩大回流范围。

---

## 一、目标与非目标

### 1.1 目标

1. 让无 URL/API、但有明确页面路径的 P0 用例也能产生页面、关系和元素候选。  
2. 让 Stage3 在 C-TP 定稿前统一暴露路径缺口与接口断言缺口。  
3. 让 Stage4 在有可信接口 assertions 时生成 UI 现象 + API 响应双断言；信息不足时不猜。  
4. 让回流候选在写盘前按“阻断缺口 / 警告缺口”完成一次确定性校验。

### 1.2 非目标

- 自动把全部用例树灌进知识库。  
- 用 LLM 猜测前端 URL、后端接口、未文档化的跳转边。  
- 改变 6.2 表头列名或绕过 6.3 两级审核。  
- Stage4 为补路径或接口而读取长期 KB、Confluence 或 `domain_facts`；所有信息须在 C-TP 定稿前固化。  
- 把完整请求/响应报文、Token、真实业务 ID 写入用例或知识库（仅规范化 Path + 关键字段断言口径）。  
- 本文直接交付完整脚本（规格优先；实现见后续 outline6.4）。

---

## 二、问题陈述（为何需要 6.4）

### 2.1 现状失败模式

| 现象 | 原因 |
|------|------|
| V4.6.1 等功能用例 XMind 回流 **0 candidate** | KB Skill v0.1 优先/仅抽「技术引用」结构化节点；纯功能用例无 URL/API |
| 步骤只有「点击搜索」 | 缺少「从哪进到哪页、点哪个元素」的可复用路径，无法沉淀到「页面关系 / 核心元素」 |
| Agent 不知补什么 | 没有「对照表头列齐性」的停手清单，只能跳过或瞎猜 |

### 2.2 期望闭环

```text
C-MOD 后统一截取 → domain_facts
  → Stage3A 生成 C-TP，并附着路径事实 / technical_refs / api_assertions
  → path_gaps、api_assertion_gaps → 人审②补齐 → C-TP 定稿
  → Stage4 只读 C-TP：导航步骤 + UI 断言；有 assertions 才加 API 断言
  → 最终 C-TC / XMind
  → 回流严格过滤 P0，含接口 P0 优先展示
  → 解析页面 / 关系 / 元素 / 明确 API
  → 完整性检查：blocking_gaps / warning_gaps
  → 6.3 KB-概审 → KB-内容审 → apply
```

---

## 三、回流范围收缩（仅 P0）

### 3.1 准入

同时满足才进入回流抽取：

| 条件 | 说明 |
|------|------|
| 优先级 | 用例或测试点 `priority === P0`（XMind 标题含 `[P0]` 视为 P0） |
| 来源 | Stage4 最终 C-TC 或其导出的最终 XMind；须有 `finalized=true`（或等价完成标记）及源文件 hash，禁止依赖聊天中的“可以了”判断版本 |
| 端标识 | 能解析出 `web` / `app`（来自标签 PC端/APP端 等） |
| 可定位 | 至少能抽出 **统一页面名称**（须以「页」结尾）或 **明确跳转路径** 之一 |

### 3.2 默认排除

- P1 / P2 / P3 用例（含回归、兼容扫尾）；概审不得将其升格为回流候选。  
- 纯数据准备、账号登录特例、单次造数、与产品无关的环境步骤。  
- 仅复述操作而无稳定页面/元素名的句子。  
- 国际版/国内版差异若仅为标签、无独立页面元素，不单独拆页（可写补充说明候选，仍须人审）。

### 3.3 与 6.3「技术引用优先」的关系

| 来源类型 | 6.4 策略 |
|----------|----------|
| 有「技术引用」节点 | 仍解析；作为 `page_url` / `backend_api` **增强候选** |
| 无技术引用的 P0 功能用例 | 走「前提 + 导航步骤」抽取页面/元素；不得因无 URL/API 直接 0 candidate |
| 步骤中含接口检查（`GET/POST … /path`） | 只作结构化 `technical_refs` 的交叉验证；不得单独据此猜页面/元素绑定 |
| 自由文本中的 URL/API | 低可信，仅作候选，强制人审；禁止未审直接 `已确认` |

### 3.4 回流排序（含接口优先）

在 P0 集合内，overview / 默认 selected 按下列优先级排序（高 → 低）：

1. `technical_refs` 含 `backend_api` 的用例；若同时有 assertions，标记更高完整度；  
2. 含合规导航步骤、可抽出跳转边/元素的用例；  
3. 仅有页面名、路径不完整的用例（进入 `blocking_gaps`）。

概审文案须标明：`api_rich=true` 的条目为「建议优先确认回写」。排序不影响 P0-only 过滤。

---

## 四、生成侧约束：步骤必须携带路径（Stage3 同步）

### 4.1 写法规范（对人 / 对机器）

当用例首次进入目标页时，必须生成一条独立导航步骤：

```text
进入{统一页面名称}（{进入路径}）
```

**示例（对齐业务用例习惯）：**

```text
进入销售开单商品选择页（APP首页 → 选择销售 → 销售开单页 → 点击「选择商品」→ 销售开单商品选择页）
```

| 段 | 要求 |
|----|------|
| 统一页面名称 | 与 KB 页面清单一致并以「页」结尾；“页面”须规范化为“页”后再入库 |
| 进入路径 | 统一使用 `→`；从稳定入口到目标页；页面与“点击元素”动作交替表达 |
| 后续元素操作 | 只写当前页元素及操作，不重复整条导航路径；跨到新页面时再新增导航步骤 |

**禁止：**

- 首次进入目标页只写「进入开单页」而无括号路径；  
- 在同一页面的每个元素步骤重复粘贴完整导航路径；  
- 路径中使用无法入库的临时文案（「随便点一下」「按上次操作」）；  
- 用 URL 代替导航路径（URL 另走技术引用 / 页面关系 URL 列）。

### 4.2 适用阶段

| 阶段 | 要求 |
|------|------|
| **Stage3A（C-TP）** | 每个目标页最多一条导航步骤；同页后续元素步骤不重复路径 |
| **Stage4（C-TC）** | `steps[].action` 继承导航步骤和元素步骤；不得丢失或重复扩写路径 |
| **XMind 导出** | 步骤节点保留完整路径字符串，供 6.3/6.4 回流解析 |

### 4.3 路径知识从哪来

信息在 Stage3A 前统一归一化，Stage3A 不再直接打开 KB 或 Confluence：

1. KB extract 将已确认路径写入 `domain_facts`；  
2. Stage1 将需求正文 / Confluence 明确路径归一化到 `domain_facts`；  
3. 人审答复写入 `human_review` 临时事实；  
4. Stage3A 只消费上述契约；仍无路径则写 `path_gaps`。

> Stage4 **不得**为补路径去读长期 KB；须在 3A 前通过 KB 截取写入 facts，或由未确认点在人审②前补齐。

### 4.4 未确认点（强制列出）

当 P0 测试点确实需要进入页面或操作页面元素，且：

- KB 截取未给出相关跳转边 / 元素定位；且  
- 需求 Confluence/正文亦无明确路径；

则只写入唯一机器真源 `merge_report.path_gaps[]`：

```json
{
  "tp_id": "TP-001",
  "page_id": "销售开单商品选择页",
  "element_name": "顶部.搜索框",
  "platform": "app",
  "reason": "kb_and_requirement_path_missing"
}
```

人审②清单从 `path_gaps[]` 渲染；禁止回写或修改已通过人审①的 C-RP。

**未补齐路径的 P0 点：**

- P0 且适用路径规则时，`path_gaps` 非空则不得 `stage3_approved`；API-only、后台任务、无页面交互的 P0 不适用路径门禁；  
- 回流时该点**不得**生成「已确认」页面关系边。

### 4.5 Stage3 文档改造点（实现清单）

须同步修改（outline6.4 跟踪）：

- `src/stages/stage3a_testpoint_synthesis.md`：增加“每页一次导航步骤”；有接口 facts 时写入 `technical_refs`；  
- `validate_tp.js` / `tp_quality_gates`：只对适用页面交互的 P0 检查导航步骤；  
- `stage3_checkpoint.md`：人审②从 `path_gaps[]` / `api_assertion_gaps[]` 渲染两个缺口专节；  
- Prompt / 模板中示例改用带路径的步骤。

---

### 4.6 Stage4：可信接口引用的双断言

#### 4.6.1 触发条件

唯一触发条件：C-TP `technical_refs[]` 中存在与当前场景绑定的 `type=backend_api`。其来源可以是 KB、需求正文或人审，但都必须先在 Stage3A 固化为 C-TP 契约。

“搜索/保存可能调用接口”等动作语义不能证明接口存在。无 `backend_api technical_refs` 时，Stage4 不得生成或猜测接口步骤。

#### 4.6.2 接口引用能力分级

```json
{
  "type": "backend_api",
  "platform": "app",
  "page_id": "销售开单商品选择页",
  "element_name": "顶部.搜索框",
  "method": "GET",
  "target": "/v1/baseinfo/product/query/list",
  "operation": "查询全部类别商品",
  "kb_ref": "…",
  "assertions": [
    {
      "location": "body",
      "json_path": "$.data.list",
      "operator": "contains",
      "expected": "{test_data.product_b}"
    },
    {
      "location": "body",
      "json_path": "$.data.list",
      "operator": "not_contains",
      "expected": "{test_data.product_a}"
    }
  ]
}
```

| 引用信息 | Stage4 行为 |
|----------|-------------|
| 无 backend_api ref | 只生成 UI/业务断言 |
| 只有 Method/Path/operation | UI 断言 + XMind「技术引用」；不生成字段级接口期望 |
| 同时有非空 assertions | UI 断言后追加 API 检查步骤，生成字段级期望 |

Method/Path 已知但 assertions 缺失时，Stage3A 写入 `merge_report.api_assertion_gaps[]`；对需要验证接口结果的场景，该缺口在人审②补齐前阻断 `stage3_approved`。不得由 Stage4 猜测。

`assertions[]` 每项至少包含：

| 字段 | 约束 |
|------|------|
| `location` | `status` / `header` / `body` |
| `json_path` | `body` 必填；其他位置可省略 |
| `operator` | `eq` / `contains` / `not_contains` / `exists` / `not_exists` / `unique` |
| `expected` | 除 `exists` / `not_exists` / `unique` 外必填；可为字面量或 `{test_data.*}` 引用 |

`api_assertion_gaps[]` 最小字段为 `{ tp_id, technical_ref_index, missing_fields, reason }`，以索引显式关联 C-TP 中的接口引用。

#### 4.6.3 用例结构要求

当任意优先级的 TP 具备完整 backend_api assertions 时（**不限 P0**），Stage4 生成：

| 类型 | 步骤意图 | 期望意图 |
|------|----------|----------|
| **现象断言** | 在导航步骤之后操作当前页 UI | 界面展示/状态符合业务预期 |
| **接口断言** | 查看/抓取对应接口（写明规范化 Path，可带短用途） | 响应关键字段/集合符合预期（含／不含某数据、去重等） |

**推荐顺序：**

1. 一条 UI 操作 + 现象期望；  
2. 紧随对应 API 检查步骤；  
3. 一个 UI 操作触发多个 API 时，UI 步骤只写一次，各 API 分别追加检查步骤，不重复 UI 现象。

**示例形态（示意，非固定文案）：**

```text
步骤N: 进入商品选择页（APP首页 → 销售开单页 → 点击「选择商品」→ 商品选择页）
期望N: 商品选择页正常展示

步骤N+1: 在热销分类下搜索关键字「A」
期望N+1: 当前分类展示 AAA；全部类别结果中展示 ABB 且不含 AAA（去重）

步骤N+2: 查看热销商品列表接口 `GET /v1/baseinfo/product/query/workspace/...`
期望N+2: 响应 list 含商品 AAA

步骤N+3: 查看全部类别商品列表接口 `GET /v1/baseinfo/product/query/list`
期望N+3: 响应 list 含 ABB、不含 AAA
```

#### 4.6.4 纪律

- Path 须规范化（与 6.2 一致）：可带 `{placeholder}`；禁止域名、Token、真实租户/单据 ID、完整报文粘贴。  
- 期望只写**可判定**口径（含/不含、字段等于、列表去重），禁止「接口正常」空话。  
- `technical_refs` 和 assertions 必须原样或裁剪自 C-TP，Stage4 **不得**新造 Path、字段或期望值。  
- XMind 导出：接口步骤保留 Path 字符串；「技术引用」节点与步骤可并存，回流以步骤 + technical_refs 双通道解析。  
- 非接口型纯前端交互（KB 标明 `无后端调用（纯前端）`）→ 不强制接口断言步骤。

#### 4.6.5 Stage4 改造点（实现清单）

- C-TP / C-TC `technical_refs.backend_api` 增加可选 `assertions[]` 契约；  
- `stage4_test_case_generation.md` / `stage4_execute.js`：只有 assertions 非空时生成 API 检查步骤；  
- 质量门禁：任意 TP 有 assertions，但关联 TC 缺接口检查步骤 → 失败；  
- Excel/XMind 导出不丢 Path。

---

## 五、写入知识库规则（从用例抽 → 表头校验 → 人补）

### 5.1 抽取对象（P0 用例）

从 **前提条件、步骤、期望** 中抽取候选（不猜）：

| 候选 kind | 抽取线索 | 落盘目标（6.2） |
|-----------|----------|-----------------|
| `page_relation` | 路径链中的「页→动作→页」 | `页面关系.md` 分端跳转路径 |
| `page` / 页面清单 | 「…页」统一名称、角色线索（主页面/子页面） | 页面清单 + 元素文件 frontmatter |
| `page_element` | 步骤中的控件名（搜索框、分类标签、按钮文案）+ 所在页 | `主页面_*` / `子页面_*` 核心元素表 |
| `supplement` | 稳定规则（如上限 100、去重、无结果提示） | 补充说明（须过滤单次数据） |
| `page_url` / `backend_api` | 仅当用例/技术引用/**接口断言步骤**明确给出 | URL 列 / 后端接口列 |

**含接口用例的抽取加强：**

- 优先读取结构化 `technical_refs`，其中必须包含 `platform + page_id + element_name + method + target`；  
- 接口步骤只作为交叉验证证据；禁止按“最近 UI 步骤”猜绑定关系；结构化绑定缺失时进入 `blocking_gaps`；  
- 同一元素多接口（热销列表 + 全部类别列表）允许多条 API，用 `<br>` 或分行写入后端接口列。

### 5.2 路径解析规则（机器）

对步骤中的括号路径：

```text
进入{目标页}（{入口} → {动作1} → {中间页} → {动作2} → {目标页}）
```

1. 规范写入统一使用 `→`；兼容读取历史 `-` / `／`，解析后立即归一化；  
2. 以「页」结尾的 token → 页面节点；其余 → 动作或元素点击；  
3. 相邻「页 + 动作 + 页」→ 一条 `page_relation` 候选；  
4. 目标页 + 本步操作的控件名 → `page_element` 候选（元素名用稳定中文名，如 `顶部.搜索框`）；  
5. 无法拆出至少一页时 → 不入库，写入 `blocking_gaps`（`reason=path_unparseable`）。

### 5.3 表头完整性门禁（停手条件）

抽取完成后、生成 KB-概审前，按 6.2 校验每条拟写入项。完整性报告可以生成 overview，但 `blocking_gaps` 非空时不得创建 review workspace 或 apply。

#### 5.3.1 页面关系（Web）

| 必查 | 缺失时 |
|------|--------|
| 统一页面名称（以「页」结尾） | 阻断该条 |
| 角色、支持端（可从用例标签推导时须人确认） | 新页面候选缺失则进入 `blocking_gaps` |
| 跳转路径三列 `起点\|动作\|终点` | 仅对 relation 候选校验；三元组不完整则阻断该 relation，不要求每个页面都必须有关系边 |
| Web「前端 URL 模板」 | 新增/更新 Web 页时缺失为阻断；App 页不检查 URL；历史未改动页只 warning |

#### 5.3.2 核心元素（分端）

对照表头：

`元素 | 位置 | 输入/选项 | 交互 | 交互结果 | 后端接口 | 下游影响说明`

| 列 | 用例能提供时 | 提供不了时 |
|----|--------------|------------|
| 元素 | 步骤中的控件名 | 阻断 |
| 位置 | 路径/文案中的方位（顶部、左侧等） | `warning_gaps` |
| 输入/选项 | 前提/步骤中的约束 | `warning_gaps`；允许空 |
| 交互 | 步骤动作 | `blocking_gaps` |
| 交互结果 | 期望结果（限本页） | `blocking_gaps` |
| 后端接口 | 明确 API，或明确 `无后端调用（纯前端）` | 新增/更新元素仍为 `待确认` 时阻断升为已确认 |
| 下游影响说明 | 跨页后果；过长改补充说明 | 可 `—` |

#### 5.3.3 输出给人审的清单（强制）

Agent / CLI 必须输出结构化报告（可写入 overview 附件）：

```json
{
  "schema_version": "6.4",
  "source_type": "xmind",
  "source_hash": "sha256:…",
  "p0_case_ids": ["TC-001"],
  "extracted": {
    "pages": [{ "page_id": "销售开单商品选择页", "fields_present": ["page_id", "platform"] }],
    "relations": [],
    "elements": [{ "page_id": "…", "name": "顶部.搜索框", "fields_present": ["name", "interaction"] }]
  },
  "blocking_gaps": [
    { "ref": "销售开单商品选择页", "field": "前端 URL 模板", "platform": "web", "reason": "new_web_page" },
    { "ref": "顶部.搜索框", "field": "后端接口", "platform": "app", "reason": "api_or_pure_frontend_unknown" }
  ],
  "warning_gaps": [
    { "ref": "顶部.搜索框", "field": "位置", "platform": "app" }
  ],
  "blocked_write": true,
  "next_action": "human_fill_then_reoverview"
}
```

**规则：**

- `blocked_write = blocking_gaps.length > 0`；`warning_gaps` 不阻断；  
- blocked 时仍输出 overview，但不创建 review workspace、不 apply；  
- 若用户明确选择“仅保存待确认草稿”，须走独立 draft-only 分支，不得与“写入已确认语义库”混用；  
- 人补齐后重新 prepare/overview，再走 6.3 KB-概审 / 内容审。

### 5.4 与 6.3 两级审核的衔接

```text
P0 过滤 → 候选解析与显式绑定 → 完整性报告
  → blocking_gaps 非空：overview + 人补 → 重新 prepare
  → 无 blocking_gaps：6.3 ChangeSet + KB-概审
  → 评审工作区 + KB-内容审
  → apply / Git
```

覆盖旧已确认知识时，仍遵守 6.3 覆盖高亮，不得因 6.4 抽取而静默覆盖。

---

## 六、回流管道改造要点（相对 6.3 v0.1）

| 项 | 6.3 / 当前实现 | 6.4 要求 |
|----|----------------|----------|
| 候选来源 | 偏技术引用节点 | P0 前提 + 单次导航步骤为主，技术引用为增强 |
| 优先级过滤 | 无 | 严格只取 P0，不允许升格 |
| 含接口用例 | 未加权 | P0 内优先排序；不扩大范围 |
| 0 candidate | 常见于功能用例 | 有导航步骤的 P0 应能产出 page/element/relation 候选 |
| 完整性 | 依赖 validate 写后失败 | 写前区分 `blocking_gaps` / `warning_gaps` |
| 生成约束 | 未强制路径 | 每个目标页一次导航步骤；缺口唯一落 `merge_report` |
| Stage4 接口 | 可选 technical_refs 展示 | 有 ref 仅展示；有 assertions 才生成字段级双断言 |

---

## 七、验收标准

### 7.1 回流

- [ ] 仅含功能步骤、无 URL/API 的 P0 XMind，只要有合规导航步骤，即可抽出 ≥1 条页面或元素候选。  
- [ ] P1/P2/P3 不出现在 changeset，概审也不能升格。  
- [ ] `blocked_write === (blocking_gaps.length > 0)`；warning 不阻断。  
- [ ] 不出现臆造的 URL/API/跳转边。  
- [ ] 含结构化 backend_api ref 的 P0 在 overview 中排在前列；绑定字段不完整时进入 blocking_gaps，不按邻近步骤猜测。

### 7.2 生成

- [ ] 适用页面交互的 P0 每个目标页恰有一条导航步骤；同页元素步骤不重复路径。  
- [ ] `path_gaps` / `api_assertion_gaps` 是唯一机器真源，人审②清单由其渲染。  
- [ ] Stage4 保留导航步骤，不直接读取 KB、Confluence 或 domain_facts。  
- [ ] 任意 TP 只有 Method/Path 时仅展示技术引用；有 assertions 时才生成字段级接口检查步骤。  
- [ ] 无接口信息时不编造接口步骤。

### 7.3 回归

- [ ] 6.2 样例库校验与既有 extract 自测不因 6.4 退化。  
- [ ] 6.3 text/xmind 技术引用回流仍可用。  
- [ ] Fast Path 非 P0 用例生成不被误阻断（路径门禁默认只严卡 P0）。

---

## 八、实现工作包（预告，细则见 outline6.4）

| ID | 工作包 | 要点 |
|----|--------|------|
| WP-64-SCOPE | P0 过滤 | XMind/C-TC 严格只扫 `[P0]` / priority=P0；api_rich 排序 |
| WP-64-PATH-PARSE | 路径解析 | 单次导航步骤 → relation / page / element |
| WP-64-CONTRACT | 契约扩展 | assertions、path_gaps、api_assertion_gaps |
| WP-64-GATE | 完整性报告 | blocking/warning + blocked_write |
| WP-64-S3 | Stage3 约束 | 单次导航步骤 + technical_refs/assertions 附着 |
| WP-64-S4 | Stage4 双断言 | assertions 非空 → UI + API 检查步骤 |
| WP-64-ORCH | Skill 文案 | overview 展示分级缺口与含接口 P0 优先项 |

---

## 九、术语

| 术语 | 含义 |
|------|------|
| 导航步骤 | 每个目标页一次的“进入页面（路径链）”步骤 |
| path_gaps | 唯一的路径缺口机器真源 |
| api_assertion_gaps | Method/Path 已知但接口断言口径不足的机器真源 |
| blocked_write | `blocking_gaps` 非空；可生成 overview，但不得 review/apply |
| P0 回流 | 仅从优先级 P0 的核心用例抽取知识 |
| 双断言 | 同一接口型场景下，既断言界面现象，又断言接口响应关键口径 |
| api_rich | P0 用例含结构化 `technical_refs.backend_api`，仅用于 P0 内排序 |

---

## 十、修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| **6.4** | **2026-08-06** | 初版：P0 回流、路径约束、双断言、完整性门禁 |
| **6.4-r1** | **2026-08-06** | 架构审查优化：P0 严格过滤；每页一次导航；缺口单一真源；assertions 分级；阻断/警告分离 |
