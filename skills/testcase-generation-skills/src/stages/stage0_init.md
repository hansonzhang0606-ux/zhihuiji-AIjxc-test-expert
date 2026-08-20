---
stage_id: stage0_init
version: "6.0"
execution_type: hybrid
fast_path: true
trigger: default
estimated_duration: "5-15min"
quality_gate: "目录树合法 + session_info 含 requirement_title + path_mode 存在"
inputs:
  - name: requirement_title_or_url
    required: true
    description: "需求文档 title，或 Confluence URL（再解析 title）；禁止用故事编号建目录"
  - name: confluence_credentials
    required: false
    description: "本地 md 模式可缺；在线下载则需要"
  - name: output_dir
    required: false
    default: "testcase-generation-skills/output"
outputs:
  - path: "{output_dir}/{requirement_title}/"
    contract: C-WS
  - path: "script/config/session_info.json"
  - path: "script/config/progress_tracker.json"
  - path: "script/config/path_mode.json"
depends_on: []
deprecated_predecessor: stage0_unit.md
---

# Stage0 初始化（Demand 6.0）

| 项 | 内容 |
|----|------|
| 依据 | `demand/testcase-generation-demand6.0.md` §3 |
| 目录契约 | `contracts/workspace.md` |
| 脚本（实现见 S0-02～06） | `scripts/stage0/stage0_init.js` + `scripts/lib/workspace.js` |
| 适配 | `adapters/cursor.md` / `generic.md` |

> **主键：** 工作区唯一键 = **需求文档 title**（清洗后）。  
> **禁止：** 获取、生成、落盘、拼接任何故事编号 / 需求编号 / `story_id` 字段**作为工作区主键或目录/配置字段**。  
> **例外（v7.2.0 时间追踪）：** 会话缓存中的「用户故事编号+名称」（PRJ-xxxx）仅供时间追踪记录与 Stage5 `--prj` 使用，仅存对话上下文，**不落盘到工作区、不写入 `session_info.json`、不作目录名**，不违反本条禁令。

---

## 1. 阶段目标

建立对外极简、对内可重建的工作区；完成凭证与 **templates 只读校验**；校验当前模型 adapter。本阶段**不下载需求正文**（下载属 Stage1），不跑 LLM 合成。

---

## 2. 步骤（对齐 demand §3.2）

| 步骤 | 目的 | 执行 | 说明 |
|------|------|------|------|
| **0.1** | 确认需求文档 title | [LLM]/人工 | 来源：Confluence 页面 title，或本地文件名/一级标题；清洗后作目录名与 XMind 前缀 |
| **0.1b** | Confluence 凭证 | [Script]/人工 | 读 CLI / env / `.env`（`skills/knowledge-base/config/.env`、`src/config/.env`、`~/.testcase-kb/.env`）；无凭证 → 索取或改本地 md；本地 `--title` 跳过 |
| **0.1c** | 输出路径 | [Script] | 默认工程根 `output/`；标题有 `vX.Y.Z` 前缀 → `output/vX.Y.Z/{title}/`，否则 `output/{title}/` |
| **0.1d** | 并行凭证分发 | [Script] | 多需求时写入各工作区 `script/config/session_info.json` |
| **0.2** | 创建目录 | [Script] | §3.3：`input/` ∥ `output/` ∥ `script/`；版本目录由 `resolveWorkspaceRelPath` |
| **0.2b** | 周迭代拆分 | [Hybrid] | 标题含「周迭代」→ 见 `stage0_weekly_iteration.md`，勿整页当单需求 |
| **0.3** | Skills / adapters | [Script] | `skills/knowledge-base`（入库旁路）+ 当前 `src/adapters/*` |
| **0.4** | 校验 templates | [Script] | 只读 `src/templates/`（模块匹配规则 / 标签规则等）；**禁止复制**到 `output/` 工作区 |
| **0.5** | 生成配置 | [Script] | `session_info` / `progress_tracker` / `path_mode`（默认 `fast`） |
| **0.6** | 初始化校验 | [Script] | 失败阻断；可用 `workspace --assert-root` |

### 两种入口

| 模式 | 输入 | 行为 |
|------|------|------|
| **A. Confluence** | URL（+ 凭证） | 0.1 取页面 title → 建工作区；正文下载留给 S1 |
| **B. 本地 md** | `--title` 或已有 md 路径 | 直接按 title 建空工作区；用户稍后把 md 放入 `input/需求文档/` |

抽象工具（正文只写这些名，映射见 adapters）：

- `file.read` / `file.write` / `file.list`
- `shell.exec`（跑 `workspace.js` / `stage0_init.js`）
- `confluence.get_page`（模式 A；无则降级模式 B）
- `ui.ask_user`（缺凭证或 title 歧义时）

