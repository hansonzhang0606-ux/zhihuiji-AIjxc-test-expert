---
stage_id: stage5_platform_import
version: "1.0.0"
execution_type: script
fast_path: true
trigger: optional_after_stage4
estimated_duration: "1-3min"
quality_gate: "Stage4 已完成；test_cases.json 存在"
inputs:
  - name: test_cases.json
    required: true
    contract: C-TC
  - name: platform_import.json
    required: false
outputs:
  - path: "script/stage5/test_cases_P0_platform.xlsx"
  - path: "output/测试用例_P0_{title}.xlsx"
  - path: "script/stage5/platform_export_report.json"
depends_on:
  - stage4_test_case_generation
---

# Stage5 平台 P0 用例导入

| 项 | 内容 |
|----|------|
| 模板 | `src/templates/数据模板_用例管理.xlsx` |
| 配置 | `src/templates/用例平台导入配置.example.json`；工作区 `script/config/platform_import.json` |
| Script | `stage5/export_platform_p0_excel.js`、`stage5/platform_excel.js` |
| 接口抓包（人工） | 仓库根 [`demand/上传用例接口信息`](../../../demand/上传用例接口信息)（勿提交 Cookie） |

> **默认：** 导出 P0 Excel → 用户在金蝶 DevOps **手工导入**。  
> **不做：** 替代 Stage4；不修改 C-TC 真源；未登录时不脚本直连写库。

---

## 1. 触发与门禁

| 项 | 规则 |
|----|------|
| 触发 | Stage4「可以了」后 Agent **询问**；或用户说「导入平台」「导出 P0 Excel」 |
| 前置 | `script/stage4/test_cases.json` 存在且 schema 通过 |
| 范围 | 默认仅 **P0**（`priorityFilter: P0`） |
| 与 KB | 与「补充知识库」独立，可先后执行 |

---

## 2. 产物

| 路径 | 说明 |
|------|------|
| `script/stage5/test_cases_P0_platform.xlsx` | 机器产物 |
| `output/测试用例_P0_{title}.xlsx` | 默认复制，供 DevOps 导入 |
| `script/stage5/platform_export_report.json` | 审计（case_group、PRJ、条数） |

---

## 3. Excel 列映射（已验证）

| Excel 列 | 字段 key | 填充规则 |
|----------|----------|----------|
| *项目组 | team | `智慧记-星火`（可配置） |
| *功能路径 | caseGroup | `{年}-{版本}-{端}-{需求名称}`，见 §3.1 |
| 用例编号 | number | C-TC `id` |
| *功能点 | name | C-TC `title` |
| 用例标签 | caseLabels | 三维标签展示串 |
| 功能说明 | preCondition | `precondition` |
| input | input | 步骤 action 编号拼接 |
| output | output | 步骤 expected 编号拼接 |
| *产品 | product | `星火`（**不是** product_tags） |
| *模块路径 | modulePath | `智慧记AI进销存-智慧记AI进销存` |
| 适用版本 | version | `version_tags` 逗号拼接 |
| *用例类型 | caseType | `功能测试` |
| 来源 | source | **置空** |
| 用例级别 | caseLevel | `priority` |
| *责任人 | manager | `傅文浩` |
| 已实现自动化 | autoState | `否` |
| 关联用户故事 | relateReqCode | PRJ 编号，见 §3.2 |

### 3.1 功能路径

| 段 | 规则 |
|----|------|
| 年 | 导出时当前年份 |
| 版本 | 从 `requirement_title` 或工作区路径解析 `V4.6.1` |
| 端 | P0 的 `platform_tags` 汇总：PC+APP→`web端`；仅 PC→`web端`；仅 APP→`app端`；小程序→`小程序端` |
| 需求名称 | `requirement_title` 全文 |

示例：`2026-V4.6.1-app端-V4.6.1【APP云店】优化分类下搜索商品逻辑`

### 3.2 关联用户故事 PRJ

