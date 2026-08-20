# 测试用例生成框架 - Demand 6.3（知识回流与独立 KB Skill）

## 版本说明

| 项 | 内容 |
|----|------|
| 版本号 | 6.3 |
| 创建日期 | 2026-08-05 |
| 基于版本 | Demand 6.2（长期知识库真源 / 截取 / 补充入口） |
| 文档定位 | **规格设计**：用例/XMind/Confluence → 知识库回流；与 6.2 体系合并；KB Skill 独立拆分 |
| 状态 | **目标规格（尚未实现）**；当前可运行基线仍为 6.2 `skill.md` + `stage_kb_ingest.md` |
| 实现大纲 | [`outline6.3.md`](./outline6.3.md)：编排 6.2 URL/API 增量与 6.3 独立 Skill / 回流实现 |
| 后续规格 | 回流内容策略见 [`testcase-generation-demand6.4.md`](./testcase-generation-demand6.4.md) |

### 与相邻 Demand 的硬边界

| 文档 | 职责 |
|------|------|
| **6.0 / skill.md** | Fast Path 生成用例；**不**默认写长期库 |
| **6.1** | 临时 `domain_facts.json`；Stage4 仍禁止读事实文件 |
| **6.2** | 知识库目录、命名、矩阵/关系/元素、截取、Git、`补充知识库` 旁路骨架 |
| **6.3（本文）** | 回流触发、来源适配（用例/XMind/Confluence）、**人审概览→写入→路径复审**、覆盖提醒、**独立 KB Skill 拆分设计** |
| **6.4** | **P0 回流收缩**、步骤路径括号约束、从前提/步骤抽页面元素 + **表头完整性门禁**；见 [`testcase-generation-demand6.4.md`](./testcase-generation-demand6.4.md) |

> **关系：** 6.3 不另建第二套知识库模型；落盘目标、状态机、准入过滤、索引纪律一律沿用 6.2。  
> 6.3 扩展的是「谁触发、从哪读、怎么给人审看、怎么拆 skill」。  
> **抽取过窄 / 路径不可召回问题**由 **Demand 6.4** 细化（P0-only、步骤路径、表头完整性），实现时与本文管道衔接。

### 核心原则

1. **回流 = 走统一「补充知识库」管道**，不绕过 6.2 的校验 / 状态 / Git。  
2. **简洁优先**：只收可复用项目事实；单条用例特例、纯操作步骤、背景过程不入库。  
3. **两级审核，不复用 Fast Path 编号**：**KB-概审**确认范围；**KB-内容审**打开评审工作区的 Markdown/diff 核对正文；两级都通过后才改语义库。  
4. **覆盖必醒目**：新知识否定旧已确认知识时，概览中单独高亮，禁止静默覆盖。  
5. **来源读盘必新鲜**：XMind / 本地文件以磁盘最新内容为准；禁止用会话缓存、旧 C-TC、旧下载副本冒充最终稿。  
6. **KB Skill 可独立**：入库与维护可像 `confluence-download` 一样独立触发；生成用例 Skill 只保留「截取消费」与「可选回流提示」薄胶水。

---

## 一、目标与非目标

### 1.1 目标

1. 将「用例回流 / 本地 XMind / Confluence」统一并入 6.2「补充知识库」体系。  
2. Stage4 用户确认用例后，**可选**提示补充知识库；确认后用最终用例 XMind 触发同一命令管道。  
3. 用户可直接 `补充知识库` + 本地 `.xmind` 或 Confluence URL，完成清洗入库。  
4. 写入前输出**人工复审概览**（模块 → 页面 → 元素 → 一句话改动）；确认范围后再写盘。  
5. KB-概审后生成**评审路径与精确 diff**；KB-内容审通过后才写语义库并回传最终路径。  
6. 新版本覆盖旧知识时，在概览中**重点提醒**并要求明示确认。  
7. 给出将 KB 能力拆到 `skills/` 独立 Skill 的边界与迁移阶段。  
8. 保证 Fast Path 的 Stage0～4、三处既有人审、3B、质量门禁、周迭代和「只要测点」模式不因拆分而改变。

### 1.2 非目标

- 自动把整份用例树或整篇 Confluence 灌进知识库。  
- 无人审自动把回流结果标为 `已确认`。  
- Stage4 读取 `domain_facts` 或知识库全文。  
- 用回流改写模块匹配规则；匹配由共享 `module_matcher` 提供，KB 只存模块分层与支持。  
- 本文交付可运行脚本（仅设计）。
- 替代 Stage4 的测试用例生成、质量门禁或工作区产物。  
- 将 Stage4 旧 `--kb` 工作区占位目录作为长期知识库；长期回流只能走本文统一管道。

### 1.3 Fast Path 保真清单（拆分不可破坏）

6.3 只增加两个薄接点：**C-MOD 后读取 KB**、**Stage4 最终确认后可选回流提示**。以下能力一律沿用 `skill.md`，不得在 KB 拆分中重写：

- Stage0 → Stage1/1CTX → 人审① → 1A → 人审①′ → Stage2（条件）→ C-MOD → KB 截取 → 3A → 3B → 人审② → Stage4；
- `unmatched_count===0`、`stage3_approved`、canonical/purity/quality gate 等既有门禁；
- Stage4 输入白名单：C-TP + merge_report + C-CTX；禁止读取长期 KB / `domain_facts`；
- `fast` / `full` / 仅测试点 / 技术文档 Stage2 / 周迭代子需求；
- XMind 仍是交付物，用户改动必须回写 C-TC 后重导，不能只改导图；
- `human_review` 临时事实优先于 `kb_applied` 的生成侧合并规则。

---

## 二、与 6.2 体系的合并点

### 2.1 不变（沿用 6.2）

| 项 | 约定 |
|----|------|
| 真源 | `{kb_root}` 下 Markdown：`模块矩阵总览` / `页面关系` / `主页面_*` / `子页面_*` |
| 状态 | `草稿` \| `待确认` \| `已确认` \| `已废弃`；召回仅 `已确认` |
| 准入 | 核心功能 \| 易被影响 \| 端差异大 |
| 拓扑 | 跳转只写 `页面关系.md` |
| 索引 | 本地重建；默认不入语义库 Git |
| 匹配规则 | 从生成侧现有实现抽为共享 `module_matcher`；KB 只存分层与支持 |

### 2.2 6.3 增量（挂在同一管道）

```text
任意合法触发
    → 解析来源（用例工作区 XMind / 本地 XMind / Confluence）
    → 读最新原文 + 结构化候选
    → 与现有 KB 对账（新增 / 更新 / 覆盖冲突 / 跳过）
    → ★ KB-概审：确认范围（含覆盖提醒）
    → 生成评审工作区 Markdown + 精确 diff（不改语义库）
    → ★ KB-内容审：按评审路径核对正文
    → 确认后原子写语义库 → validate → rebuild_index → 可选 Git push
```

