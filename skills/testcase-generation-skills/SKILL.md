# 测试用例自动生成 — 主流程编排（skill.md）

| 项 | 内容 |
|----|------|
| 文件 | **`skill.md`**（Agent 编排入口） |
| 版本 | **7.2.0** |
| 编排 | 本文 + [`src/stages/`](./src/stages/)（阶段细则唯一扩展） |
| 冷启动 | [`bootstrap.md`](./bootstrap.md) |
| 适配 | `src/adapters/cursor.md`（默认）/ `generic.md` |
| 脚本根 | `testcase-generation-skills/src/scripts/` |
| 模板 | `src/templates/`（见 [`templates/README.md`](./src/templates/README.md)） |
| 时间追踪 | `src/scripts/time-tracking/`（嵌入版，规则见 [`prompts/time_tracking.md`](./src/scripts/time-tracking/prompts/time_tracking.md)） |

> **本文只编排**：读哪个 stage、跑哪条命令、卡哪个人审。  
> **硬规则细节** → 对应 `src/stages/*.md`（**禁止**读 `src/docs/`）。  
> **调用：** 对话中请 Agent「严格按 `testcase-generation-skills/skill.md` 执行」。

### 谁干什么

| 步骤 | 执行者 |
|------|--------|
| Stage0 / 下载落盘 / 1CTX / 模块归属 / 定稿校验 / 导出 / Stage4 / Stage5 导出 | **Script** |
| 需求点提取（1A）/ 测试点合成（3A） | **LLM** |
| 人审① / ①′ / ② / 用例预览改 | **用户**（Agent 必须停下） |

---

## 〇、会话启动（每次新会话第一步，先于一切业务流程）

按 [`time_tracking.md`](./src/scripts/time-tracking/prompts/time_tracking.md) §一 执行，顺序固定：

1. **MySQL 初始化检查**：扫描 `~/.workbuddy/data/time-tracking/*/mysql_config.json`；缺失 → 自动运行
   `python src/scripts/time-tracking/scripts/init_mysql_config.py --biz-line "AI进销存" --template --no-interactive --quiet`
   生成全空模板 + `mysql_config.notes.md`，提示用户本地填写后回复「已填好」（**不在对话索要密码**）
2. **身份识别**：`python src/scripts/time-tracking/scripts/load_roster.py --json`（实时查 MySQL `agent_team_roster`，
   禁止读本地 yaml 匹配）→ 盲输入姓名精确匹配 → 多业务线者按编号选择 → 缓存姓名+业务线；失败拒绝服务
3. **用户故事收集**（用户触发用例生成时）：询问「用户故事编号+名称」（如 `PRJ-00758363 优化分类下搜索商品逻辑`），
   仅存会话缓存（不作工作区主键、不写入 `session_info.json`），并作为 Stage5 `--prj` 默认值；
   周迭代每个子需求 = 独立故事，切换时更新缓存

> 未完成 1～2 不得开始 Fast Path；用户暂未填好 MySQL 配置不阻塞（数据先存本地 JSONL）。

---

## 一、触发与路径

| 用户表达 | 行为 |
|----------|------|
| 生成用例 / Confluence 链接 + 测试语义 | Fast Path（本文） |
| 只要测试点 | 跑到人审②后停，跳过 Stage4 |
| `补充知识库` / `补充知识点` / `更新知识库` | [`stage_kb_ingest.md`](./src/stages/stage_kb_ingest.md) → [`skills/knowledge-base/SKILL.md`](./skills/knowledge-base/SKILL.md) |

同句要求生成用例与补充知识库 → **先问**选哪条，禁止静默并行。

```bash
node stage0/stage0_init.js --title "<需求文档title>" [--path-mode fast|full]
# 或 --confluence-url + --confluence-metadata
```

---

## 二、工作区约定

| 约定 | 值 |
|------|-----|
| 产物根 | `output/`；标题有 `vX.Y.Z` → `output/vX.Y.Z/{title}/` |
| 工作区内 | 仅 `input/` ∥ `output/` ∥ `script/` |
| 需求原文 | `input/需求文档/{title}.md` |
| 中间 JSON | `script/` |
| 对外 XMind | `output/*.xmind` |
| 模板 | **只读** `src/templates/` |
| 主键 | 需求文档 title（禁止 pageId 主名） |
| 周迭代 | 见 `stage0_weekly_iteration.md` |

下文 `{WS}` = 工作区路径（相对 `src/scripts` 如 `../../output/...`）。

---

## 三、Fast Path 序列

