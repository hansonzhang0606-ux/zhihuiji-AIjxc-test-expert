# 智慧记AI进销存专家（zhihuiji-aijxc-test-expert）

> 智慧记AI进销存（又称智慧记星火，AIJXC）业务线功能测试专家，WorkBuddy 专家包 v1.0.0。
> 内置 testcase-generation-skills **v7.2.0**（用例生成套件 + 嵌入式时间追踪能力）。

## 能力一览

- **Fast Path 用例生成**：需求下载与三维识别（人审①）→ 需求点提取（人审①′）→ 测试点合成（人审②）→ 用例生成 → P0 Excel 导出 DevOps
- **身份识别**：盲输入姓名，实时查询 MySQL `agent_team_roster` 表（仅限 AIJXC 业务线成员）
- **强制时间追踪**：01 文档整理 / 02 需求评审 / 04 生成测试点 / 06 用例细化 / 07 知识入库，每环节结束收集节省时间（二次确认），先写本地 JSONL，定时任务（12:00/18:00）幂等同步共享 MySQL `agent_time_tracking`
- **统计报告**：个人 / 业务线 HTML 报告（generate_time_analytics.py）
- **双宿主同源**：与测试人员在 VSCode/OpenCode 中使用的同版 v7.2.0 套件数据同库

## 目录结构

```
zhihuiji-aijxc-test-expert/
├── .codebuddy-plugin/plugin.json   ← 专家元数据
├── agents/zhihuiji-aijxc-test-expert.md  ← 专家编排（会话启动/身份识别/时间追踪规则）
├── avatars/expert.png
└── skills/testcase-generation-skills/    ← v7.2.0 套件（3910 文件）
    ├── SKILL.md                    ← 套件编排入口（原 skill.md，WorkBuddy 规范改名）
    ├── README.md / bootstrap.md
    └── src/
        ├── stages/                 ← 各阶段细则
        ├── scripts/                ← node 用例生成脚本
        │   └── time-tracking/      ← 嵌入式时间追踪（34 文件）
        └── templates/              ← 经验规则 + 模块矩阵知识库
```

## 与 IDE 版套件的关系

同一份 `testcase-generation-skills.zip` v7.2.0 可直接解压给测试人员在 VSCode/OpenCode 使用；本专家包内嵌的副本与 IDE 版**脚本、配置、数据格式完全一致**，均写入同一 MySQL 表（幂等键 MD5(biz_line_code|employee|user_story|step_code|timestamp)）。

## 首次使用

1. 在 WorkBuddy【专家中心-我的专家】启用本专家
2. 首次会话会自动生成 MySQL 全空配置模板（`~/.workbuddy/data/time-tracking/AI进销存/mysql_config.json`），按 `mysql_config.notes.md` 填写全部字段后回复「已填好」
3. 输入姓名完成身份验证 → 提供 PRJ 编号+故事名称 → 开始工作流

## 维护说明

- 花名册：管理员维护 `skills/testcase-generation-skills/src/scripts/time-tracking/config/team_roster.yaml` → `sync_roster_to_mysql.py` 推到 MySQL（运行时身份验证只查 MySQL）
- 定时同步：管理员在各测试人员机器注册 `scripts/sync_task.bat`（每日 12:00/18:00）
- 套件升级：替换 `skills/testcase-generation-skills/` 整目录并同步升级 IDE 分发 zip
