# 测试人员时间节省追踪 Skill（通用多业务线版 · MySQL-only · v1.5.2）

> 从「效贷测试专家」v1.5.0 抽取而来的独立子 Skill，可嵌入任意测试团队的 Skill 套件。
> 用于追踪并量化测试工作中 AI 为每位测试人员节省的时间。
>
> **⚠️ 当前部署形态（嵌入版 v7.2.0）**：本副本已嵌入「测试用例自动生成 Skill 套件」
> （`testcase-generation-skills/src/scripts/time-tracking/`），服务**智慧记 AI 进销存（AIJXC）**团队，
> `default_biz_line` 已预置「AI进销存」，`sync_task.bat` 已预置 BIZ_LINE=AI进销存。
> AI 执行规则以 [`prompts/time_tracking.md`](./prompts/time_tracking.md)（嵌入版）为准；
> 本 README 保留通用部署说明，供管理员维护参考（含跨业务线通用流程）。
>
> **存储口径（v5.3）**：记录只写本地 JSONL → 定时任务（每日 09:00 / 12:00 / 18:00）幂等同步到
> **共享 MySQL 数据库**。不依赖腾讯文档连接器。定时任务注册由 AI 自动完成（会话启动检测未注册 → 自动注册早/午/晚三任务）。
>
> **花名册来源（v1.5.2）**：身份识别**实时查询 MySQL `agent_team_roster` 表**，
> 不再读取本地 `team_roster.yaml`。`team_roster.yaml` 退化为「输入源」，管理员
> 维护后通过 `sync_roster_to_mysql.py` 推到 MySQL，多副本/多机器部署下花名册永远最新。
>
> **双宿主兼容**：既可嵌入 WorkBuddy 测试专家（智能体），也可作为纯 Skill 套件嵌入
> VSCode / OpenCode / Claude Code 等 IDE 工具。两类场景的数据最终都同步到**同一张
> MySQL 表**（`agent_time_tracking`，按 `biz_line_code` 区分业务线）。

---

## 1. 这是什么

一个让 AI 在测试工作流每个步骤完成后，**强制收集「这一步为你节省了多少时间」数据**的 Skill。
数据先写本地 JSONL（零网络依赖、永不失败），再由定时任务同步到团队共享 MySQL 数据库，
管理员可用 SQL 汇总；同时可生成 HTML 可视化报告（内置筛选面板）。

**两类使用场景**（数据最终汇聚同一 MySQL 表）：

| 场景 | 形态 | 驱动入口 | 报告展示 |
|------|------|---------|---------|
| WorkBuddy 测试专家 | 智能体（agent） | `agent.md` + 内嵌本 Skill | `present_files` 右侧面板预览 |
| IDE skill 套件 | 纯 Skill 包 | `SKILL.md` | 回复中给出文件路径，浏览器打开 |

> 脚本层完全宿主无关（纯命令行 `.py` / `.bat`），两类场景共用，无需重复开发。

## 2. 部署（三步）

### 第 1 步：解压

把本 zip 解压到目标团队的 Skill 目录，例如：

```
智慧记测试套件/
└── time-tracking-skill/   ← 本包
```

### 第 2 步：配置业务线

编辑 `config/time_tracking_config.yaml`，把 `default_biz_line` 改为你的业务线名称
（**智慧记有三个子业务线，须填具体子业务线全称，不可填统称"智慧记"**）：

```yaml
default_biz_line: "智慧记+运营系统"   # 或 AI进销存 / 智慧记零售
```

支持的业务线：`效贷` / `泾渭云` / `效融` / `小贷` / `智慧记+运营系统`(ZHJ) / `AI进销存`(AIJXC) / `智慧记零售`(ZHJLS)

> 一名员工可属于多条业务线（花名册 `biz_line_code` 数组）。身份确认时，若成员属多条业务线，
> AI 会**列出编号选项**让成员输入数字选择（如 `1. 智慧记+运营系统` / `2. AI进销存` / `3. 智慧记零售`），
> 避免自由文本回答笼统导致匹配不准确；`default_biz_line` 仅作为单业务线成员的默认值。

