# Adapter: cursor（Cursor Agent）

| 项 | 内容 |
|----|------|
| 适用 | Cursor IDE Agent / Composer |
| 能力等级 | **L3**（Read/Write/Shell + 可选 MCP Confluence）；无 MCP 时降为 L2 + 本地需求文件 |
| 状态 | FOUND-08 骨架（映射表可用；非独立 npm 包） |
| 基线 | 继承 [`generic.md`](./generic.md) 的抽象清单与降级策略 |

---

## 1. 抽象工具 → Cursor 实现

| 抽象工具 | Cursor 中的用法 | 说明 |
|----------|-----------------|------|
| `file.read(path)` | **Read** 工具 | `path` 用工作区绝对或相对路径 |
| `file.write(path, content)` | **Write** / **StrReplace** | 新建用 Write；局部修改优先 StrReplace |
| `file.exists(path)` | Read 失败则视为不存在；或 **Shell** `Test-Path` / `test -e` | 以 Shell 为准更稳 |
| `file.list(dir)` | **Glob** / **Shell** `Get-ChildItem` / `ls` | 大批量列举用 Glob |
| `shell.exec(command, cwd?)` | **Shell** 工具 | Windows 默认 PowerShell；`cd` 用 `working_directory` 或命令内切换 |
| `confluence.get_page` | MCP（若已配置）：如 `mcp-atlassian` / `confluence_get_page` 类工具 | 以当前 Cursor MCP 面板实际工具名为准 |
| `confluence.get_children` | MCP：`confluence_get_page_children` 或等价 | 无 MCP → 降级本地 `input/需求文档/` |

> MCP 工具名随 Cursor 配置变化；**以本机 MCP 列表为准**，上表为常见命名。更新时只改正文右列，勿改左列抽象名。

---

## 2. 本工程常用 Shell 命令（在 Cursor 中直接跑）

工作目录建议：`testcase-generation-skills/src/scripts`

```bash
npm install
npm run naming:self-test
npm run validate:self-test
node lib/workspace.js --create --title "<需求文档title>"
node lib/validate.js --type requirement_points --file <path.json>
```

产物默认：`testcase-generation-skills/output/<title>/`。

编排入口：工程根 [`skill.md`](../../skill.md)；冷启动：[`bootstrap.md`](../../bootstrap.md)。

| 抽象 | Cursor 做法 |
|------|-------------|
| `ui.ask_user` | 在对话中展示选项，**等待用户明确回复**；禁止超时自动「无需修改」 |
| 人审①（上下文） | 展示产品/版本/端摘要，确认后 `--approve` 写 `test_context_approved` |
| 人审①′（需求点） | **打开 XMind 仅预览**；真源 JSON；按 demand **§8.3**（≤20 列举 / >20 清单）；对话改 JSON 后重导；可迭代，不强制二次卡点 |
| 人审②（测试点） | 同 §8.3（≤40 / >40）；`unmatched>0` 禁止 Stage4；摘要 `merge_report` 扩展（6.1） |
| Stage4 用例预览 | 同 §8.3；改 `test_cases.json` 不改 XMind 当真源；`stage4_execute.js` / `export_tc_xmind.js` |
| 临时知识点 | **若存在** `script/stage1/domain_facts.json`：1A/3A 前 Read；Stage4 **禁止**读该文件 |
| 6.2 KB（非 6.1 范围） | 长期 KB 截取若启用 → 合并进 `domain_facts.json`；Fast Path 默认不跑 ingest |

---

## 4. 能力探测（Stage0 可参考）

| 探测项 | 方法 | 失败时 |
|--------|------|--------|
| L1 文件 | Read/Write 工程内临时文件 | 阻断 |
| L2 Shell | `node -v` | 改为外部跑脚本，模型只生成文本 |
| L3 Confluence | 列出 MCP 是否含 confluence 类工具 | 要求用户提供本地需求 md |

---

## 5. 与 generic 的差异摘要

- Cursor 用 IDE 内置 Read/Write/Shell，而不是让模型手写 Node fs（除非在 `scripts/` 里跑）  
- Confluence 优先 MCP；generic 优先 REST  
- 并行子 agent、断点续传等编排细节见 `skill.md` / demand6.0，不在本 adapter 重复实现  

## 6. 未实装

- 未提供 `adapters_runtime` 自动注入  
- 未锁定某一版 MCP 工具全名（需按环境填写）  
