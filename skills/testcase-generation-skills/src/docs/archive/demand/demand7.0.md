> **【历史留档】** Stage5 运行时规格已迁入 `src/stages/stage5_platform_import.md`。禁止 Agent 引用。

# Demand 1.0 — Stage5 用例导入金蝶 DevOps 平台【归档副本】

| 项 | 内容 |
|----|------|
| 版本 | 1.0.0 |
| 日期 | 2026-08-18 |
| 状态 | **已验证**（手工导入成功） |
| 编排 | 根目录 [`skill.md`](../../skill.md) §5.7 |
| Stage 文档 | [`../stages/stage5_platform_import.md`](../stages/stage5_platform_import.md) |
| 脚本 | `src/scripts/stage5/export_platform_p0_excel.js` |
| 接口抓包 | 仓库 [`demand/上传用例接口信息`](../../../demand/上传用例接口信息)（勿提交 Cookie） |

---

## 1. 目标

Stage4 完成后，将 **P0** 用例按金蝶 DevOps「用例管理」模板导出 Excel，供测试人员在平台 **手工导入**（当前默认路径）。  
后续可在此基础上扩展半自动/全自动上传（接口见 §6）。

**不做：** 替代 Stage4 用例生成；不修改 C-TC 真源；不在未登录时脚本直连平台写库。

---

## 2. 触发与门禁

| 项 | 规则 |
|----|------|
| 触发 | Stage4 用户说「可以了」后，Agent **询问**是否导出/导入平台；或用户显式说「导入平台」「导出 P0 Excel」 |
| 前置 | `script/stage4/test_cases.json` 存在且 schema 通过 |
| 范围 | 默认仅 **P0**（`priorityFilter: P0`） |
| 与 KB | Stage5 与「补充知识库」独立；可先后执行 |

---

## 3. Excel 列映射（已验证）

模板：`src/templates/数据模板_用例管理.xlsx`（只读）。

| Excel 列 | 字段 key | 填充规则 |
|----------|----------|----------|
| *项目组 | team | 固定 `智慧记-星火`（可配置） |
| *功能路径（用例分组） | caseGroup | `{年}-{版本}-{端}-{需求名称}`，见 §3.1 |
| 用例编号 | number | C-TC `id` |
| *功能点（用例名称） | name | C-TC `title` |
| 用例标签 | caseLabels | 三维标签展示串 |
| 功能说明（前置条件） | preCondition | `precondition` |
| input（步骤描述） | input | 步骤 `action` 编号拼接 |
| output（预期结果） | output | 步骤 `expected` 编号拼接 |
| *产品 | product | 固定 `星火`（**不是** product_tags 枚举） |
| *模块路径 | modulePath | 固定 `智慧记AI进销存-智慧记AI进销存` |
| 适用版本 | version | `version_tags` 逗号拼接 |
| *用例类型 | caseType | 固定 `功能测试` |
| 来源 | source | **置空** |
| 用例级别 | caseLevel | `priority` |
| *责任人 | manager | 固定 `傅文浩` |
| 已实现自动化 | autoState | `否` |
| 关联用户故事 | relateReqCode | 平台 PRJ 编号，见 §3.2 |

### 3.1 功能路径 `{年}-{版本}-{端}-{需求名称}`

| 段 | 规则 |
|----|------|
| 年 | 导出时当前年份，如 `2026` |
| 版本 | 从 `requirement_title` 或工作区路径解析 `V4.6.1` |
| 端 | 汇总本需求 P0 的 `platform_tags`：PC+APP → `web端`；仅 PC → `web端`；仅 APP → `app端`；小程序 → `小程序端` |
| 需求名称 | `requirement_title` 全文 |

示例：`2026-V4.6.1-app端-V4.6.1【APP云店】优化分类下搜索商品逻辑`

### 3.2 关联用户故事 PRJ

须与 DevOps 主数据一致；**不能**填需求标题长文。