### 第 3 步：填写花名册

编辑 `config/team_roster.yaml`，维护团队成员：

```yaml
members:
  - name: "詹惠英"
    role: "功能测试"
    biz_line_code: ["ZHJ", "ZHJLS"]   # 可属于多条业务线
    active: true
```

> **v1.5.2 起**：yaml 是「输入源」，**运行时身份验证不再读它**，而是实时查 MySQL
> `agent_team_roster` 表。改完 yaml 后务必运行 `scripts/sync_roster_to_mysql.py`
> 把变更推到 MySQL，下一次会话启动即可识别。`scripts/load_roster.py --json`
> 可即时查看 MySQL 当前花名册。
>
> 花名册控制谁能用：AI 会盲输入姓名精确匹配，不在花名册内直接拒绝服务。

## 3. MySQL 同步（主流程，团队汇总必须配置）

### 3.1 每台电脑一次性初始化（测试人员，v1.5.1 起 AI 自动完成）

> **测试人员无需手动操作**：首次使用专家时，身份验证通过后 AI 会自动检测本机
> `mysql_config.json`——不存在就提示输入密码并自动调用脚本生成对应业务线目录，
> 存在就直接跳过。测试人员**再也不用手动打开 CMD**。

管理员侧需准备：数据库密码（单独告知测试人员）。手动备选方式（AI 调用失败 / 排查时）：

```bat
python init_mysql_config.py --biz-line "智慧记+运营系统"
```

AI 自动模式使用的等价命令（`--auto` 已存在自动跳过、`--quiet` 输出机器可读 JSON）：

```bat
python init_mysql_config.py --biz-line "智慧记+运营系统" --password "xxx" --employee "詹惠英" --no-interactive --quiet
```

生成本机配置 `~/.workbuddy/data/time-tracking/智慧记+运营系统/mysql_config.json`
（**含密码，本机私有，不随 Skill 分发，不要发群/提交 Git**）。

> ⚠️ **不初始化 = 数据只在本机**：每步反馈的时间只保存在本地 JSONL，
> 不会同步到团队共享 MySQL，管理员在数据库里看不到你的数据。**记录功能本身不受影响。**

### 3.2 注册定时任务（每日 09:00 / 12:00 / 18:00 自动同步，v5.3 起 AI 自动完成）

> **正常情况下由 AI 自动完成**（会话启动检测到未注册 → 自动 `schtasks /create` 注册早/午/晚三任务）。
> 以下为手动备选方式，仅在 AI 无法自动完成（如权限不足）或管理员排查时使用：

以管理员身份打开 CMD：

```bat
REM 先确认 scripts/sync_task.bat 顶部 set BIZ_LINE= 已改成你的业务线
schtasks /create /tn "业务线时间同步-早" /tr "C:\...\time-tracking-skill\scripts\sync_task.bat" /sc daily /st 09:00 /f
schtasks /create /tn "业务线时间同步-午" /tr "C:\...\time-tracking-skill\scripts\sync_task.bat" /sc daily /st 12:00 /f
schtasks /create /tn "业务线时间同步-晚" /tr "C:\...\time-tracking-skill\scripts\sync_task.bat" /sc daily /st 18:00 /f
```

> `sync_task.bat` 已内置 Python 自动探测 + GBK/CRLF 编码修复，无需改配置。

### 3.3 手动同步 / 验证

```bat
python sync_to_mysql.py --biz-line "智慧记+运营系统" --dry-run    :: 试运行，只看不写
python sync_to_mysql.py --biz-line "智慧记+运营系统"              :: 真实同步（幂等，重复跑无副作用）
```

## 4. 存储模式选择（可选）