即：6.2 的 `stage_kb_ingest` / `ingest_knowledge` 扩展为**多来源入口 + 概览协议 + 覆盖协议**；不新建平行入库系统。

---

## 三、统一触发模型

### 3.1 触发词（沿用并扩展载荷）

| 用户表达 | 行为 |
|----------|------|
| `补充知识库` / `补充知识点` / `更新知识库` | 进入 KB 入库 Skill（旁路，不进 Fast Path） |
| 同句含「生成用例」 | **先问**选哪条路径，禁止静默并行 |

载荷类型（可组合）：

| 载荷 | 说明 |
|------|------|
| 自然语言知识点 | 6.2 已有路径 |
| 本地 `.xmind` 路径 | 6.3：用例/导图回流 |
| Confluence URL（及可选子树范围） | 6.3：文档清洗 |
| 工作区默认用例 XMind | Stage4 回流提示确认后注入 |

### 3.2 Stage4 → 可选回流（与生成 Skill 的薄胶水）

```text
Stage4 产出用例 XMind
    ↓
用户确认用例（现有「无需修改 / 可以了」或等价）
    ↓
Agent 提示（不得默认执行）：
  「是否将本需求用例中的可复用知识补充到项目知识库？
   回复「补充知识库」或「跳过」。」
    ↓
用户确认补充
    ↓
以「补充知识库」命令进入 KB Skill
载荷 = 工作区内最终用例 XMind 绝对路径
（须重新读盘，见 §5.1）
```

硬规则：

- 未明确同意 → **不**进入入库。  
- 回流提示属于生成 Skill 的**可选尾钩**；真正解析/概览/写盘在 KB Skill。  
- 禁止把未确认的 Stage4 草稿 XMind 当回流源。
- 用户对用例说「无需修改 / 可以了」只表示**用例完成**，不等于同意入库；必须再次明确回复「补充知识库」。  
- 周迭代子需求：先完成当前子需求的可选回流询问，再执行既有「是否继续下一个子需求」提示；用户跳过回流不得阻断后续子需求。

### 3.3 直接补充（不经生成链路）

```text
补充知识库：
  - E:\...\测试用例_xxx.xmind
  或
  - https://confluence.../pages/viewpage.action?pageId=...
  或
  - 自然语言 + 可选附件路径
```

---

## 四、审核协议（范围概览 → 评审副本 → 内容确认 → 原子写入）

### 4.1 KB-概审：写入前「整体概览」（必须停）

目标：人只判断**范围与意图**对不对，不在此步审每格长文。

建议展示结构（Markdown / 对话即可）：

```text
【知识库补充概览】来源：{xmind路径 | confluence pageId | 自然语言}
指纹：{mtime/hash | confluence version} 读盘时间：{iso}

一、涉及模块
- 销售 / 销售
- 销售 / 单据分享小程序

二、模块 → 页面
- 销售/销售
  - 销售单开单页（更新）
  - 销售单列表页（无改动，略）

三、页面 → 元素（一句话改动）
- 销售单开单页
  - [新增] 商品列表.表头.设置 · Web：公用池可选列与自定义列上限说明
  - [更新] 已显示自定义表头 · App：仅已显示字段可填
  - [覆盖⚠] ……（见第四节）

四、覆盖 / 废弃提醒（重点）
- ⚠ 销售/销售 · 销售单开单页 · 「……」
  旧（已确认，2026-xx）：……
  新：……
  原因标签：规则变更 | 端行为变更 | 文档纠正 | …
  → 请明示：接受覆盖 / 保留旧 / 两边改写待确认

五、将跳过（不入库）
- 单条用例数据准备步骤 × N
- 无模块归属且无法推断的段落 × N（可进 _inbox 或待问）

请确认：范围是否 OK？回复「确认补充」或指出删改项。
```

概览字段最低要求：

| 维度 | 必须 |
|------|------|
| 一级/二级模块 | ✓ |
| 统一页面名称（带「页」） | ✓ |
| 元素名（若有） | ✓ |
| 操作类型 | `新增` / `更新` / `覆盖` / `废弃建议` / `跳过` |
| 一句话改动说明 | ✓（≤40 字建议） |
| 覆盖旧知识 | 单独成节，不可混在普通更新里 |

用户可要求：去掉某模块/某页/某元素；或把某条改为「仅留评审草稿」。  
**未收到「确认补充」→ 禁止生成评审副本；未收到「确认内容并写入」→ 禁止修改语义库。**

### 4.2 评审工作区（解决页面级状态粒度）

6.2 当前 Markdown 只有**页面级状态**。因此禁止把新待确认元素直接追加到一个 `已确认` 页面：否则新元素会被 `extract_kb` 一并召回；也禁止把整页降为 `待确认`，否则旧知识会全部停止召回。

KB-概审通过后，先在**评审工作区**生成候选 Markdown 与精确 diff：

```text
{work_dir}/kb_review/{overview_id}/
  ├─ review_manifest.json
  ├─ diff.patch
  └─ files/{相对 kb_root 路径}.md
```

- 评审工作区不是语义库，不参与索引、召回和 Git push；
- `review_manifest` 固定 `overview_id/source_fingerprint/base_commit/selected_changes`；
- 既有页面更新在候选副本中展示最终全文和 diff；不先改 `{kb_root}`；
- 新页面、页面关系、元素、补充说明均必须进入同一 ChangeSet。

### 4.3 KB-内容审：按路径核对正文（必须停）

生成评审文件后必须回传：

```text
【待写入 · 请打开内容审核】
- 销售/销售/页面关系.md
- 销售/销售/子页面_销售单开单页.md  （元素：商品列表.表头.设置）
…

请打开评审工作区中的上述文件或 diff；确认无误后回复
「确认内容并写入：<路径或全部>」。
```

收到内容确认后必须再次校验来源指纹与 `base_commit`：

1. 任一变化 → 中止并重新生成概览/评审文件；
2. 未变化 → 按 ChangeSet 原子修改 `{kb_root}`；
3. 已经经过两级明确审核的新增/更新内容可写为 `已确认`；
4. 用户只想暂存、不做内容审 → 保留在评审工作区，不进入语义库；
5. 写后运行 `validate_kb`、`rebuild_index`，再按配置 commit/push；
6. 回传最终相对路径、commit、校验结果。  

覆盖旧元素时允许在内容审通过后**原位更新**，Git diff/commit 作为修订记录；整页失效才将页面状态设为 `已废弃`。禁止在页面级模型下伪造“元素级已废弃”状态。

### 4.4 覆盖检测规则（P0）

对账时比较「同模块 + 同页面 + 同端 + 同元素/同关系边」的已确认陈述：

| 关系 | 概览呈现 | 默认行为 |
|------|----------|----------|
| 语义等价 / 子集 | 标「更新（加强）」或跳过 | 可合并 |
| 矛盾（预期相反、端有无相反、规则互斥） | **覆盖⚠** 专节 | 须人明示接受才写 |
| 旧已确认、新来源更可信但未矛盾 | 「更新」 | 进入评审副本；内容审通过后原子替换，Git 保留历史 |

