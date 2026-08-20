# KB 入库旁路（Demand 6.3 / 6.4 + 业务规则回流）

> 本文件为 **redirect**：领域实现与 CLI 已迁至 `skills/knowledge-base/`。  
> 禁止在本文件维护第二套「一次确认直接写库」流程。  
> 门禁与字段规范以 [`skills/knowledge-base/SKILL.md`](../../skills/knowledge-base/SKILL.md) 与 [`回流功能改造需求.md`](../../skills/knowledge-base/回流功能改造需求.md) 为准。

## 触发与分流

- 仅用户明确说「补充知识库」「补充知识点」「更新知识库」时进入。
- 同句同时要求生成用例 → **先问**选哪条路径，禁止静默并行。
- **不创建**需求工作区 `output/{title}/`；业务知识只写运行时 `kb_root`。
- Agent 入口：读取并遵循 [`skills/knowledge-base/SKILL.md`](../../skills/knowledge-base/SKILL.md)。

## 标准流程（两级审核）

```text
解析 kb_root / 配置（用户目录 > src/config/kb_remote.json）
  → 来源适配 text | xmind | ctc | confluence → KbCandidateBundle
  → 双通道解析：
       · 导航/技术引用：仅 P0
       · 业务规则：P0/P1（排除非功能）→ page / page_element / supplement
  → ChangeSet + completeness_report（blocking/warning）
  → overview（blocked_write 时可展示缺口，不得进入 review）← KB-概审
  → 用户确认补充范围（selected change_ids）
  → 生成评审工作区 kb_review/{overview_id}/（不在 kb_root）
  → 用户 KB-内容审：「确认内容并写入」
  → apply 前重算完整性 → 原子写 → validate → rebuild_index
  → enabled 时 Git commit/push；失败 push_pending + resume
  → 回传 kb_ingest_report（含 degrade_mode）
```

## CLI（工作目录建议 `src/scripts`）

```bash
# 自然语言 / 行协议 / candidate JSON
npm run kb63:ingest -- --phase overview --kb-root <path> --source text --input <file> --out-dir <dir>

# 最终用例 XMind（绝对路径；导航/技术仅 [P0]，业务规则含 [P0]/[P1]）
npm run kb63:ingest -- --phase overview --kb-root <path> --source xmind --input <file.xmind> --out-dir <dir>

# 最终 C-TC（须同目录或 --manifest 指定 final_artifact.json；技术通道仅 P0）
npm run kb63:ingest -- --phase overview --kb-root <path> --source ctc --input <.../test_cases.json> --out-dir <dir>

# Confluence 下载产物的 pages 目录（只读 md+metadata）
npm run kb63:ingest -- --phase overview --kb-root <path> --source confluence --input <.../pages> --out-dir <dir>

npm run kb63:ingest -- --phase review --kb-root <path> --overview-file <overview.json> --changeset-file <changeset.json>
npm run kb63:ingest -- --phase apply --kb-root <path> --review-manifest <review_manifest.json> --confirm-content
```

截取（用例生成侧，非入库）：

```bash
npm run kb:extract -- --project-dir {WS}
# 或 npm run kb63:extract -- --project-dir {WS}
```

## 硬规则（摘要）

- 内容审前 **不得**修改语义库 `kb_root`。
- 不把 `模块匹配规则` / 产品上下文模板当业务知识真源。
- 不猜 URL/API；不写 Token/Cookie/真实业务 ID。
- 写前 pull/对账失败 → 停止；push 失败 → `push_pending`。
- Confluence 来源禁止读取 chunks/embeddings/knowledge_index，不运行下载侧 step4～7。
- Stage4「可以了」**不等于**入库；须用户另答「补充知识库」。
- **双通道优先级**：导航/技术引用仅 P0；业务规则仅 P0/P1 且排除非功能；P2/P3 不得入库。
- **元素门禁**：`name`/`interaction`/`result` 阻塞；`backend_api`/`position`/`input_options` 仅告警。
- **业务 page 缺 URL** 仅告警；显式 `page_url` 变更缺 URL 仍阻塞。
- **写盘**：8 列元素表（含展示内容）；空字段 `-`；补充说明按元素分组、无空行。
- `blocking_gaps` 非空只允许 overview。

## 写盘入口

新流程以 ChangeSet executor（`skills/knowledge-base`）为准；禁止用匹配规则/产品上下文模板顶替业务知识真源。
