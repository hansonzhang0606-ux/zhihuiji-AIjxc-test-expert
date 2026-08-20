# Adapters — 模型适配层（FOUND-08）

换模型时**只改本目录**，契约层（`contracts/`、`stages/`、`templates/`）与执行层脚本（`scripts/`）尽量不动。

| 文件 | 适用环境 | 状态 |
|------|----------|------|
| [`generic.md`](./generic.md) | 任意模型：抽象能力说明 + 降级策略 | 骨架 |
| [`cursor.md`](./cursor.md) | Cursor Agent（当前默认） | 骨架 |
| `claude.md` / `openai.md` | 预留 | 未建；需要时按 generic 模板复制 |

## 选用方式

1. 冷启动见工程根 [`bootstrap.md`](../../bootstrap.md)  
2. 确认当前运行环境（Cursor / Claude Code / 其他）  
3. 打开对应 adapter，按表把 Stage 文档中的**抽象工具名**映射到本环境真实工具  
4. Stage / demand 正文**只写抽象名**，不写厂商专用 API

## 能力分级（与 demand6.0 §9.2 一致）

| 等级 | 要求 | Fast Path |
|------|------|-----------|
| L1 | 文件读写 | Script 由外部跑；模型只做 1A/3A 文本 |
| L2 | L1 + Shell | 默认可跑 `src/scripts` |
| L3 | L2 + Confluence/MCP | 可在线拉需求；否则用 `input/需求文档/` 本地文件 |

## 未实装说明

本目录目前为**映射说明书骨架**，不含可执行插件代码。  
运行时若需缓存映射结果，可写入工作区 `script/adapters_runtime/`（可选）。
