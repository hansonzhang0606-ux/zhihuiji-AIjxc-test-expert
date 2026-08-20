---
stage_id: stage0_weekly_iteration
version: "6.0.5"
execution_type: hybrid
fast_path: true
trigger: "标题含「周迭代」"
estimated_duration: "按子需求逐个计时"
quality_gate: "每个子需求独立完成 Stage4 后询问是否继续下一个"
inputs:
  - name: weekly_iteration_confluence_or_md
    required: true
    description: "总览页 title 含「周迭代」，正文含需求范围表 + 分节详述"
outputs:
  - path: "output/{version}/vX.Y.Z_周迭代_{子需求名}/"
    description: "每个子需求独立工作区"
depends_on:
  - stage0_init
---

# 周迭代需求拆分（一页多子需求）

| 项 | 内容 |
|----|------|
| 识别 | Confluence / 本地标题含 **「周迭代」**（如 `V4.6.0 周迭代`） |
| 命名 | 子需求工作区 title = `v4.6.0_周迭代_{需求名称}`（清洗后） |
| 目录 | 有版本前缀时：`output/v4.6.0/v4.6.0_周迭代_{名称}/` |
| 工具 | `naming.buildWeeklySubRequirementTitle` / `resolveWorkspaceRelPath` |

---

## 1. 何时触发

Stage0 / 下载后，若 `isWeeklyIterationTitle(title) === true`：

- **禁止**把整页周迭代当作单个需求跑完 1A→3A→4  
- **必须**拆成多个子需求，**逐个**走完整 Fast Path  

---

## 2. 拆分步骤（Agent）

1. 下载总览页正文到总览工作区（可保留作对照）：`output/v4.6.0/V4.6.0_周迭代/`  
2. 从「需求范围」表的 **需求名称** 列提取子需求列表；若无表，则按正文一级/二级标题（如 `1、【PC】…`）提取  
3. 向用户展示清单（序号 + 名称），说明将 **按顺序逐个生成用例**  
4. 对当前子需求：
   - 计算 title：`node -e "console.log(require('./lib/naming').buildWeeklySubRequirementTitle('V4.6.0 周迭代', '【PC】…'))"`  
   - Stage0：`node stage0/stage0_init.js --title "<子需求 title>"`  
   - 将总览 md 中**该子需求相关章节**写入子工作区 `input/需求文档/{title}.md`（不要整份无关章节糊进去）  
   - 按 skill 主流程跑完：下载/归一 → 人审① → 1A → 人审①′ → Stage3 → 人审② → Stage4  
5. **本子需求用例生成完成后（Stage4 结束）必须询问：**

> 子需求「{名称}」用例已生成完毕。  
> 是否继续下一个子需求的用例生成？（回复「继续」/「下一个」或指定序号；全部完成可回复「全部完成 / 先到这里」）

6. 用户同意则切到下一个子需求，重复第 4～5 步；拒绝或全部完成则结束本轮周迭代。

> ⏱ **时间追踪与用户故事**：每个子需求 = **独立的用户故事**。切换子需求时，必须向用户确认并**更新会话缓存的用户故事编号+名称**（如 `PRJ-xxx 子需求名`），再开始下一个子需求的时间追踪记录；各环节追踪时机不变（01/02/04/06/07，见 `skill.md` §三）。

---

## 3. 命名与路径示例

| 项 | 示例 |
|----|------|
| 总览 title | `V4.6.0 周迭代` |
| 版本目录 | `output/v4.6.0/` |
| 子需求名称 | `【PC】销售小票模板增加快递字段` |
| 子工作区 title | `v4.6.0_周迭代_【PC】销售小票模板增加快递字段`（经 sanitize） |
| 路径 | `output/v4.6.0/v4.6.0_周迭代_【PC】销售小票模板增加快递字段/` |

标题**无** `vX.Y.Z` 前缀时：不建版本目录，子需求仍可用 `周迭代_{名称}` 落在 `output/` 下。

---

## 4. 禁止

- 未拆分就对「周迭代」总览页做需求点/测试点/用例全量生成  
- 多个子需求共用一个工作区互相覆盖  
- Stage4 结束后不询问、直接静默开始下一个  

---

## 5. 版本

| 版本 | 日期 | 说明 |
|------|------|------|
| 6.0.5 | 2026-07-23 | 周迭代拆分 + 逐个生成 + 完成后询问下一个 |