```
Stage0 初始化
  → Stage1 下载          stage1_download.md
  → Stage1 1CTX          stage1_context.md
  → ⛔ 人审①             stage1_context_checkpoint.md
  → ⏱ 时间追踪 01 文档整理
  → Stage1A（LLM）       stage1a_requirement_synthesis.md
  → ⛔ 人审①′            stage1_checkpoint.md
  → ⏱ 时间追踪 02 需求评审
  → [可选 Stage2]
  → Stage3 模块归属      stage3_module.md
  → KB extract           extract_kb.js
  → Stage3A（LLM）       stage3a_testpoint_synthesis.md
  → Stage3B              stage3b_matrix_tag_filter.md
  → ⛔ 人审②             stage3_checkpoint.md
  → ⏱ 时间追踪 04 生成测试点
  → Stage4               stage4_test_case_generation.md
  → ⏱ 时间追踪 06 用例细化（「可以了」后）
  → （可选）Stage5       stage5_platform_import.md
  → ⏱ 时间追踪 07 知识入库（平台导入完成后）
  → （可选）用例预览改
```

三处 ⛔ **必须停等用户明确回复**，禁止超时默认「无需修改」。
⏱ 各环节 approve/交付后**强制收集**节省时间反馈（强制询问→解析→二次确认→写本地 JSONL），
规则与话术见 [`time_tracking.md`](./src/scripts/time-tracking/prompts/time_tracking.md) §四；跳过的环节不追踪。

---

## 四、Stage0～1（至人审①′）

工作目录：`src/scripts`。

### 4.1 Stage0

```bash
node stage0/stage0_init.js --confluence-url "<URL>" --confluence-metadata "<json>"
# 或：node stage0/stage0_init.js --title "<title>"
```

title 含「周迭代」→ `stage0_weekly_iteration.md`，勿整页当单需求。

### 4.2 下载

优先：MCP 取正文 → `--local-file`；或用户自备 md；或 `--ingest-skill-output <pagesDir>`。

```bash
node stage1/stage1_download.js --project-dir {WS} --local-file <md>
# 或 --normalize / --confluence-url（仅登记请求）
```

验收：`{WS}/input/需求文档/{title}.md` 非空且非 pageId 主名。

### 4.3 1CTX + 人审①

```bash
node stage1/stage1_context.js --project-dir {WS}
# ⛔ 展示产品/版本/端 + 回归 skip；用户确认后：
node stage1/stage1_context.js --project-dir {WS} --approve
node stage1/validate_rp.js --project-dir {WS} --gate-only
# ⏱ approve 后立即收集 时间追踪 01 文档整理（time_tracking.md §四）
```

### 4.4 1A（LLM，不可跳过）

读 `stage1a_requirement_synthesis.md`。

```bash
node stage1/filter_requirement_doc.js --project-dir {WS}
# Read requirement_filtered.md + test_context（+ 可选 domain_facts）
# 按需 Read templates/需求文档过滤规则.md、隐式需求惯例.md
# Write requirement_points.draft.json
node stage1/stage1a_finalize.js --project-dir {WS} \
  --from-draft {WS}/script/stage1/requirement_points.draft.json --export
```

禁止复用 fixture/旧 draft 冒充本轮分析；禁止再读未过滤原文。

### 4.5 人审①′

读 `stage1_checkpoint.md`。**先声明 XMind 只读**；N≤20 列举改动，N>20 下发清单模板。  
用户「无需修改」→ `--approve`。  
⏱ approve 后立即收集 **时间追踪 02 需求评审**。

---

## 五、Stage3～4

### 5.0 门禁

```bash
node stage3/validate_tp.js --project-dir {WS} --gate-only   # 需 stage1_approved
```

### 5.1 模块归属

```bash
node stage3/stage3_module.js --project-dir {WS}
```

规则：`templates/模块匹配规则.md` + `module_keyword_mapping.js`。未匹配写入 `unmatched[]`，**禁止臆造模块**。

### 5.2 KB 截取（3A 前）

```bash
node kb/extract_kb.js --project-dir {WS}
```

仅已确认知识 → `domain_facts.json`；无命中不阻断；禁止全文通读知识库。

### 5.3 3A（LLM）

读 `stage3a_testpoint_synthesis.md` + C-RP/C-MOD/C-CTX + domain_facts。  
按需 `优先级规则.md` / `标签规则.md`。模块名必须来自 C-MOD。

```bash
node stage3/stage3a_finalize.js --project-dir {WS} \
  --from-draft {WS}/script/stage3/test_points.draft.json
```

### 5.4 3B

```bash
node stage3/stage3b_matrix_tag_filter.js --project-dir {WS} --export
```

矩阵：`templates/模块矩阵知识库/模块矩阵总览.md`。

### 5.5 人审②

读 `stage3_checkpoint.md`。XMind 只读；须 `unmatched_count===0` 才可 approve。  
⏱ approve 后立即收集 **时间追踪 04 生成测试点**。

### 5.6 Stage4

**仅读**已批准 C-TP；**禁止**读 domain_facts / 知识库 Markdown。

```bash
node stage4/stage4_execute.js --project-dir {WS}
node lib/validate.js --type test_cases --file {WS}/script/stage4/test_cases.json
```

预览改：XMind 只读；改 JSON → validate → 重导。「可以了」结束。  
⏱ 用户「可以了」后立即收集 **时间追踪 06 用例细化**，再进行后续询问。  
**可以了 ≠ 入库** → 另问是否「补充知识库」。周迭代：先问回流，再问下一子需求（切换子需求须更新用户故事缓存）。