须与 DevOps 主数据一致；**不能**填需求标题。

| 需求关键词 | PRJ |
|------------|-----|
| 优化分类下搜索商品逻辑 | PRJ-00758363 |
| 版本降级时增购员工 | PRJ-00757902 |
| 引导下载App / 周迭代 | PRJ-00766833 |

配置：`src/templates/用例平台导入配置.example.json`，或 `{WS}/script/config/platform_import.json` 的 `relate_req_code`，或 CLI `--prj`。

---

## 4. 命令

```bash
cd src/scripts
node stage5/export_platform_p0_excel.js --project-dir {WS}
node stage5/export_platform_p0_excel.js --project-dir {WS} --prj PRJ-00758363
npm run stage5:export -- --project-dir {WS}
npm run stage5:self-test
```

---

## 5. 人工导入（已走通）

1. DevOps → DMP → 用例管理 → 导入 Excel  
2. 「添加新数据」  
3. 上传 `output/测试用例_P0_{title}.xlsx`  
4. 开始导入 → 查看结果  

### 5.1 接口链路（自动化预留）

完整 Header/Payload 见 `demand/上传用例接口信息`。

| 顺序 | 接口 | 作用 |
|------|------|------|
| 0 | `batchInvokeAction … ac=importcase` | 打开导入弹窗 |
| 1 | `… ac=beforeUpload` | 上传前校验 |
| 2 | `POST /attachment/upload.do?suffix=.xlsx` | multipart 上传 |
| 3 | `… ac=upload` | 回写服务器 url |
| 4 | `… ac=click` | 开始导入 |
| 5 | `invokeAction … ac=customEvent` | 页面切换 |
| 6 | `getMetadata … fid=bos_importing` | 进度/结果 |

脚本化须有效 Cookie、`kd-csrf-token`、`signature`；凭据禁止入库。

---

## 6. 导入踩坑

| 报错 | 修复 |
|------|------|
| 项目组必录/不存在 | `智慧记-星火` |
| 责任人必录 | `傅文浩` |
| 产品不存在 | `星火`（勿用 ailit 等标签） |
| 用户故事不匹配 | `PRJ-xxxxxxx` |
| 模块路径不存在 | `智慧记AI进销存-智慧记AI进销存` |
| 功能路径 | `{年}-{版本}-{端}-{需求名称}` |

---

## 7. Agent

1. Stage4「可以了」（且完成时间追踪 06）后 **询问**是否 Stage5。  
2. PRJ 未知 → 向用户索取或写 `platform_import.json`（默认用会话缓存的用户故事编号）。  
3. 跑 export → 给出 Excel 路径与 §5 步骤。  
4. 不代替用户在浏览器导入（除非后续 upload 脚本落地）。  
5. ⏱ **时间追踪（07 知识入库，平台导入完成后强制）**：交付 Excel 与导入步骤后询问「DevOps 导入是否完成？」；用户确认完成（或表示不再导入、仅要 Excel）后，按 [`time_tracking.md`](../scripts/time-tracking/prompts/time_tracking.md) §四 收集。step_code=`07`，参考值 1~2 小时；强制询问 → 解析 → **二次确认** → 写本地 JSONL；拒绝反馈最多追问 2 次，记录 0 标注「用户未反馈」。

```bash
python src/scripts/time-tracking/scripts/record_time_saved.py \
  --employee "{姓名}" --user-story "{PRJ-xxx 需求名}" \
  --step "知识入库" --step-code "07" --hours {小时} --biz-line "{biz_line}"
```

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.0 | 2026-08 | 首版：P0 Excel → DevOps 手工导入 |
| 1.1.0 | 2026-08-19 | 嵌入时间追踪：平台导入完成后强制收集 07 知识入库 |

---

## 8. 验收

- [ ] 仅 P0  
- [ ] §3 列值正确；来源为空  
- [ ] DevOps 成功条数 = P0 条数  

```bash
npm run stage5:self-test
```
