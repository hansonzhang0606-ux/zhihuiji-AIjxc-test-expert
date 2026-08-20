# src — 规格与实现（使用者黑盒）

工程最外层入口：

- `../README.md` — 着陆索引  
- `../bootstrap.md` — 无记忆冷启动  
- `../skill.md` — 流程编排  

本目录存放维护与执行所需的规格、契约、脚本、模板与 fixtures。

| 子目录/文件 | 说明 |
|-------------|------|
| `demand/` | demand6.0、实现大纲等 |
| `contracts/` | JSON Schema、workspace 约定 |
| `adapters/` | 抽象工具 → 模型/IDE 映射（FOUND-08） |
| `stages/` | Stage 实现文档（LLM prompt） |
| `scripts/` | Node 脚本（`lib/`、stage0~4） |
| `templates/` | 模块/标签/优先级等模板 |
| `fixtures/` | 联调样例工作区 |

产物请写入工程根 `../output/`，不要写回本目录。