### 5.7 Stage5（可选）

Stage4「可以了」后 **询问**是否导入 DevOps 平台。读 [`stage5_platform_import.md`](./src/stages/stage5_platform_import.md)。

```bash
node stage5/export_platform_p0_excel.js --project-dir {WS}
# PRJ 未知：--prj PRJ-xxxxxxx 或写 {WS}/script/config/platform_import.json
# 默认用会话缓存的用户故事编号（§〇 第 3 步）
```

产出：`output/测试用例_P0_{title}.xlsx` → DevOps 用例管理 **手工导入**（添加新数据）。默认仅 **P0**。  
⏱ Stage5 平台导入（P0 Excel → DevOps）完成后收集 **时间追踪 07 知识入库**：交付 Excel 与导入步骤后，询问用户「DevOps 导入是否完成？」，确认完成后收集；用户表示不再导入 → 交付 Excel 时即收集。

---

## 六、人审话术骨架

| 关卡 | Agent 必做 |
|------|------------|
| ① | 展示三维 + 回归 skip；问是否准确；确认后 `--approve` |
| ①′ / ② / 用例预览 | **先声明 XMind 只读**；小清单列举 / 大清单模板；可迭代；明确「无需修改/可以了」才过关 |
| 共通 | 禁止超时自动批准；改动只认对话→JSON，不认手改 XMind |

细则见各 `*_checkpoint.md` / `stage4_test_case_generation.md`。

---

## 七、断点与失败（精简）

| 场景 | 处理 |
|------|------|
| 无 test_context_approved | 阻断 1A |
| 无 stage1_approved | 阻断 Stage3 |
| 无 stage3_approved / 有 unmatched | 阻断 Stage4 |
| finalize/schema 失败 | 改 draft 重跑，禁止空文件 |
| mapping 版本告警 | 同步 `模块匹配规则.md` ↔ `module_keyword_mapping.js` |
| Confluence/MCP 失败 | 请用户 `--local-file`，仍须跑 LLM 1A |
| Stage4 质量不达标 | 读 quality_report；回退改 C-TP |

重跑 1CTX / 1A finalize / 3.3·3A 会清除对应 `*_approved`。

---

## 八、Agent 执行清单

1. [ ] 会话启动：MySQL 检查 → 身份识别（查 MySQL 花名册）→ 缓存员工+业务线（§〇）
2. [ ] Fast Path 触发时收集用户故事编号+名称并缓存
3. [ ] 读本 `skill.md` + 当前 stage md  
4. [ ] Stage0 → 下载 md → 1CTX  
5. [ ] **停**人审① → approve → ⏱ 追踪 01 → gate  
6. [ ] LLM 1A → finalize --export  
7. [ ] **停**人审①′ → approve → ⏱ 追踪 02  
8. [ ] stage3_module → extract_kb → LLM 3A → 3B --export  
9. [ ] **停**人审② → approve（unmatched=0）→ ⏱ 追踪 04  
10. [ ] Stage4 → 预览 → ⏱ 追踪 06 → 问是否补充知识库；**问是否 Stage5 导入平台**  
11. [ ] Stage5 导入完成 → ⏱ 追踪 07  
12. [ ] 禁止 fixture 冒充本轮；禁止 Stage4 读 domain_facts；追踪必经「询问→二次确认」后写本地 JSONL  

冒烟：`npm run stage0:self-check` / `stage3a:self-test` / `kb64:e2e:self-test`（在 `src/scripts`）。

---

## 九、目录

```
testcase-generation-skills/
├── skill.md / bootstrap.md / README.md
├── output/{title|vX.Y.Z/title}/
├── skills/knowledge-base/
└── src/
    ├── stages/ contracts/ scripts/ adapters/ fixtures/
    ├── scripts/time-tracking/   ← 时间追踪（嵌入版：scripts + config + prompts）
    └── templates/          ← 经验规则 + 模块矩阵知识库/
```

（`src/docs/` 为历史留档，运行时勿读。）

---

## 十、版本

| 版本 | 说明 |
|------|------|
| 7.0.0 | 精简编排：CURRENT 唯一规格；去 confluence-download；templates 扁平化；≤400 行 |
| 7.1.0 | Stage5：P0 Excel → DevOps 导入；`docs/` 仅留档、禁止运行时引用 |
| 7.2.0 | 嵌入时间追踪：会话启动 MySQL 检查+身份识别+用户故事收集；5 环节（01/02/04/06/07）强制反馈节省时间，本地 JSONL → 定时任务同步 MySQL |

> 注：v7.2.0 内嵌 time-tracking 已于 2026-08-20 更新至 **v5.4**（「立即触发+阻塞下一步」强化——产出交付后必须先完成时间收集、确认记录完成后才允许展示下一步选项），5 个 checkpoint/stage 与 agent.md 第 6 条已同步该强化。