禁止：用新候选静默覆盖 `已确认` 正文。

---

## 五、来源适配

### 5.1 用例 / 本地 XMind（读最新）

**目标：** 从思维导图提取可复用事实候选，不是把用例步骤全文入库。

#### 5.1.1 新鲜度硬规则

| 规则 | 说明 |
|------|------|
| 只认磁盘路径 | 用户给出或工作区解析出的 `.xmind` **绝对路径** |
| 写概览前强制 `stat` | 记录 `mtime` + 内容 hash（如 sha256 of file bytes） |
| 禁止缓存 | 不得使用：对话早期 Read 缓存、旧 `test_cases.json`、旧导出副本、Agent 记忆中的树摘要 代替现文件 |
| 不一致处理 | 若工作区同时存在 C-TC JSON 与 XMind：以 **XMind 文件** 为回流源；JSON 仅作辅助对照，并在概览注明「JSON 与 XMind 指纹不一致」 |
| 确认后复读 | 「确认内容并写入」之后、语义库 apply 前再 `stat`；mtime/hash 变化 → 中止并重新生成概览 |

#### 5.1.2 解析策略（设计级）

1. `.xmind` 按 zip 解包，读取内部 content JSON/XML（实现时锁定一种主版本）。  
2. 映射到中间结构：`module_l1/l2`、用例标题、前置、步骤、期望、标签（端/版本/产品）。  
3. **候选抽取**（宁缺毋滥）：  
   - 多条用例共享的业务约束 / 禁写预期  
   - 明确的页面跳转（起点-动作-终点）  
   - 端差异（Web/App/小程序行为不同）  
   - 模块支持线索（仅当标签与文案足够明确）  
4. **默认不抽：** 纯操作步骤复述、单次数据、环境账号、无通用性的断言。

#### 5.1.3 模块归属

- 优先用例节点上的模块标签 / 工作区 C-MOD / C-TP。  
- 缺失时调用独立 `module_matcher` Tool/CLI 推断；该工具是共享依赖，**不属于 testcase-generation 或 knowledge-base 任一 Skill**。  
- matcher 不可用时，KB Skill 必须退化为：读取 KB 模块分层做精确候选校验 → 无法唯一确定则询问用户或进 `_inbox`；禁止为“独立运行”复制一份关键词表。
- 若来源来自生成工作区，对账时同时读取其中 `domain_facts.json`；`human_review` 与候选冲突时列入「覆盖⚠」，默认不自动晋升长期知识。

### 5.2 Confluence 文档清洗

#### 5.2.1 拉取

- 复用 / 调用独立 `confluence-download` Skill（或等价下载脚本）拿到：**当前版本** Markdown + `pageId` + `version`。  
- 同一 `pageId+version` 已处理过且无强制重跑 → 可跳过或仅展示历史报告。
- KB ingest **只消费**下载结果中的 `pages/*.md` + metadata（pageId/version/父子路径）；不消费或复制 chunks、embeddings、下载侧 knowledge index。  
- 多页/子树必须把每页 `pageId+version+content_hash` 写进 source manifest；任一页在内容审前变化都要重新 prepare。  
- 需求 Fast Path 的 Confluence 下载优先级仍以 `skill.md` §4.2 为准，不能被 KB 清洗流程替代。

#### 5.2.2 模块可能缺失（重点）

Confluence 正文常不写「一级/二级模块」。处理顺序：

```text
1. 标题 / 标签 / 空间 / 父页面路径线索
2. 共享 `module_matcher` Tool/CLI → 候选模块列表（可多模块）
3. 按段落/表格/列表切块，每块独立归属模块
4. 一块可归属多模块时：同构复制候选，或拆成多条候选
5. 无法归属：进 知识库/_inbox.md 或概览「待问用户」，禁止猜一个最热门模块硬写
```

概览中必须展示「模块推断依据」（命中关键词 / 用户指定 / 待确认）。

#### 5.2.3 清洗纪律（同 6.2 准入）

不入库：需求背景、排期、原型坐标、DOM class、整页百科、无适用条件的空话。  
切块保留 `pageId + version + heading/anchor` 以便追溯。

### 5.3 自然语言（6.2 已有）

继续走推断草案 + ChangeSet + 两级审核；自然语言来源的概览可按页面级展示，但**范围概览与内容 diff 均不可省略**。

---

## 六、端到端流程（合并后唯一入库流）

```text
触发：补充知识库（含 Stage4 回流确认 / 本地 XMind / Confluence / 自然语言）
    ↓
[KB Skill] 解析 kb_root；可选 Git pull
    ↓
[KB Skill] 从来源读「最新」原文（XMind 复读盘；Confluence 拉当前 version）
    ↓
[KB Skill + 共享 matcher] 模块归属 / 分块 / 候选抽取
    ↓
[KB Core] 与现有 KB 对账 → 生成 ChangeSet +「补充概览」
    ↓
⛔ KB-概审：确认范围（含覆盖⚠）
    ↓
[KB Core] 生成评审工作区 Markdown + 精确 diff（语义库不变）
    ↓
⛔ KB-内容审：确认正文
    ↓
[KB Core] 复验 fingerprint/base_commit → 原子写 Markdown → validate → rebuild_index → 可选 push
    ↓
回传：最终路径 + 覆盖处理结果 + commit + 校验结果
```

报告产物（建议，落在临时目录或工作区 `script/`，**不**写入语义库仓）：

| 文件 | 用途 |
|------|------|
| `kb_ingest_overview.json` | 概览机器可读 |
| `kb_ingest_changeset.json` | 新增/更新/覆盖/废弃/关系变更/跳过；唯一写入计划 |
| `kb_ingest_diff.patch` | 内容审使用的精确 Markdown diff |
| `kb_ingest_report.json` | 写后路径、状态、git、指纹 |

上述产物必须有 JSON Schema。ChangeSet 最少包含：

```text
change_id, operation(add|update|deprecate|relation_change),
module_l1, module_l2, page_id, platform, target_ref,
before, after, conflict_kind, source_ref
```

`overview_id + source_fingerprint + base_commit + changeset_hash` 是 apply 的幂等键。现有 `ingest_knowledge.js` 的“同名元素跳过”不满足 update/cover 语义，6.3 实现必须替换为 ChangeSet 执行器或将其降为仅 `add` 的内部 helper。

---

## 七、独立 KB Skill 拆分设计

### 7.1 为什么拆

当前 KB 脚本与契约散落在用例生成工程内（`src/scripts/kb/*`、`src/stages/stage_kb_ingest.md`、`src/templates/知识库`），与 Fast Path 编排耦合在同一 `skill.md`。  
希望像 `skills/confluence-download`：可单独触发「补充/维护知识库」，生成用例 Skill 只保留消费侧薄接口。

