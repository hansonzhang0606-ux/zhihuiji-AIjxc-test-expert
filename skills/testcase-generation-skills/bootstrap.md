# 测试用例生成 Skill — 从零重建（Bootstrap）

| 项 | 内容 |
|----|------|
| 版本 | 6.0 / FOUND-08 |
| 依据 | `src/demand/testcase-generation-demand6.0.md` §〇、§9.4 |
| 定位 | **无记忆冷启动**：换机器 / 换模型时的安装与自检入口（与 `skill.md` 平级） |
| 工程根 | 本文所在目录 `testcase-generation-skills/` |

> 跑用例生成流程读 **`skill.md`** + `src/stages/`；装环境 / 自检读 **本文**。

---

## 1. 对外目录

```
testcase-generation-skills/
├── README.md       # 人类/模型着陆索引（可选极简）
├── skill.md        # 编排：怎么跑流程
├── bootstrap.md    # 本文：怎么从零装起来
├── output/         # ★ 生成产物
├── skills/         # 依赖 Skill
└── src/            # 规格与实现（黑盒）
```

生成路径：**`output/{需求文档title}/`**（不再使用 `code/`）。

---

## 2. 前置条件

| 依赖 | 要求 |
|------|------|
| Node.js | ≥ 14（推荐 LTS） |
| npm | 随 Node 附带 |

---

## 3. 安装依赖

```bash
cd testcase-generation-skills/src/scripts
npm install
```

---

## 4. 选择 Adapter（换模型）

| 环境 | 打开 |
|------|------|
| Cursor（默认） | `src/adapters/cursor.md` |
| 其他 / 模板 | `src/adapters/generic.md` |
| 索引 | `src/adapters/README.md` |

Stage 正文只写抽象工具名（`file.read` / `shell.exec` / `confluence.get_page`）；具体 IDE/MCP 映射只改 `src/adapters/`。

---

## 5. 自检

在 `src/scripts` 下：

```bash
npm run naming:self-test
npm run validate:self-test
npm run xmind:self-test
npm run stage0:self-check

node lib/workspace.js --create --title "客户来源调研弹窗"
# → testcase-generation-skills/output/客户来源调研弹窗/
```

```bash
node lib/workspace.js --assert-root --project-dir ../../output/客户来源调研弹窗 --title "客户来源调研弹窗"
node lib/validate.js --type test_context --file ../fixtures/客户来源调研弹窗/script/config/test_context.json
```

---

## 6. 路径速查

| 用途 | 路径 |
|------|------|
| 编排入口 | `skill.md` |
| 冷启动 | `bootstrap.md`（本文） |
| 阶段细则 | `src/stages/` |
| Stage5 平台导入 | `src/stages/stage5_platform_import.md` |
| 适配层 | `src/adapters/` |
| 目录约定 | `src/contracts/workspace.md` |
| 契约 | `src/contracts/*.schema.json` |
| 模板/知识 | `src/templates/`（含 `模块矩阵知识库/`） |
| 公共库 | `src/scripts/lib/*.js` |
| Fixtures | `src/fixtures/` |
| 产物 | `output/{title}/` |
| 入库旁路 | `skills/knowledge-base/` |

---

## 7. 验收标准

1. [ ] 工程根可见：`skill.md`、`bootstrap.md`、`output`、`skills`、`src`（及可选 `README.md`）  
2. [ ] `src/scripts` 下 `npm install` 成功  
3. [ ] 已选定 `src/adapters/cursor.md` 或按 `generic.md` 复制新 vendor  
4. [ ] naming / validate / xmind 自检通过  
5. [ ] `workspace --create` 落在 **`output/`**  

---

**文档结束**