| 模式 | 说明 | 适用 |
|------|------|------|
| `mysql`（默认） | 本地 JSONL + 定时任务同步共享 MySQL | 团队汇总（推荐） |
| `local` | 仅本地 JSONL，无需任何外部依赖 | 个人试用 / 快速验证 |
| `excel` | 本地 + Excel 共享文件（可选附加） | 团队无 MySQL 但有共享目录 |

默认 `mysql`：开箱即用（本地记录），配置好 MySQL 后自动进入团队汇总模式。

## 5. 常见命令速查

```bash
# 记录节省时间（写本地 JSONL，AI 工作流自动调用）
python scripts/record_time_saved.py --employee "张三" --user-story "US-001" \
  --step "文档整理" --step-code "01" --hours 4 --biz-line "智慧记+运营系统"

# 全业务线报告（HTML）
python scripts/generate_time_analytics.py --biz-line "智慧记+运营系统"

# 个人报告
python scripts/generate_time_analytics.py --biz-line "智慧记+运营系统" --person "张三"

# CSV 导出
python scripts/generate_time_analytics.py --biz-line "智慧记+运营系统" --format csv

# MySQL 初始化 + 同步
python scripts/init_mysql_config.py --biz-line "智慧记+运营系统"
python scripts/sync_to_mysql.py --biz-line "智慧记+运营系统"
```

## 6. 依赖

| 依赖 | 用途 | 说明 |
|------|------|------|
| pymysql | MySQL 同步 | 已打包（scripts/pymysql/），无需安装 |
| openpyxl | Excel 同步（可选） | `pip install openpyxl` |
| PyYAML | 花名册解析 | 有简易解析兜底，可缺省 |

> 本 Skill 为 MySQL-only，**不依赖腾讯文档连接器**。

## 7. 目录说明

```
time-tracking-skill/
├── SKILL.md                    # Skill 入口（AI 读）
├── README.md                   # 本文件（人读）
├── prompts/time_tracking.md    # AI 执行规则（v5 MySQL-only 口径）
├── config/                     # 主配置（业务线/存储/MySQL）+ 花名册
└── scripts/                    # 全部脚本（含打包的 pymysql）
```

## 8. 版本来源

- 抽取自「效贷测试专家」GitHub v1.5.0（`hansonzhang0606-ux/xiaodai-test-expert`）
- 泛化改动：`biz_line` 全部可配置、花名册 `employee_id` → `biz_line_code`、报告标题/表名动态化
- v5 口径：存储改为 MySQL-only（本地 JSONL + 定时任务幂等同步），彻底移除腾讯文档依赖
- 双宿主兼容：`prompts/time_tracking.md` 已做宿主无关处理（WorkBuddy 用 `present_files`，IDE 环境给文件路径）
- v1.5.1：MySQL 初始化由手动改为 **AI 自动完成**（会话启动检测 → 索要密码 → 自动调用 `init_mysql_config.py --auto --quiet`，配置已存在自动跳过），测试人员无需手动开 CMD
- v1.5.2：**身份识别从「读 `team_roster.yaml`」改为「实时查 MySQL `agent_team_roster`」**——`team_roster.yaml` 退化为「输入源」（管理员维护后通过 `sync_roster_to_mysql.py` 推到 MySQL），新增 `scripts/load_roster.py` 给 AI 用 JSON 形式拉取在职人员；会话启动顺序调整为「先 MySQL 配置检查 → 再花名册查询 → 再身份验证」
- 业务线编号选择：多业务线成员身份确认时，AI 列出编号选项让成员输入数字选择（`biz_line_helper.py` 新增 `code_to_biz_line` 反向映射），避免自由文本回答笼统导致匹配不准确
- v5.3：`sync_task.bat` 修复 Windows 兼容性（GBK 编码 + CRLF 换行 + Python 自动探测 + `%~dp0` 定位）；定时任务注册由「人工手动」升级为「AI 自动完成」（会话启动检测未注册 → 自动注册早/午/晚三任务）
- 抽取日期：2026-08-18