| 需求关键词 | PRJ |
|------------|-----|
| 优化分类下搜索商品逻辑 | PRJ-00758363 |
| 版本降级时增购员工 | PRJ-00757902 |
| 引导下载App / 周迭代（示例） | PRJ-00766833 |

配置：`src/templates/用例平台导入配置.example.json` → 复制为 `用例平台导入配置.json`，或工作区 `script/config/platform_import.json` 写 `relate_req_code`。

---

## 4. 产物

| 路径 | 说明 |
|------|------|
| `script/stage5/test_cases_P0_platform.xlsx` | 机器产物 |
| `output/测试用例_P0_{title}.xlsx` | 默认复制，**给人导入** |
| `script/stage5/platform_export_report.json` | 导出审计（case_group、PRJ、条数） |

---

## 5. 命令

工作目录：`src/scripts`

```bash
node stage5/export_platform_p0_excel.js --project-dir {WS}
# 临时指定 PRJ：
node stage5/export_platform_p0_excel.js --project-dir {WS} --prj PRJ-00758363
npm run stage5:export -- --project-dir ../../output/...
npm run stage5:self-test
```

---

## 6. 平台导入流程（手工，已走通）

1. DevOps → 研发管理(DMP) → 用例管理 → 导入 Excel  
2. 选择「添加新数据」  
3. 上传 `output/测试用例_P0_{title}.xlsx`  
4. 开始导入 → 查看结果  

### 6.1 接口链路（自动化预留）

完整 Header/Payload 见 `demand/上传用例接口信息`。摘要：

| 顺序 | 接口 | 作用 |
|------|------|------|
| 0 | `batchInvokeAction … f=dmp_testcase_list&ac=importcase` | 打开导入弹窗（showForm） |
| 1 | `batchInvokeAction … f=bos_importstart&ac=beforeUpload` | 上传前校验 |
| 2 | `POST /attachment/upload.do?suffix=.xlsx` | multipart：`file` + `pageId` + `fId=dmp_testcase_list` |
| 3 | `batchInvokeAction … ac=upload` | 回写服务器 `url` 到表单 |
| 4 | `batchInvokeAction … ac=click` | 开始导入 → 打开「导入中」 |
| 5 | `invokeAction … f=dmp_testcase_list&ac=customEvent` | 页面切换通知 |
| 6 | `getMetadata … fid=bos_importing` | 进度/结果（待补全 Payload 方可脚本化） |

**脚本化前置：** 有效 Cookie、`kd-csrf-token`、`signature` 会话；禁止把凭据写入仓库。

---

## 7. 踩坑记录（导入校验）

| 报错 | 原因 | 修复 |
|------|------|------|
| 项目组必录 / 不存在 | 列为空或名称不对 | `智慧记-星火` |
| 责任人必录 | 列为空 | `傅文浩` |
| 产品不存在 | 填了 ailit 等标签枚举 | 改为 `星火` |
| 用户故事不匹配 | 填了需求标题 | 改为 `PRJ-xxxxxxx` |
| 模块路径不存在 | 填模块 L1-L2 或带英文括号全名 | `智慧记AI进销存-智慧记AI进销存` |
| 功能路径 | 平台分组规则 | `{年}-{版本}-{端}-{需求名称}` |

---

## 8. Agent 行为

1. Stage4「可以了」后 **询问**：是否导出 P0 到 DevOps 平台？  
2. 若 PRJ 未知 → 向用户索取或写 `platform_import.json`。  
3. 跑 export 脚本 → 告知 Excel 路径与导入步骤。  
4. **不**代替用户在浏览器点导入（除非后续实现 Stage5 upload 脚本且会话可用）。

---

## 9. 变更记录

| 版本 | 说明 |
|------|------|
| 1.0.0 | 首版：P0 Excel 导出 + 列映射 + 手工导入验证 + 接口抓包索引 |