### 7.2 目标目录（建议）

```text
testcase-generation-skills/
├── skill.md                          ← 用例生成：截取调用 + Stage4 回流提示
├── skills/
│   ├── confluence-download/          ← 已有
│   └── knowledge-base/               ← 新增独立 KB Skill（名称可定为 knowledge-base）
│       ├── SKILL.md                   ← 必须：独立发现、触发、阶段、谁干什么
│       ├── README.md
│       ├── demand/                   ← 可链到 src/demand/6.2+6.3 或副本索引
│       ├── steps/                    ← 分步说明（概览/写盘/覆盖/来源）
│       ├── scripts/                  ← 从 src/scripts/kb 迁入或包装
│       │   ├── ingest_from_text.js
│       │   ├── ingest_from_xmind.js
│       │   ├── ingest_from_confluence.js
│       │   ├── build_overview.js
│       │   ├── apply_ingest.js
│       │   ├── rebuild_index.js
│       │   ├── validate_kb.js
│       │   └── kb_git_sync.js
│       └── config/
│           └── kb_remote.json.example
└── src/
    ├── templates/知识库/             ← 过渡期仍可作默认 kb_root 样例
    └── scripts/kb/                   ← 过渡期保留 re-export，避免断链
```

> 语义库远程仓仓根仍是业务 Markdown 树；Skill 仓与语义仓分离（6.2 §7.8）。
> `main_orchestration.md` 可作为 `SKILL.md` 引用的内部说明，但不能替代 Skill 入口。M1 完成标准必须包含该目录与 `SKILL.md` 实际存在；在此之前 6.3 只能称为目标规格。

### 7.3 职责切分

| 能力 | 归属 | 说明 |
|------|------|------|
| 补充知识库触发、概览、写盘、覆盖、Git | **KB Skill** | 独立编排文档 |
| Confluence 原始下载 | **confluence-download** | KB Skill **调用**它，不复制下载实现 |
| 模块关键词匹配 | **共享 `module_matcher` Tool/CLI** | 两个 Skill 都只调用稳定契约；不可用时 KB Skill 询问用户 |
| C-MOD 后截取 → `domain_facts` | **用例生成 skill.md** | 调用 KB Skill 提供的 `extract` CLI（或共享脚本包） |
| Stage4 回流提示 | **用例生成 skill.md** | 仅提示；确认后 **转调** KB Skill |
| 知识库 Markdown 样例 | 过渡：`src/templates/知识库`；稳态：语义库 `kb_root` | Skill 内可带只读 fixture |

### 7.4 接口契约（Skill 间）

**用例生成 → KB Skill（截取消费）**

```text
node …/extract_kb.js
  --kb-root <path>
  --project-dir <WS>          # 读 C-CTX / C-MOD
  --out-facts <domain_facts>  # 合并写入
```

**用例生成 / 用户 → KB Skill（补充）**

```text
node …/run_ingest.js
  --kb-root <path>
  --source xmind|confluence|text
  --input <path|url|textfile>
  --phase overview|review|apply
  --overview-file <prev overview json>   # review/apply 必带
  --changeset-file <changeset json>      # review/apply 必带
  --review-manifest <manifest json>      # apply 必带
```

- `overview`：只生成范围概览与 ChangeSet；
- `review`：按已选范围生成评审 Markdown/diff，不改语义库；
- `apply`：要求 KB-内容审确认，复验 fingerprint/base_commit 后写语义库。

**KB Skill → confluence-download**

```text
仅拉取 Markdown + metadata；清洗与归属在 KB Skill
```

**KB Skill → module_matcher（只读、可选）**

```text
输入：标题/正文关键词
输出：候选 {l1,l2,confidence,reason,matcher_version}[]
禁止：在 KB 目录写匹配表
降级：工具不可用 → KB 分层精确匹配；不唯一则询问/进 _inbox
```

### 7.5 耦合点与解耦策略

| 当前耦合 | 风险 | 解耦办法 |
|----------|------|----------|
| `skill.md` 内嵌补充流程 | 生成与入库难独立演进 | 生成侧只保留触发行 +「转 knowledge-base Skill」 |
| `extract_kb` 写死在 `src/scripts` | KB 独立后路径漂移 | 抽 shared 包或 KB Skill 暴露稳定 CLI；生成侧改一行命令 |
| `kb_root` 默认指向 templates | 样例与生产混淆 | 配置 `kb_remote.local_path`；templates 仅 fixture |
| 模块名权威在 KB、匹配逻辑原在生成 | KB 反向依赖生成 Skill | **权威分层在 KB**；matcher 抽为共享 Tool；KB 可无 matcher 降级运行 |
| validate / matrix helper | 两边都要用 | 放入 KB Skill `scripts/lib`，生成侧依赖同路径或 npm 本地引用 |
| Stage4 回流要读 XMind | 解析器归属不清 | XMind 解析只在 KB Skill；生成侧只传路径 |

### 7.6 迁移阶段（建议）

| 阶段 | 动作 | 完成标准 |
|------|------|----------|
| M1 包内成型 | 建 `skills/knowledge-base/SKILL.md` + 包装现有 kb 脚本 | 不加载 testcase-generation Skill 也可完成自然语言 overview |
| M2 胶水变薄 | `skill.md` Stage4 尾钩 + extract 命令改指 KB Skill CLI | 生成链路回归绿；无双份业务逻辑 |
| M3 删除重复 | `src/scripts/kb` 改为薄委托或删除 | 文档与 npm scripts 指向新位置 |
| M4 语义库默认 | 默认 `kb_root` = 远程检出；templates 仅样例 | 与 6.2 Git 配置一致 |

回滚：保留生成侧旧命令别名一版；KB Skill 目录可整体禁用。

### 7.7 KB Skill 编排文档应写清的「谁干什么」

| 步骤 | 执行者 |
|------|--------|
| 触发分流、概览文案、覆盖问答、路径引导 | Agent |
| XMind 解包、Confluence 调用、对账、评审文件、validate、写盘、索引、Git | Script / KB Core |
| KB-概审、KB-内容审 | 用户 |

对齐 `confluence-download`：复杂判断给模型，稳定 IO 给脚本。

### 7.8 唯一落地路线：同一 KB Core，两种适配

本节消除“CLI、直连 Git、KB Service 三套业务逻辑”的歧义：

| 阶段 | 6.3 优先级 | 调用路径 | 唯一业务实现 |
|------|-----------|----------|--------------|
| **Phase A（本文 P0）** | 当前落地 | Skill → 本地 CLI adapter → KB Core → GitLab `main` | KB Core |
| **Phase B（P1）** | 多人写入后 | Skill → HTTP/MCP adapter → 内网 KB Service → 同一 KB Core → GitLab | KB Core |
| **Phase C（P2）** | 检索压力出现后 | Service → 可重建 DB/全文/向量投影 | 仍以 Git/KB Core 为准 |

硬规则：

