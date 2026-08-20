# contracts — 跨 Stage JSON 契约

> 位于 `src/contracts/`。产物工作区：`testcase-generation-skills/output/{title}/`（废弃 `code/`）。

依据：`demand/testcase-generation-demand6.0.md`、`demand/testcase-generation-impl-outline6.0.md`（WP-FOUND）。

| 文件 | 任务 | 状态 | 运行时路径 |
|------|------|------|------------|
| `test_context.schema.json` | FOUND-01 | 已冻结 | `script/config/test_context.json` |
| `requirement_points.schema.json` | FOUND-02 | 已冻结 | `script/stage1/requirement_points.json` |
| `test_points.schema.json` | FOUND-02 | 已冻结 | `script/stage3/test_points.json` |
| `test_cases.schema.json` | FOUND-02 | 已冻结 | `script/stage4/test_cases.json` |
| `domain_facts.schema.json` | WP-61-FACTS（Demand 6.1） | **已定稿** | `script/stage1/domain_facts.json`（临时；仅 1A/3A） |
| `quality_gate_summary.schema.json` | WP-61-SUMMARY（Demand 6.1 P2） | **可选** | `script/config/quality_gate_summary.json`（仅 `--write` 生成） |
| `workspace.md` + `../scripts/lib/workspace.js` | FOUND-03 | 已完成（修订） | 工作区=`output/{title}/`；`input/`∥`output/`∥`script/` |
| `../scripts/lib/naming.js` | FOUND-04 | 已完成 | title→合法文件名/目录名 |
| `../scripts/lib/validate.js` | FOUND-05 | 已完成 | Schema + 语义校验 CLI |
| `../../bootstrap.md` | FOUND-06 | 已完成 | 从零安装（与 skill.md 平级，工程根） |
| `../fixtures/客户来源调研弹窗/` | FOUND-07 | 已完成 | 联调样例 |

## 工作区主键

- 仅使用 `requirement_title`（需求文档 title，来自 Confluence 页面或本地文档）
- 契约与 CLI **不提供、不接收** 故事编号类字段或参数

## input / output 中文目录

| 路径 | 含义 |
|------|------|
| `input/需求文档/` | 原 requirement |
| `input/技术文档/` | 原 technical |
| `input/历史文档参考/` | 原 reference |
| `output/*.xmind` | 对外交付 |

## 标签口径（三 Schema 共用）

| 维度 | 合法枚举 |
|------|----------|
| 产品 | 智慧记AI进销存、ailit、智慧记、智慧记零售（别名：国内版→智慧记AI进销存，国际版→ailit，零售→智慧记零售） |
| 版本 | 开单版、单店版、多店版 |
| 端 | PC端、APP端、小程序端 |

完整性约束（如 in∪out=全量枚举）由 **FOUND-05** 校验脚本强制。
