# fixtures — 联调样例工作区（FOUND-07）

依据：`demand/testcase-generation-impl-outline6.0.md` WP-FOUND / FOUND-07。

## 样例列表

| 目录 | 说明 |
|------|------|
| `客户来源调研弹窗/` | 完整 6.0 工作区骨架 + 假需求 md + C-CTX / C-RP / C-TP / C-TC |

## 目录结构

```
fixtures/客户来源调研弹窗/
├── input/需求文档/客户来源调研弹窗.md
├── input/技术文档/          # 空：默认跳过 Stage2
├── input/历史文档参考/
├── output/                  # 空：待 XMind 导出（XMIND-02～04 CLI）
└── script/
    ├── config/test_context.json          # C-CTX
    ├── stage1/requirement_points.json    # C-RP
    ├── stage3/
    │   ├── test_points.json              # C-TP
    │   └── module_attribution.json       # 供 Stage3 联调
    └── stage4/test_cases.json            # C-TC（XMind 用例模板自检）
```

## 校验

在 `src/scripts/` 下：

```bash
node lib/validate.js --type test_context --file ../fixtures/客户来源调研弹窗/script/config/test_context.json
node lib/validate.js --type requirement_points --file ../fixtures/客户来源调研弹窗/script/stage1/requirement_points.json
node lib/validate.js --type test_points --file ../fixtures/客户来源调研弹窗/script/stage3/test_points.json
node lib/validate.js --type test_cases --file ../fixtures/客户来源调研弹窗/script/stage4/test_cases.json
npm run xmind:self-test
node stage1/export_rp_xmind.js --project-dir ../fixtures/客户来源调研弹窗
# → fixtures/.../output/需求点_客户来源调研弹窗.xmind
node stage3/export_tp_xmind.js --project-dir ../fixtures/客户来源调研弹窗
# → fixtures/.../output/测试点_客户来源调研弹窗.xmind
node stage4/export_tc_xmind.js --project-dir ../fixtures/客户来源调研弹窗
# → fixtures/.../output/测试用例_客户来源调研弹窗.xmind
# Excel 默认路径（本 CLI 不生成）: script/stage4/test_cases.xlsx
```

期望均为 `ok: true`。

## 用途

- **WP-S1 / S3 / S4** 缺上游时：直接拷贝或指向本目录作为 `--project-dir`
- 不跑 LLM 即可验证导出、模块脚本、用例脚本的路径契约
- **S1-DL**：`node stage1/stage1_download.js --project-dir ../fixtures/客户来源调研弹窗 --normalize`（已有 md 则跳过下载）
- **S1-CTX**：`node stage1/stage1_context.js --project-dir ../fixtures/客户来源调研弹窗` → 确认后 `--approve`
- **S1-1A**：LLM 按 `stages/stage1a_requirement_synthesis.md` 出草稿 → `node stage1/stage1a_finalize.js --project-dir … --from-draft draft.json --export` → 人审①′ → `--approve`
- 联调自检：`node stage1/stage1a_finalize.js --self-test`
- **WP-S4**：`node stage4/stage4_execute.js --project-dir ../fixtures/客户来源调研弹窗 --skip-gate`  
  （正式编排须先 `stage3_approved`；冒烟用 `npm run stage4:self-test`）
  → `script/stage4/test_cases.json` + `output/测试用例_客户来源调研弹窗.xmind`  
  Excel / 知识库默认仅 `script/stage4/`（知识库默认关）