- source adapter、CLI、HTTP/MCP 只做输入输出适配，不得各写一套覆盖/状态/校验逻辑；
- Phase A 服务不可用时使用本地 adapter 是**同一 KB Core 的切换**，不是绕过领域规则；
- Phase B 开启唯一 writer 后，写请求不得再 fallback 到本地直推；服务不可达只能失败或只读降级；
- `extract_kb` Phase A 继续使用现有 CLI 语义；Phase B `search_facts` 必须与其状态过滤、端切片、数量上限和 `domain_facts` 合并契约等价。

### 7.9 稳态参考：Skill 不是存储服务（Phase B，不是 6.3 P0）

独立出去后应区分三层，避免把 `skills/knowledge-base/` 本身误当成共享知识库：

```text
┌──────────────────────────────────────────────────────────┐
│ 消费 / 编排层                                             │
│ testcase-generation Skill │ knowledge-base Skill │ 其他 Agent │
└───────────────────────┬──────────────────────────────────┘
                        │ REST / MCP（稳定契约）
┌───────────────────────▼──────────────────────────────────┐
│ Knowledge Base Service（唯一领域服务）                    │
│ query / prepare_ingest / prepare_review / apply / history│
│ 权限、并发、状态机、覆盖检测、审计、版本                  │
└───────────────────────┬──────────────────────────────────┘
                        │ ports / adapters
┌───────────────────────▼──────────────────────────────────┐
│ 存储层                                                    │
│ Git Markdown（人审真源） + Serving DB（检索投影）         │
└──────────────────────────────────────────────────────────┘
```

职责：

| 层 | 负责 | 不负责 |
|----|------|--------|
| Skill | 理解用户意图、收集输入、组织概览、停在审核点、调用 adapter | 自己维护第二套知识数据、直接拼 SQL / Git |
| CLI / HTTP / MCP adapter | 参数、鉴权、传输、错误映射 | 重复实现覆盖与写盘规则 |
| KB Core | ChangeSet、状态机、幂等、覆盖检测、校验、Git 事务 | 用例生成 Prompt |
| KB Service（Phase B） | 托管 KB Core、权限、并发、审计 | 另写一套领域规则 |
| Git / DB | 持久化、查询投影 | Agent 编排 |

**结论：** `testcase-generation` 是最终消费端之一；Phase A 调 CLI adapter，Phase B 调服务 adapter。`knowledge-base Skill` 是同一 KB Core 的人机交互客户端，不是存储或第二套领域实现。

### 7.10 存储演进：Git 真源 + 可选数据库投影

> **资源约束下的落地顺序：** 当前服务器少、使用面小 → **先 Phase A（GitLab 真源 + 可选内网轻量服务）**；Serving DB / 完整 REST 网关放到人数或检索压力上升后再上。详见 §7.14。

#### 7.10.1 三种模式比较

| 模式 | 优点 | 局限 | 适用 |
|------|------|------|------|
| **仅 Git（本阶段默认）** | Markdown 易审、diff/版本/回滚天然、与 6.2 一致；只需 GitLab | 并发写与复杂检索弱；客户端需 clone/pull | **当前小范围推荐** |
| 仅数据库 | 多方 API 调用、权限/并发/查询强 | 人审 diff、离线查看、内容回滚需另建能力 | 高频在线编辑、大规模租户 |
| Git + DB 投影（稳态） | Git 保留审阅真源；DB 提供低延迟结构化/全文/向量检索 | 需同步与一致性机制 | 多人共享、检索变重后演进 |

#### 7.10.2 稳态参考

```text
写：prepare_ingest → KB-概审 → prepare_review → KB-内容审 → apply → commit
                                      ↓ commit webhook / outbox
                                 解析并更新 Serving DB

读：用例生成 / 其他客户端 → KB Service → Serving DB
                                      ↓ 返回事实 + source_ref + git_commit
```

- **Git Markdown = authoritative source（语义真源）**：保留 6.2 中文目录、页面文件和人工 diff。
- **Serving DB = 可重建投影**：建议 PostgreSQL 保存模块/页面/事实/状态/来源/commit；全文可用 PostgreSQL FTS 或 OpenSearch；向量索引是可选召回加速层，**不是**真源。
- 任何查询结果必须带 `source_ref`、`status`、`source_commit`，便于回到 Git 文件复核。
- DB 可从任意 Git commit 全量重建；投影失败不得反写或篡改 Git。
- 若未来以数据库为真源，必须先补齐等价的 review diff、版本快照、审计与 Markdown 导出，再迁移；6.3 不建议直接跳到 DB 真源。

#### 7.10.3 多方写入纪律

6.2 的「客户端直推 main」适合早期单写者；独立服务后应收敛为：

1. 客户端不持有 Git 写权限，只调用 KB Service。
2. KB Service 是唯一 writer；用 `overview_id + source_fingerprint + base_commit + changeset_hash` 做乐观锁。
3. apply 时若 Git HEAD 已变化，重新对账并要求再次确认覆盖项。
4. 个人/试点可继续直推 main；团队模式建议服务端分支/PR 或受保护 main + 服务账号。

### 7.11 对外能力契约：API + MCP（Phase B）

同一领域服务同时提供两种入口：

| 入口 | 面向 | 用途 |
|------|------|------|
| REST / SDK | CI、脚本、服务端应用 | 稳定、可测试的程序调用 |
| MCP Server | Cursor、Agent、第三方 AI 客户端 | 标准化发现资源与工具 |

建议最小能力：

```text
读：
  search_facts(context, modules, query, limit)
  get_module_support(module_l1, module_l2, platform, version)
  get_page_knowledge(module_l1, module_l2, page_id, platforms)
  get_change_history(kb_ref)

写（两级审核、一次语义库 apply）：
  prepare_ingest(source_type, source_ref, source_fingerprint)
    → overview_id + overview + changeset + conflicts + base_commit
  prepare_review(overview_id, selected_change_ids, changeset_hash)
    → review_id + review_paths + diff + review_manifest
  apply_ingest(review_id, content_confirmation, source_fingerprint, expected_commit)
    → changed_paths + commit + validation
```

MCP 暴露建议：

- `resources`：只读模块、页面、事实与历史；
- `tools`：`search_facts`、`prepare_ingest`、`prepare_review`、`apply_ingest`；
- `prompts`：可选的「补充知识库概览」交互模板。

所有写工具必须鉴权、幂等并保留审计；模型不得绕过 `prepare_ingest → KB-概审 → prepare_review → KB-内容审 → apply`。

### 7.12 Skill 层层调用原则

**不是一概优秀。** 应区分：

| 场景 | 建议 |
|------|------|
| 高层任务路由、专家分工、需要自然语言判断 | 可用 Orchestrator / Supervisor 调用子 Agent/Skill |
| 下载文件、解析 XMind、查询/写 KB、校验 schema | 用稳定 Tool / API / MCP，不要靠另一个 Skill 的自然语言输出 |
| 固定多步、强人审点、需可重试 | 用显式 Workflow / 状态机 |
| Skill A → Skill B → Skill C 递归委托 | 避免；上下文漂移、权限模糊、错误难追踪、版本耦合 |

