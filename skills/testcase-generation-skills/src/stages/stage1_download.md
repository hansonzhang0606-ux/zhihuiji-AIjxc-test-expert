---
stage_id: stage1_download
version: "6.0"
execution_type: hybrid
fast_path: true
trigger: default
estimated_duration: "2-10min"
quality_gate: "input/需求文档/{requirement_title}.md 存在且文件名≠pageId"
inputs:
  - name: project_dir
    required: true
    description: "已由 Stage0 创建的工作区根 output/{title}/"
  - name: confluence_url
    required: false
    description: "在线下载时必填；本地 md 模式可缺"
  - name: local_md
    required: false
    description: "本地需求 markdown 路径；有则跳过 Confluence"
outputs:
  - path: "input/需求文档/{requirement_title}.md"
    contract: C-REQ-DOC
  - path: "script/stage1/download_manifest.json"
depends_on:
  - stage0_init
deprecated_predecessor: stage1.1_preprocess.md
---

# Stage1 需求下载与命名（Demand 6.0）

| 项 | 内容 |
|----|------|
| 依据 | `demand/testcase-generation-demand6.0.md` §4.2 步骤 1.1、§14.3 |
| 目录契约 | `contracts/workspace.md` |
| 脚本 | `scripts/stage1/stage1_download.js` |
| 适配 | `adapters/cursor.md` / `generic.md` |

> **落盘主键 = 需求文档 title（清洗后）。**  
> **禁止：** 以 `pageId` / 故事编号作为 `input/需求文档/` 下主文件名。

---

## 1. 阶段目标

把需求正文落到工作区：

```
{project_dir}/input/需求文档/{requirement_title}.md
```

供后续 **1A** 单次 LLM 读取。本阶段不做需求点合成、不写 XMind。

---

## 2. 两种入口

| 模式 | 触发 | 行为 |
|------|------|------|
| **A. 本地 md（S1-03）** | 用户已有 `.md`，或 fixture | `--local-file` 复制并按 title 命名；**跳过在线下载** |
| **B. Confluence（S1-02）** | 提供 URL + MCP | Agent 用 MCP 取正文 → `--local-file` / `--ingest-skill-output` 规范化落盘 |

优先顺序：已有合法 `{title}.md` → 本地文件 → Confluence。

抽象工具（映射见 adapters）：

- `file.read` / `file.write` / `file.list`
- `shell.exec`（跑 `stage1_download.js`）
- `confluence.get_page`（模式 B；无则降级模式 A）

---

## 3. 命名规则（验收核心）

| 规则 | 说明 |
|------|------|
| 目标名 | `{sanitizeTitle(requirement_title)}.md` |
| title 来源 | `session_info.requirement_title`，或 `--title`，或本地文件名/一级标题 |
| 清洗 | `scripts/lib/naming.js`（与工作区目录名同一套） |
| 禁止 | 仅数字的 `100655199.md`；`{title}_{pageId}.md` 作**最终**对外名（skill 中间产物可含 pageId，落盘前必须剥掉） |
| 中间产物 | skill 输出可进 `script/stage1/confluence_dl/`；最终只认 `input/需求文档/{title}.md` |

---

## 4. 执行步骤

| 步骤 | 执行 | 说明 |
|------|------|------|
| **1.1.0** | [Script] | 校验 `--project-dir` 为合法工作区（含 `input/需求文档`） |
| **1.1.1** | [Script] | 解析 `requirement_title`（session / CLI） |
| **1.1.2a** | [Script] | 若 `--local-file`：复制 → `input/需求文档/{title}.md` |
| **1.1.2b** | [Hybrid] | 若 `--confluence-url`：Agent 用 MCP 取正文；产物经 `--local-file` 或 `--ingest-skill-output` 规范化 |
| **1.1.3** | [Script] | `--normalize`：扫描 `input/需求文档/*.md`，把 `{title}_{pageId}.md` / 错名改成 `{title}.md` |
| **1.1.4** | [Script] | 写 `script/stage1/download_manifest.json`；质量门禁 |

轻量清洗（可选，不阻塞）：去掉明显 HTML 壳、统一换行；**不做** 1.2/1.3 语义分析。

---

## 5. CLI

工作目录：`testcase-generation-skills/src/scripts`

```bash
# 本地模式（推荐联调 / 无凭证）
node stage1/stage1_download.js --project-dir ../../output/<title> \
  --local-file /path/to/需求.md

# 仅规范化已有文件名（剥 pageId 后缀等）
node stage1/stage1_download.js --project-dir ../../output/<title> --normalize

# 从外部 pages 目录摄入（文件名常为 title_pageId.md）
node stage1/stage1_download.js --project-dir ../../output/<title> \
  --ingest-skill-output <pagesDir>

# Confluence：登记请求；Agent 用 MCP 取正文后再 --local-file
node stage1/stage1_download.js --project-dir ../../output/<title> \
  --confluence-url "https://…/viewpage.action?pageId=…"
```

Fixture 跳过下载：

```bash
# 直接使用 src/fixtures/客户来源调研弹窗/（已含 input/需求文档/*.md）
```

---

## 6. 产物

### 6.1 `input/需求文档/{title}.md`

需求正文（Markdown）。**唯一对外需求原文入口。**

### 6.2 `script/stage1/download_manifest.json`

```json
{
  "schema_version": "6.0",
  "requirement_title": "客户来源调研弹窗",
  "source": "local_file",
  "source_path": "...",
  "target_path": "input/需求文档/客户来源调研弹窗.md",
  "confluence_url": null,
  "page_id": null,
  "completed_at": "ISO-8601"
}
```

`source`：`local_file` | `normalize` | `skill_ingest` | `confluence_request`

---

## 7. 质量门禁

全部满足才可进入 1A：

1. [ ] `input/需求文档/{requirement_title}.md` 存在且非空  
2. [ ] 文件名清洗后等于 `session_info.requirement_title`（若有 session）  
3. [ ] 文件名不是纯 `pageId`（全数字）  
4. [ ] 工作区根仍仅 `input` / `output` / `script`

失败 → 非 0 退出。

---

## 8. 备注

| 项 | 说明 |
|----|------|
| 旧路径 `input/requirement/processed_document.md` | 废弃；勿再写入 |
| 在线正文 | 仅 MCP / 用户自备；无独立下载 skill |

---

## 9. 版本

| 版本 | 日期 | 说明 |
|------|------|------|
| 6.0 | 2026-07-21 | 首版：title 落盘；本地/Confluence 双模式；禁 pageId 主名 |
