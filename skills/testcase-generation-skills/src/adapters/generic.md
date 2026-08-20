# Adapter: generic（通用骨架）

| 项 | 内容 |
|----|------|
| 适用 | 任意模型 / IDE；作为其他 adapter 的模板 |
| 能力基线 | 至少 L1；有 Shell 则 L2；有 Confluence API/MCP 则 L3 |
| 状态 | FOUND-08 骨架（映射表 + 降级策略；无运行时插件） |

---

## 1. 抽象工具清单（契约层只认这些名字）

Stage / demand / skill 中应使用左列抽象名；右列为「应具备的语义」，由具体 adapter 填实现。

| 抽象工具 | 语义 | 最低能力 |
|----------|------|----------|
| `file.read(path)` | 读取文本文件全文 | L1 |
| `file.write(path, content)` | 写入/覆盖文本文件 | L1 |
| `file.exists(path)` | 判断路径是否存在 | L1 |
| `file.list(dir)` | 列出目录（非递归即可） | L1 |
| `shell.exec(command, cwd?)` | 在指定目录执行命令并返回 stdout/stderr/exitCode | L2 |
| `confluence.get_page(pageIdOrUrl)` | 获取页面 title + body（存储用 markdown/html 均可，下游再规范化） | L3 |
| `confluence.get_children(pageId)` | 获取子页面列表（id、title） | L3 |

可选（并行/进阶，本骨架可不实装）：

| 抽象工具 | 语义 |
|----------|------|
| `confluence.download_attachments(pageId, destDir)` | 附件下载到工作区 |
| `ui.ask_user(prompt, choices?)` | 人审 CHECK_POINT 交互 |

---

## 2. 通用实现映射（伪代码级）

| 抽象工具 | 通用实现思路 | 备注 |
|----------|--------------|------|
| `file.read` | 语言标准库读文件（Node `fs.readFileSync` / Python `open`） | 编码默认 UTF-8 |
| `file.write` | 标准库写文件；父目录不存在则先创建 | 路径相对工作区或绝对路径须在 Stage 中写清 |
| `file.exists` / `file.list` | 标准库 | — |
| `shell.exec` | `child_process.spawn` / `subprocess.run` | **禁止**在 Stage 正文写死某 IDE 的 Bash 工具名 |
| `confluence.get_page` | REST：`GET /rest/api/content/{id}?expand=body.storage,space` | 凭证来自环境变量或用户提供；勿写入仓库 |
| `confluence.get_children` | REST：`GET /rest/api/content/{id}/child/page` | 分页时循环 `start/limit` |

本 Skill 已落地的确定性步骤，优先调用：

```text
shell.exec("node lib/workspace.js --create --title \"...\"", cwd=src/scripts)
shell.exec("node lib/validate.js --type test_context --file ...", cwd=src/scripts)
shell.exec("node lib/naming.js --sanitize \"...\"", cwd=src/scripts)
```

---

## 3. 降级策略（换模型时必须遵守）

| 缺失能力 | 策略 |
|----------|------|
| 无 Shell（仅 L1） | 由维护者在本地/CI 跑 `src/scripts`；模型只负责读写约定 JSON / 生成文本 |
| 无 Confluence | 用户把需求 md 放入 `output/{title}/input/需求文档/`；跳过在线下载 |
| 无 MCP | 同「无 Confluence」，或改用 HTTP + 用户粘贴的 title/正文 |
| 工具名不同 | **只改本 adapter 映射表**，不改 `stages/*.md` 里的抽象名 |

---

## 4. 换模型检查清单

1. [ ] 复制本文件为 `adapters/<vendor>.md`  
2. [ ] 填「抽象 → 具体工具」表（见 cursor.md 格式）  
3. [ ] 标注本环境能力等级 L1/L2/L3  
4. [ ] 用 `bootstrap.md` 跑 naming / validate / workspace 自检  
5. [ ] 用 `src/fixtures/客户来源调研弹窗` 验证路径仍可读  

---

## 5. 未实装 / 占位

- 无自动加载 adapter 的运行时注册表（未来可写入 `script/adapters_runtime/active.json`）  
- 无 Claude / OpenAI 专用文件（需要时按本节模板新增）  