本项目推荐：

```text
testcase-generation Skill（业务编排）
  ├─ Phase A 调 KB CLI adapter；Phase B 调 KB MCP/API
  └─ Stage4 末尾把最终 XMind path 交给 KB 写工作流

knowledge-base Skill（独立交互编排）
  ├─ 调用 XMind parser Tool
  ├─ 调用 Confluence source Tool / confluence-download adapter
  ├─ 调用 module matcher Tool
  └─ 调用 KB adapter（CLI 或 Service）
```

其中 `confluence-download` 最终更适合成为 **source adapter / tool provider**；KB Skill 可以编排它，但不要读取其内部 prompt、临时目录或脚本实现。这样其他用户既能单独调用 KB Skill，也能绕过 Skill 直接调用服务 API/MCP。

### 7.13 参考资料（非验收规格）

公开平台的共同模式是「Agent/Workflow 负责编排，Tool/API/MCP 提供稳定能力」，本文只采用这一结论，不把市场调研作为验收内容。参考：

- AgentScope Tool/MCP：<https://docs.agentscope.io/zh/v2/building-blocks/tool>
- Dify 工具插件：<https://docs.dify.ai/zh/develop-plugin/dev-guides-and-walkthroughs/tool-plugin>
- MCP 架构：<https://modelcontextprotocol.org/docs/learn/architecture>

### 7.14 资源约束落地：GitLab + 内网主机

面向：**有独立 GitLab 仓、无公网云主机、可用内网其他 PC/主机、使用人数少**。  
目标：先做到「独立存储 + 可多方调用」，不先上重型 DB/K8s。

#### 7.14.1 推荐拓扑（Phase A）

```text
开发机 Cursor / Skills
        │
        │ ① 日常：git pull/push 独立知识库仓（main）
        │ ② 可选：HTTP 调内网 KB 轻服务
        ▼
┌───────────────────────┐         ┌────────────────────────────┐
│ 本机 local_path 检出   │  sync   │ GitLab 独立仓（真源）        │
│ （工作副本）            │◄───────►│ branch = main               │
└───────────────────────┘         └────────────────────────────┘
        │                                      ▲
        │ 可选                                 │ 服务账号/固定凭据 pull+push
        ▼                                      │
┌───────────────────────┐                      │
│ 内网主机 B（轻量服务） │──────────────────────┘
│ - 常驻 clone 目录      │
│ - 提供 query/ingest API│
│ - 本地 SQLite 索引缓存 │  ← 可重建投影，非真源
└───────────────────────┘
```

| 组件 | 本阶段怎么用 | 说明 |
|------|--------------|------|
| GitLab 独立仓 | **唯一语义真源** | 仓根即知识库业务树；跟踪 `main`；直推即可 |
| 本机 `local_path` | Skills 默认读写副本 | pull → 改 → 确认 → push |
| 内网主机 | **可选** KB 轻服务 | 给多方统一查询/串行写盘；主机关机则退回「每机直接 Git」 |
| PostgreSQL/向量库 | **暂缓** | 用 Git + 本地/服务端 `知识库索引.json` 或 SQLite 即可 |

#### 7.14.2 GitLab 配置文件（先写好，由用户填链接）

配置加载顺序必须唯一，避免 KB Skill 反向依赖生成工程：

1. `%USERPROFILE%/.testcase-kb/kb_remote.json`（推荐运行时真源，多工程/独立 Skill 共用）；
2. `<workspace>/src/config/kb_remote.json`（6.2 迁移兼容，本机 gitignore）；
3. 未找到实配时视为 `enabled=false`；`.example` 只用于复制，不能自动当运行配置。

样例在迁移期保留 `src/config/kb_remote.json.example`，M1 后由 `skills/knowledge-base/config/kb_remote.json.example` 作为主样例，旧路径保留一版重定向说明。任何路径都禁止保存密码/Token。

Phase A 推荐字段：

```json
{
  "enabled": true,
  "repo_url": "https://gitlab.example.com/group/spark-knowledge-base.git",
  "branch": "main",
  "local_path": "E:/data/spark-knowledge-base",
  "auth": {
    "mode": "prompt_or_env",
    "preferred": ["env", "credential_helper", "prompt"],
    "username_env": "KB_GIT_USERNAME",
    "token_env": "KB_GIT_TOKEN",
    "ask_on_auth_failure": true,
    "store_prompted_secret": "session_only"
  },
  "pull": { "ff_only": true },
  "push": {
    "mode": "direct",
    "create_commit": true,
    "message_prefix": "kb:",
    "exclude_paths": ["知识库索引.json", "**/*.tmp", ".DS_Store"]
  },
  "service": {
    "mode": "optional",
    "base_url": "http://10.x.x.x:8787",
    "auth": {
      "mode": "optional_bearer_env",
      "token_env": "KB_SERVICE_TOKEN"
    },
    "timeout_ms": 15000,
    "fallback_to_local_git": true
  },
  "conflict_policy": "stop_and_report"
}
```

用户只需先填：

1. `repo_url` = GitLab 独立仓 HTTPS/SSH 地址  
2. `local_path` = 本机检出目录  
3. （可选）`service.base_url` = 内网 KB 服务地址  
4. 服务启用鉴权时，在环境变量 `KB_SERVICE_TOKEN` 填共享 Token；禁止写入 JSON。

#### 7.14.3 登录失败时如何问账号密码

认证优先级（`auth.preferred`）：

```text
1. 环境变量 KB_GIT_USERNAME + KB_GIT_TOKEN（或 Password）
2. 系统 Git Credential Manager / 已缓存凭据
3. 仍 401/403 → Agent 向用户索取（仅当 ask_on_auth_failure=true）
```

向用户索取时的纪律：

| 规则 | 约定 |
|------|------|
| 何时问 | clone/fetch/push 明确认证失败，或首次启用且无任何凭据 |
| 问什么 | GitLab **用户名** + **Personal Access Token（推荐）** 或密码；说明用途仅限本仓 pull/push |
| 存哪里 | **默认仅当前会话内存**（`store_prompted_secret=session_only`）；禁止写入 `kb_remote.json`、禁止提交 Git |
| 可选持久化 | 用户明确同意后，写入本机用户目录密钥文件（权限收紧）或交给 OS Credential Manager；仍不进仓库 |
| SSH 场景 | 优先引导配置 SSH key；不问密码明文塞进配置文件 |
| 失败文案 | 区分「网络不可达 / 无权限 / 账号错」；403 时提示检查 Token scope（至少 `read_repository` + `write_repository`） |

Skills 行为伪流程：

