# Knowledge Base Skill（Demand 6.3 / 6.4 + 业务规则回流）

| 项 | 内容 |
|----|------|
| 名称 | knowledge-base |
| 版本 | 0.2.0（业务规则回流门禁对齐） |
| 依据 | [`回流功能改造需求.md`](./回流功能改造需求.md) + Demand 6.2 / 6.3 / 6.4 |
| 状态 | 双通道回流：① 导航/技术引用（仅 P0）② 业务规则（P0/P1，排除非功能）；8 列核心元素表 + 完整性门禁已落地 |

## 0.2.0 变更（2026-08-07）

依据人审反馈沉淀的 [`回流功能改造需求.md`](./回流功能改造需求.md)，统一补充知识库 / 回流要求与门禁：

| 通道 | 用例范围 | 产出 kind |
|------|----------|-----------|
| **导航 / 技术引用** | 仅 **`[P0]`**（C-TC：`priority === "P0"`） | `page_relation` / `page_url` / `backend_api`（及导航衍生 page） |
| **业务规则** | 仅 **P0/P1**；禁止 P2/P3；禁止非功能 | `page` / `page_element` / `supplement` |

硬规则摘要见下文「回流门禁」；实现要点见改造需求 §九。

## 触发

用户明确说「补充知识库」「补充知识点」「更新知识库」时进入本 Skill。  
同句同时要求生成用例 → **先问**选哪条路径，禁止静默并行。

## 本 Skill 负责

- 多来源候选（自然语言 / XMind / 最终 C-TC / Confluence）→ ChangeSet
- KB-概审 → 评审工作区 → KB-内容审 → 原子写 `kb_root`
- 校验、索引重建、可选 Git pull/push
- 暴露 extract CLI 供用例生成消费已确认知识

## 本 Skill 不负责

- Fast Path Stage0～4 / 质量门禁
- Confluence 页面下载（由用例侧自备 md 或 MCP 完成）
- 把 `模块匹配规则.md` 当业务知识真源

---

## 回流要求（Agent / 审核须遵守）

### A. 知识抽取（用例 XMind → 候选）

1. **导航/技术引用**：只吃 P0；结构化 `technical_refs` 与导航步骤独立解析，禁止用普通步骤猜 API 绑定。
2. **业务规则**：只吃 P0/P1；性能 / 集成 / 兼容 / 稳定性 / 并发 / 网络异常等非功能用例（含「非功能」模块分支）一律排除。
3. **规则一句话**：补充说明取清洗后的用例标题（去掉 `[Px]`、`APP-`/`云店-`/`场景X：` 等前缀），**禁止**拼接「操作+预期」长文。
4. **页面名**：动词锚定（进入/打开/跳转到/在…页）优先，句尾匹配次之；过滤翻页/页签/分页等噪声。

### B. 模块与页面归置

1. **主页面** = 二级模块入口页；用例涉及的**子功能页**一律 **子页面**（业务规则通道默认 `page_role=子页面`）。
2. 标题以「云店-」开头 → 模块 **云店/选购**，页面统一 **云店搜索结果页**（子页面）。

### C. 核心元素表（写盘 Schema）

表头固定 **8 列**：

`元素 | 位置 | 输入/选项 | 展示内容 | 交互 | 交互结果 | 后端接口 | 下游影响说明`

- **展示内容**：结果输出元素说明「展示什么」；输入类元素填 `-`。
- **位置**：一句话或「父容器 > 子元素」；禁止留空（未知用 `-`）。
- **空字段一律 `-`**；禁止「待补充（历史）」等占位（新写入路径）。
- **接口只注方法+路径**，不写参数/断言/请求体。
- 行序：顶→底、左→右；子元素紧跟所属主元素。

### D. 补充说明

- 仅来自 P0/P1 一句话规则。
- 以 `### 元素名` 分组；多元素规则归属「最终展示结果」元素；无归属进 `### 通用规则`。
- 子标题顺序 = 核心元素视觉顺序；子标题与列表项之间**无空行**。

---

## 回流门禁（Script 强制）