---

## 3. 工作区目录（demand §3.3）

```
{output_dir}/
├── v4.6.0/                         # 标题以 vX.Y.Z 开头时的版本目录
│   └── {requirement_title}/
│       ├── input/ …
│       ├── output/                 # 仅对外 *.xmind
│       └── script/ …
└── {requirement_title}/            # 标题无版本前缀时直接落在 output/
    └── input/ | output/ | script/
```

单工作区内：

```
{WS}/
├── input/
│   ├── 需求文档/          # 文件名 = title；禁止 pageId 作主名
│   ├── 技术文档/
│   └── 历史文档参考/
├── output/
└── script/
    ├── config/
    │   ├── session_info.json      # 含 requirement_title / version_folder / is_weekly_iteration
    │   ├── progress_tracker.json
    │   └── path_mode.json
    ├── stage1/ … stage4/
    └── …
```

> 模板只读 `src/templates/`，工作区**不再**建 `script/templates/`。  
> 周迭代拆分见 `stage0_weekly_iteration.md`。

**根下只允许** `input/`、`output/`、`script/` 三个顶栏目录。

创建命令：

```bash
cd src/scripts
node stage0/stage0_init.js --self-check
node stage0/stage0_init.js --title "<需求文档title>"
# → ../../output/v4.6.0/<title>/ 或 ../../output/<title>/
```

---

## 4. 命名与清洗（demand §3.5）

| 对象 | 规则 |
|------|------|
| 工作区文件夹 | `{requirement_title}` 清洗后 |
| `output` XMind | `需求点/测试点/测试用例/技术改动_{title}.xmind` |
| `input/需求文档` | 页面/文档 title；禁用 pageId 作主名 |

清洗：去掉 `\ / : * ? " < > |`，空白 → `_`，过长截断。实现：`scripts/lib/naming.js`。

---

## 5. 配置产物约定

### 5.1 `session_info.json`（最小字段）

```json
{
  "requirement_title": "客户来源调研弹窗",
  "created_at": "ISO-8601",
  "output_dir": ".../output",
  "workspace_root": ".../output/客户来源调研弹窗",
  "source": {
    "type": "confluence" | "local",
    "confluence_url": null,
    "confluence_page_id": null
  },
  "schema_version": "6.0"
}
```

**禁止字段：** `story_id`、`requirement_id`（作目录主键的业务编号）、任何「故事号前缀」。

### 5.2 `path_mode.json`

```json
{ "mode": "fast", "schema_version": "6.0", "flags": {} }
```

- `mode`：仅 `fast` | `full`；**默认 `fast`**
- CLI：`node stage0_init.js --title … --path-mode full` 可显式覆盖
- 未传 `--path-mode` 时：已有合法文件保留原 mode；缺失/非法则写 `fast`

### 5.3 `progress_tracker.json`

记录 Stage0 完成；后续人审锁由 S1/S3 写入。初始化示例：

```json
{
  "stage0_completed": true,
  "test_context_approved": false,
  "stage1_approved": false,
  "stage3_approved": false,
  "schema_version": "6.0"
}
```

> Demand 6.0.2：`test_context_approved` 由人审①（上下文）置位后才允许 1A；`stage1_approved` 由人审①′（需求点）置位。

---

## 6. 质量门禁（0.6）

全部满足才可进入 Stage1：

1. [ ] 工作区根仅 `input` / `output` / `script`
2. [ ] `input` 下三个中文子目录存在
3. [ ] `session_info.json.requirement_title` 非空且与目录名一致（清洗后）
4. [ ] `path_mode.json` 存在且 `mode` ∈ {fast, full}
5. [ ] `src/templates/` 含 模块匹配规则 / 标签规则（只读校验通过）  
6. [ ] 工作区**无** `script/templates/` 副本；文件中**不出现** `story_id` 作为配置主键

失败 → 非 0 退出，阻断后续 Stage。

---

## 7. 与旧文档 / 脚本

| 文件 | 状态 |
|------|------|
| `stages/stage0_unit.md` | **deprecated**；勿再作为编排依据 |
| `scripts/stage0/stage0_init.js` | S0-02～06：目录 / 凭证 / 模板只读 / `--self-check` / **path_mode（默认 fast，`--path-mode`）** |

编排入口只引用本文：`skill.md` → `stages/stage0_init.md`。

---

## 8. 版本

| 版本 | 日期 | 说明 |
|------|------|------|
| 6.0 | 2026-07-21 | 首版：对齐 demand6.0 §3；主键=title；删除故事编号相关约定 |