```text
读 kb_remote.json → enabled?
  → git ls-remote / fetch
  → 认证失败且 ask_on_auth_failure
      → 对话询问 username + token
      → 仅会话注入 git credential，重试一次
  → 仍失败 → 停止写盘，回报原因
```

#### 7.14.4 如何用内网其他主机当「KB Server」

不需要云服务器。任选一台**长期开机、同事可访问**的内网 Windows/Linux 主机即可。

**主机角色（最小）：**

| 项 | 建议 |
|----|------|
| 硬件 | 普通办公机或闲置主机；SSD 优先；内存 ≥ 8GB 即可起步 |
| 网络 | 固定内网 IP 或 DHCP 保留；开发机 `ping` / 浏览器可访问其端口 |
| 软件 | Node.js LTS（或后续选定的轻服务运行时）+ Git |
| 目录 | 如 `D:/kb-service/`：代码、`.env`、`data/repo`（GitLab clone）、`data/cache.sqlite` |
| 进程 | 用 NSSM / Windows 服务 / `pm2` / systemd 常驻一个 HTTP 进程（如 `:8787`） |
| 安全 | 仅内网监听（`0.0.0.0` 或内网网卡）；可选共享 Token；**不要**对公网暴露 |

**主机上跑什么（轻量，无 Postgres 也可）：**

```text
kb-service（内网主机）
  ├─ GET  /health
  ├─ POST /v1/query          ← 读：基于本地 clone + SQLite/索引
  ├─ POST /v1/prepare_ingest ← 写前概览
  ├─ POST /v1/prepare_review ← 生成评审 Markdown/diff，不改语义库
  ├─ POST /v1/apply_ingest   ← 内容审确认后写 Markdown → git push main
  └─ 后台：定时 git pull --ff-only；push 后重建本地索引
```

**同事开发机怎么连：**

1. 在 `kb_remote.json` 填 `service.base_url = http://<内网IP>:8787`。  
2. Phase A 下 Skills **优先调服务**；服务不可达且 `fallback_to_local_git=true` → 退回同一 KB Core 的本地 adapter（并提示「当前为本地适配模式」）。  
3. 有服务时：开发机可不持有 Git 写权限；由主机上的服务账号 Token 统一 push，降低每人配凭据成本。

当服务升级为 Phase B 唯一 writer 后，必须把 `fallback_to_local_git` 设为 `false`；写服务不可达时停止，禁止绕过锁与审计直推。

**内网主机开机检查清单：**

1. 安装 Git、Node；创建空目录并 `git clone` GitLab 知识库仓到 `data/repo`。  
2. 配置服务账号 Token（环境变量，不进 Git）。  
3. 启动 kb-service，确认本机 `curl http://127.0.0.1:8787/health` 成功。  
4. 从另一台开发机访问 `http://<主机IP>:8787/health`；若不通，检查防火墙入站规则（放行 8787）与是否同一网段/VPN。  
5. 在一名用户的 `kb_remote.json` 写入 `service.base_url` 做联调。

**何时还要上数据库：**

| 信号 | 动作 |
|------|------|
| 仅 1～3 人、偶发补充 | 保持 Phase A：GitLab + 可选轻服务 + SQLite/JSON 索引 |
| 多人同时写、冲突变多 | 服务端强制串行 apply + 乐观锁（仍可无 Postgres） |
| 检索慢、要跨模块全文/向量 | 再在内网主机加 PostgreSQL/FTS 或小型 OpenSearch，做投影而非换真源 |

#### 7.14.5 与「完整 KB Service」的对应关系

| 完整架构（§7.9） | Phase A 落点 |
|------------------|--------------|
| Git Markdown 真源 | GitLab `main` |
| Serving DB | 可省略；用索引 JSON / SQLite |
| KB Service | 内网主机轻进程（可选）；或暂无服务、Skills 直连 Git |
| REST/MCP | 轻服务先 REST；MCP 可后挂同一后端 |
| 客户端直推 main | 允许（小范围）；有内网服务后逐步改为仅服务写 |

#### 7.14.6 远程不可用：读降级 / 写停推（硬规则）

GitLab 或内网 KB Service 不可达时，**禁止**用 `module_mapping.md`、`project_context.md` 或其他 skills 模板顶替业务知识。三层本地职责必须分开：

| 本地路径 | 职责 | 远程挂了能否当业务知识 |
|----------|------|------------------------|
| `kb_remote.local_path`（Git 检出） | 运行时 `kb_root`；页面关系 / URL / 元素 / 接口真源副本 | **能**（首选离线源） |
| `src/templates/知识库/` | 技能仓样例 / fixture | 仅 `enabled=false` 或尚未配置 `local_path` 时作默认根；稳态不当生产真源 |
| `src/templates/stage3/module_mapping.md` | 关键词→模块**匹配规则** | **不能**；无页面/URL/API/元素口径 |

**读（生成用例 / extract）——尽量不中断：**

```text
Service 不可达（Phase A 且 fallback_to_local_git=true）
  → 同一 KB Core 切本地 adapter，读 local_path
  → 提示「当前为本地适配模式，知识可能不是最新」

GitLab 不可达，但 local_path 已有检出
  → 不强制 pull；继续用本地副本 extract
  → 同样提示可能落后

local_path 不存在或为空
  → extract 无命中，exit 0；Fast Path 继续（仅本次需求）
  → 禁止回退到 module_mapping / project_context 当业务知识
```

**写（补充知识库）——分步门禁：**

| 步骤 | 远端状态 | 行为 |
|------|----------|------|
| 写前 pull / 对账 | GitLab 不可达、非快进、工作区冲突 | **停止写盘**；禁止基于未知远程 HEAD 继续 apply |
| KB-概审 / 内容审 | 只需本机 `local_path` | **可继续**（评审工作区在本地） |
| apply 写本机 Markdown | 不依赖远端 | **可写本地** `kb_root` |
| push | 网络/权限失败 | 保留本地 commit，标记 `push_pending`；下次 resume；禁止 force / 空 commit 堆叠 |
| Phase B 唯一 writer | 写服务不可达 | **写失败停止**；禁止 `fallback_to_local_git` 直推绕过锁与审计 |

**匹配降级（不是取知识）：**

- `module_matcher` / `module_mapping` 本就在技能仓本地，远程挂了仍可用于模块归属。  
- matcher 不可用 → 用 `kb_root`「模块分层」精确校验；不唯一则询问或进 `_inbox`。  
- 匹配只回答「归哪个模块」，**不替代**页面 URL、元素接口、业务口径。

**本机常驻要求：**

1. 开发机应常驻 `local_path` 检出；日常先 pull，远端挂了仍可读已确认知识。  
2. 核心模块优先保证本地齐全；禁止把知识库正文再复制进 `module_mapping.md`（双真源必漂移）。  
3. 任何降级路径必须在报告中记录 `degrade_mode`：`service_local` / `git_offline_local` / `empty_kb` / `write_push_pending` / `write_stopped`。

---

## 八、风险与硬禁止

