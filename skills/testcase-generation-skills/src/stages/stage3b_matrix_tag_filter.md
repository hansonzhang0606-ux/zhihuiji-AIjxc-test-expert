---
stage_id: stage3b_matrix_tag_filter
version: "6.2.0"
execution_type: script
fast_path: true
trigger: default
estimated_duration: "1-2min"
quality_gate: "C-TP 已存在；按知识库功能支持矩阵裁剪 version_tags/product_tags；写出 matrix_filter_report.json"
inputs:
  - name: test_points.json
    required: true
    contract: C-TP
  - name: test_context.json
    required: false
    contract: C-CTX
  - name: module_attribution.json
    required: false
    contract: C-MOD
outputs:
  - path: "script/stage3/test_points.json"
    contract: C-TP
  - path: "script/stage3/matrix_filter_report.json"
    contract: C-MATRIX-RPT
depends_on:
  - stage3a_testpoint_synthesis
---

# Stage3B 矩阵标签裁剪（Demand 6.2 §四）

| 项 | 内容 |
|----|------|
| 依据 | `demand/testcase-generation-demand6.2.md` §4.3 |
| 权威矩阵 | `src/templates/模块矩阵知识库/模块矩阵总览.md` →「【机器区】电脑端 · 功能支持矩阵」 |
| 脚本 | `scripts/stage3/stage3b_matrix_tag_filter.js` |
| 矩阵库 | `scripts/stage3/version_function_matrix.js` |

> **不改** 3.3 / 3A 既有步骤 md 与 C-TP schema；仅就地更新 `version_tags` / `product_tags`。  
> **不删** 测试点；裁剪后标签为空只告警。

---

## 1. 目标

模块归属准确后，按产品/订阅版本对该模块是否真正支持，裁剪测试点标签。

**示例：**「商品 / 套餐」开单列为 ❌ → 去掉 `开单版`，保留 `单店版`、`多店版`。

---

## 2. CLI

```bash
cd testcase-generation-skills/src/scripts
node stage3/stage3b_matrix_tag_filter.js --project-dir <工作区> [--export]
node stage3/stage3b_matrix_tag_filter.js --self-test
```

建议挂点：`stage3a_finalize` 之后、人审② / 导出确认之前（`--export` 可在本步重导 XMind）。

---

## 3. 算法摘要

1. 按 `module_l1`/`module_l2` 查矩阵行  
2. 按 `product_tags`（缺省回退 C-CTX）求允许版本集  
3. `version_tags = 原标签 ∩ C-CTX.in_scope ∩ 允许集`  
4. 某产品在该模块全 ❌ → 从 `product_tags` 去掉  
5. `ailit` 强制不得保留 `开单版`  
6. **不裁** `platform_tags`  
7. `unmatched` 跳过  

---

## 4. 告警文案（中文）

| 情况 | message |
|------|---------|
| 正常裁剪 | 已按功能矩阵剔除不支持的版本标签 |
| 裁剪后 `version_tags` 为空 | **该功能模块无匹配标签** |
| 模块不在矩阵 | **该功能模块在知识库中没有设置标签匹配规则** |
| TP 与 C-MOD 模块不一致 | 测试点模块与归属结果不一致，已按测试点模块裁剪标签 |
| unmatched | 未匹配模块，跳过标签裁剪 |

控制台 / 人审摘要只展示中文 `message`；`code` 仅脚本过滤用。

---

## 5. 报告

路径：`script/stage3/matrix_filter_report.json`

含 `entries[]`（裁剪 diff）、`warnings[]`、`summary`。标签有变更时清除 `stage3_approved`，需重新人审②。

---

## 6. 与上下游

```
3.3 模块归属 → 3A 测试点合成 → ★ 3B 本步 → 导出/人审② → Stage4
```

Stage4 默认继承已裁剪标签；人审改标签后可再跑本步（幂等）。