| 级别 | 字段 / 条件 | 行为 |
|------|-------------|------|
| **阻塞** | 元素 `name` / `interaction` / `result` | `blocking_gaps` → 只允许 overview，禁止 review/apply |
| **阻塞** | `page_url` 变更缺 URL；关系三元组缺边 | 同上 |
| **阻塞** | 页面登记缺 `page_id` / `role` / `support` | 同上 |
| **建议** | 元素缺 `backend_api` / `position` / `input_options` | `warning_gaps`，**不阻断** |
| **建议** | 业务规则 `page` 登记缺 Web URL | `warning_gaps`，**不阻断**（URL 由技术引用通道补） |
| **硬拦** | apply 无 `--confirm-content`；`target_ref` 逃逸 `kb_root` | 停止写盘 |
| **硬拦** | C-TC 无 finalized `final_artifact.json`（正式回流） | 停止 / 仅显式兼容 overview |

`completeness_report.blocked_write === (blocking_gaps.length > 0)`。  
内容审前 **不得**改语义库；不猜 URL/API；不写 Token/Cookie/真实业务 ID。

---

## 最小命令（scripts/）

工作目录建议：`skills/knowledge-base/scripts` 或通过根 `src/scripts` npm 包装。

```bash
# 契约 / 来源自测
node self_test_contracts.js
node self_test_sources.js
node self_test_core.js

# 入库（Phase：overview | review | apply）
node run_ingest.js --kb-root <path> --source text|xmind|ctc|confluence --input <file|pagesDir> --phase overview --out-dir <dir>
node run_ingest.js --phase review --kb-root <path> --overview-file <overview.json> --changeset-file <cs.json>
node run_ingest.js --phase apply --kb-root <path> --review-manifest <manifest.json> --confirm-content

# 批量补列（先 dry-run）
node migrate_kb_63.js --kb-root <path> --dry-run

# 截取（供生成侧）
node run_extract.js --project-dir <WS> [--kb-root <path>]
```

## 配置加载顺序

1. `%USERPROFILE%/.testcase-kb/kb_remote.json`
2. 工作区 `src/config/kb_remote.json`
3. 未找到 → `enabled=false`；example 不当实配

### 凭据 .env（Git + Confluence）

**可以**用 `.env` 存账号/Token，**不要**写进 `kb_remote.json`。  
样例：[`config/.env.example`](./config/.env.example)（可提交）；真实 `.env` **禁止** `git add`。

推荐（仓库外，最安全）：

```text
%USERPROFILE%\.testcase-kb\.env
```

也可：`skills/knowledge-base/config/.env` 或 `src/config/.env`（均已 gitignore）。  
Stage0 与 KB 脚本共用 `load_dotenv`（合并加载，后者只补空缺）。

```env
# GitLab（知识库）
KB_GIT_USERNAME=你的GitLab用户名
KB_GIT_TOKEN=你的Personal_Access_Token

# Confluence（下载需求页；Stage0 0.1b 会读）
CONFLUENCE_BASE_URL=https://finkms.kingdee.com
CONFLUENCE_USERNAME=你的Confluence账号
CONFLUENCE_API_TOKEN=你的Token或密码
```

优先用 Token；聊天里不要粘贴完整 Token。

## 远程不可用（硬规则摘要）

- **读**：Service/Git 挂了 → 用本机 `local_path`；空库则无命中继续生成；**禁止**用 `模块匹配规则` 顶替知识。
- **写**：写前 pull/对账失败 → 停止；push 失败 → `push_pending` + resume。
- 报告必须带 `degrade_mode`。

## 谁干什么

| 步骤 | 执行者 |
|------|--------|
| 触发分流、概览文案、覆盖问答、路径引导 | Agent |
| 解析、对账、评审文件、validate、写盘、索引、Git | Script / KB Core |
| KB-概审、KB-内容审 | 用户 |

## 验收基线（改造需求 §八）

- 销售/销售 · 销售开单商品选择页（子页面）：核心元素按视觉序 + 按元素分组补充说明
- 云店/选购 · 云店搜索结果页（子页面）：同上
- 0 阻塞缺口；空字段全部 `-`；补充说明无空行、子标题顺序正确；`页面关系.md` 与元素文件 `页面角色` 一致