| 风险 | 缓解 |
|------|------|
| XMind 被人改过仍用旧 JSON | §5.1 指纹；确认后复读 |
| Confluence 无模块乱归销售 | §5.2.2；多模块或 inbox |
| 概览太粗导致错库 | 元素级一句话 + 覆盖专节；允许用户删行 |
| 未审内容污染召回 | KB-内容审前只写评审工作区，不改语义库 |
| 静默覆盖旧知识 | 覆盖⚠ 未明示则不写 |
| Skill 拆分双份逻辑 | 单一写盘实现；另一侧只委托 |
| 回流变成用例百科 | 沿用 6.2 三条件准入 + 「跳过」清单 |
| 远程挂了用匹配表顶替知识 | §7.14.6：只读 `local_path`；禁止 module_mapping 当业务真源 |
| 写前 pull 失败仍 apply | §7.14.6：写前失败即停；push 失败只 resume |

硬禁止：

- 未通过 KB-概审就生成评审内容；未通过 KB-内容审就修改语义库。  
- 全库遍历注入生成 Prompt。  
- 把用例步骤原文整页粘贴进元素表。  
- 在知识库写入匹配关键词表。  
- force 覆盖 Git / 用缓存 XMind。  
- Git/Service 不可用时用 `module_mapping` / `project_context` / skills 模板顶替页面、URL、接口或元素知识。  
- 写前 pull/对账失败仍 apply；Phase B 写服务失败后回退直推 Git。

---

## 九、实现工作包（设计级，供 outline6.3）

| 序 | 工作包 | 产出 | 优先级 |
|----|--------|------|--------|
| 1 | KB63-CONTRACT | ChangeSet / overview / review manifest / report schema；状态机 | P0 |
| 2 | KB63-CORE | 单一 KB Core：对账、覆盖、评审副本、原子 apply、validate/index/Git | P0 |
| 3 | KB63-XMIND | 最新读盘 + 解析 + 候选抽取（共享约束） | P0 |
| 4 | KB63-CF | Confluence Markdown+metadata adapter；分块 + 模块推断 | P0 |
| 5 | KB63-S4HOOK | skill.md Stage4 可选回流提示；周迭代顺序 | P0 |
| 6 | KB63-SPLIT | `skills/knowledge-base/SKILL.md`；CLI adapter；独立触发 | P0 |
| 7 | KB63-WIRE | 生成侧 extract/ingest 改委托；旧 stage/`--kb` thin redirect 或退役 | P1 |
| 8 | KB63-SERVICE | 内网 HTTP/MCP adapter；复用 KB Core；唯一 writer 模式 | P1 |
| 9 | KB63-PROJECTION | Git 真源 → PostgreSQL/全文/向量可重建投影 | P2 |
| 10 | KB63-METRICS | 采纳率/覆盖率/跳过率（可选） | P2 |

---

## 十、自检清单

- [ ] 回流与自然语言补充走同一管道与同一 `kb_root`  
- [ ] Stage4 仅提示，默认不入库；确认后触发「补充知识库」  
- [ ] 本地 XMind / Confluence URL 均可直接触发  
- [ ] 写前有模块/页面/元素/一句话概览；覆盖专节  
- [ ] 未「确认补充」不生成评审副本；未「确认内容并写入」不修改语义库  
- [ ] KB-概审后只生成评审工作区；KB-内容审前不修改语义库  
- [ ] 内容审给出具体相对路径与精确 diff；确认后才原子 apply  
- [ ] XMind 以文件 mtime/hash 为准，确认后复读  
- [ ] Confluence 模块可多候选或 inbox，禁止硬猜  
- [ ] 页面级状态模型下，无待确认元素混入已确认页面；两级审核通过后写已确认  
- [ ] `skills/knowledge-base/SKILL.md` 实际存在且可独立触发；生成 Skill 无第二套写盘逻辑  
- [ ] KB Skill 不依赖 testcase-generation Skill；module matcher 不可用时可降级询问  
- [ ] confluence-download 只负责拉页，不负责 KB 结构清洗  
- [ ] Phase A CLI/本地 adapter 与 Phase B 服务复用同一 KB Core  
- [ ] Git 是人审真源；Serving DB 可由 commit 重建且查询带 source_commit  
- [ ] Phase A 允许本地 adapter 直推；Phase B 唯一 writer 时禁止写 fallback  
- [ ] apply 使用 overview_id/fingerprint/base_commit/changeset_hash 乐观锁  
- [ ] 固定 IO 使用 Tool/API/MCP；Skill/Agent 嵌套只用于高层编排  
- [ ] 读降级只用 `local_path`（或 empty_kb 无命中继续）；禁止 module_mapping 顶替业务知识  
- [ ] 写前 pull/对账失败停止写盘；push 失败 `push_pending` + resume；降级模式写入报告  

---

## 十一、版本变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 6.3 | 2026-08-05 | 初稿：回流并入 6.2 补充管道；Stage4 可选提示；概览/覆盖/路径复审；XMind 新鲜度；Confluence 模块推断；独立 knowledge-base Skill 拆分设计 |
| 6.3 | 2026-08-05 | 架构补充：Git 真源 + DB 投影；独立 KB Service REST/MCP；Skill/Tool/Workflow 分层；国内平台公开资料对照 |
| 6.3 | 2026-08-05 | 评审收敛：两级审核改用评审工作区，解决页面级状态污染；新增 ChangeSet/KB Core；共享 matcher；Phase A/B/C 单一路线；Service 降 P1；补 Fast Path 保真与旧路径退役 |
| 6.3 | 2026-08-06 | §7.14.6：远程不可用时读降级/写停推；本地常驻 `local_path`；禁止用匹配模板顶替业务知识 |

---

## 附录 A — 与先前「用例→KB」探索稿

探索稿（Canvas / 会话设计）仅作素材；**以本文为准**并入 6.2 管道。差异点：明确 Stage4 触发话术、KB-概审/KB-内容审、覆盖专节、Skill 拆分路径。

## 附录 B — 术语

| 用语 | 含义 |
|------|------|
| 补充概览 | KB-概审使用的范围视图（模块/页/元素/一句话/覆盖） |
| 评审工作区 | 内容审使用的临时候选 Markdown/diff；不属于语义库、不召回、不 push |
| ChangeSet | 唯一机器写入计划；描述 add/update/deprecate/relation_change |
| 覆盖 | 新候选与已确认知识语义冲突，须明示处理 |
| 回流 | 从最终用例或外部文档进入长期 KB 的过程 |
| KB Skill | `skills/knowledge-base` 独立编排与脚本集合 |
| 薄胶水 | 生成 Skill 仅提示或调用 CLI，不含清洗写盘业务 |
| 本地适配模式 | Service 不可达时切本机 `local_path` 的同一 KB Core；只读可继续，写前 pull 失败仍停 |
| push_pending | 本地已 commit、远程 push 失败；下次 resume，禁止重复堆空 commit |
