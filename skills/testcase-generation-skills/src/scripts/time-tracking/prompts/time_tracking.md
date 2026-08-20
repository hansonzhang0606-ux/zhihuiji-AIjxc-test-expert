# 时间节省追踪规则（v7.2 嵌入版 — 随「测试用例自动生成 Skill 套件」分发 | 智慧记 AI 进销存团队）

> **本文件定义了测试用例生成套件 Fast Path 各环节完成后，强制收集时间节省数据的执行规则。**
> 嵌入位置：`testcase-generation-skills/src/scripts/time-tracking/`（下文命令均以**套件根目录**为工作目录）。
> 触发条件：会话启动时（MySQL 检查 + 身份识别）；人审①/①′/②、Stage4 交付、Stage5 平台导入完成后强制反馈；
> 用户说「查看时间统计」时生成分析报告。
>
> **业务线**：本套件已预置 `default_biz_line: AI进销存`（编码 AIJXC）。若员工在花名册中属于多条业务线，
> 以身份确认环节员工选择的业务线为准。
>
> **数据链路（与效贷等其他业务线完全同源同库）**：
> 反馈时间 → 本地 JSONL（零网络依赖、永不失败）→ 定时任务（每日 09:00 / 12:00 / 18:00）幂等同步
> → 共享 MySQL `agent_time_tracking` 表（唯一键 `record_key` = MD5(biz_line_code|employee|user_story|step_code|timestamp秒)）。
>
> **v5.3 变更**：① `sync_task.bat` 修复 Windows 兼容性（GBK 编码 + CRLF 换行 + Python 自动探测 + `%~dp0` 定位），解决 schtasks 触发的 cmd.exe 用 GBK(936) 读取 UTF-8/LF bat 导致中文乱码、找不到命令、路径找不到的问题；② 定时任务注册由「人工手动」升级为「AI 自动完成」——会话启动检测到未注册 → 自动 `schtasks /create` 注册早/午/晚三个每日任务（09:00 / 12:00 / 18:00）。
>
> **双宿主**：WorkBuddy 智能体与 IDE（VSCode / OpenCode / Claude Code 等）使用同一套纯命令行脚本，
> 数据落同一 MySQL 表；仅报告展示方式不同（WorkBuddy 用 `present_files`，IDE 给文件路径，见第五节）。

---

## 一、会话启动：MySQL 检查 + 身份识别 + 用户故事缓存（必做）

> v1.5.2 关键规则：身份识别**实时查询 MySQL `agent_team_roster` 表**（`load_roster.py --json`），
> **禁止读本地 `team_roster.yaml` 做身份匹配**（yaml 仅管理员维护的输入源，经 `sync_roster_to_mysql.py` 推到 MySQL）。
> MySQL 配置检查必须在身份识别之前（先有连接再查花名册）。

### 1. MySQL 初始化状态检查（先做）

会话启动**第一步**，AI **自动检查**本机 MySQL 同步配置是否已初始化：

1. 扫描 `~/.workbuddy/data/time-tracking/*/mysql_config.json` 是否存在（任意业务线有一份即可，`agent_team_roster` 与 `agent_time_tracking` 共用同一库）
2. **已存在** → 直接进入身份识别
3. **不存在** → AI **自动生成 MySQL 配置模板（不在对话中索要密码）**：

   ```bash
   python src/scripts/time-tracking/scripts/init_mysql_config.py \
     --biz-line "AI进销存" \
     --template \
     --no-interactive \
     --quiet
   ```

   - 脚本生成 `~/.workbuddy/data/time-tracking/AI进销存/mysql_config.json`（全部字段为空）+ 同目录 `mysql_config.notes.md`（逐字段填写说明）
   - 向用户提示：

     ```
     🔧 已为你生成 MySQL 配置模板：
         {config_path}
     同目录 mysql_config.notes.md 说明了每个字段的填写方式。请按说明将全部字段
     （host/port/user/password/database/table/charset/biz_line/biz_line_code）填写完整
     （不清楚的找管理员获取），保存后回复「已填好」即可继续。
     ```

4. **禁止**要求测试人员手动打开 CMD 执行命令；**禁止**在对话中向用户索要数据库密码——密码只由用户在本地 `mysql_config.json` 文件中填写。未初始化期间数据仅存本地 JSONL，不阻塞服务。

> `mysql_config.json` 是本机私有配置（**含数据库密码**），**不随 Skill 分发**，每台电脑初始化一次，**不要发群、不要提交 Git**。

### 2. 身份识别

每次新会话开始时，**必须**（在 MySQL 配置就绪后）实时查询 MySQL 花名册并确认员工身份：

1. 调用花名册查询脚本（机器可读 JSON）：

   ```bash
   python src/scripts/time-tracking/scripts/load_roster.py --json
   ```

   输出示例：`{"status":"ok","total":16,"members":[{"name":"...","biz_line_code":["AIJXC"],"role":"功能测试","active":true}, ...]}`

   脚本执行失败 → 向用户说明「花名册查询失败，请联系管理员确认 MySQL 服务可用」，并终止服务。
2. 向用户提问（**不展示花名册**）：

   ```
   👋 欢迎使用智慧记 AI 进销存测试用例生成助手。请输入你的姓名？
   ```
3. 用户输入姓名后，去除首尾空格，与 `members[*].name` **精确匹配**（`active=true` 成员）
4. **匹配成功** → 确定本次会话的业务线 `{biz_line}`：
   - 读取 `src/scripts/time-tracking/config/time_tracking_config.yaml` 的 `default_biz_line`（已预置「AI进销存」）
   - 若该成员 `biz_line_code` 只对应一条业务线 → 直接使用该业务线
   - 若属于多条业务线 → **列出编号选项让用户输入数字选择**（如 张云星 跨 7 条线），禁止自由文本回答；中文名由编码反查（`AIJXC`→`AI进销存`）。非数字或超范围 → 重新提示，最多 2 次；仍无效则用 `default_biz_line`
   - 缓存姓名+业务线到会话上下文
5. **匹配失败** → 拒绝使用：

   ```
   ❌ 抱歉，"{输入名}"不在测试团队花名册中，你无法使用本助手。
      如需开通权限，请联系管理员通过 sync_roster_to_mysql.py 补登到 agent_team_roster 表。
   ```

   不提供「仍以该姓名继续」选项，直接终止。

### 3. 定时任务自动注册（v5.3 起 AI 自动完成）

MySQL 配置就绪后，AI **自动检查并注册**本机「定时同步」计划任务（Windows 任务计划程序），**无需测试人员手动打开 CMD**：

1. 检查是否已注册（任一时间点任务存在即可）：

   ```bash
   schtasks /query /tn "AI进销存时间同步-午" 2>&1
   ```

2. **不存在** → AI 自动注册早/午/晚三个每日任务（`<scripts目录>` 换成实际绝对路径，如 `...\testcase-generation-skills\src\scripts\time-tracking\scripts`）：

   ```bat
   schtasks /create /tn "AI进销存时间同步-早" /tr "<scripts目录>\sync_task.bat" /sc daily /st 09:00 /f
   schtasks /create /tn "AI进销存时间同步-午" /tr "<scripts目录>\sync_task.bat" /sc daily /st 12:00 /f
   schtasks /create /tn "AI进销存时间同步-晚" /tr "<scripts目录>\sync_task.bat" /sc daily /st 18:00 /f
   ```

3. **已存在** → 跳过，直接进入用户故事收集。
4. **注册失败**（权限不足 / schtasks 被禁用）→ 提示测试人员以管理员身份运行注册命令（见 §六手动备选），不阻塞其余流程。

> `sync_task.bat` 已内置 Python 自动探测 + GBK/CRLF 编码修复，且顶部已预置 `set BIZ_LINE=AI进销存`，测试人员无需改任何配置。

### 4. 用户故事收集（Fast Path 触发时）

身份确认后，若用户触发用例生成流程（Fast Path），**在 Stage0 前后**收集**用户故事编号 + 名称**：

```
📋 请提供本需求的用户故事编号和名称（用于效能统计与平台导入关联），如：PRJ-00758363 优化分类下搜索商品逻辑
```

规则：

- **编号 + 名称一起收**：`user_story` = `PRJ-xxxxxxx {需求名称}`（record 脚本会自动提取 `PRJ-` 编号到 `user_story_code` 字段）
- URL 非必需（本套件不以 URL 为前提）；用户只给编号不给名称 → 追问名称；只给名称 → 追问编号（如确实暂无编号，记 `待补-PRJ {名称}`，后续可换）
- **仅存会话缓存**，不写入工作区目录名 / `session_info.json`（不违反 Stage0「禁止故事编号作工作区主键」的规则）
- 该编号同时作为 Stage5 平台导入 `--prj` 的默认值（用户另行指定时以用户为准，并回填缓存）
- **周迭代**：每个子需求 = 独立用户故事；切换到下一个子需求时**必须更新缓存**的故事编号+名称，并提示用户确认
- 首次时间追踪时若尚未收集，在 01 步首次询问中一并补问（见第四节话术）

---

## 二、追踪的步骤（与套件 Fast Path 环节一一对应）

| 步骤代码 | 步骤名称 | 追踪时机（套件环节） |
|---------|---------|---------------------|
| 01 | 文档整理 | **人审①**（产品/版本/端确认）approve 后 —— 对应 Stage1 下载 + 1CTX |
| 02 | 需求评审 | **人审①′**（需求点确认）approve 后 —— 对应 Stage1A 需求点提取 |
| 04 | 生成测试点 | **人审②**（测试点确认）approve 后 —— 对应 Stage3A/3B |
| 06 | 用例细化 | **Stage4** 用例交付（用户回复「无需修改 / 可以了」）后 |
| 07 | 知识入库 | **Stage5** 平台导入（P0 Excel 导出、DevOps 导入完成）后 |

> KB extract（Stage3A 前的知识库检索）是「读」知识库，不追踪；「补充知识库」（stage_kb_ingest）为独立旁路，不追踪。
> 跳过的环节不追踪（如用户「只要测试点」→ 只收集 01/02/04；未走 Stage5 → 不收集 07）。

---

## 三、参考时间表

每步完成后展示给员工参考，员工可采纳或自行反馈：

| 步骤 | 参考范围 | 说明 |
|------|---------|------|
| 文档整理 | 2~4 小时 | 按文档数量浮动，5个以上取上限 |
| 需求评审 | 2~3 小时 | 6维度评审（完整性/一致性/边界/异常/优先级/可测性） |
| 生成测试点 | 3~5 小时 | 按需求复杂度浮动，多系统交互取上限 |
| 用例细化 | 4~8 小时 / 0.5~1 人天 | 按用例数量浮动，100条以上取上限 |
| 知识入库 | 1~2 小时 | 本套件对应 Stage5：P0 用例整理导出 + DevOps 平台导入归档 |

> 参考时间基于历史经验估算，仅供员工参考。员工最清楚自己实际省了多少时间。

---

## 四、每步完成后的执行流程（强制，不可跳过）

> 时机：**环节 approve / 交付确认之后、进入下一环节之前**。时间追踪不阻塞已 approve 的环节本身，
> 但未完成收集不得推进下一环节。

### 第 1 步：通报完成 + 展示参考时间 + 强制询问

每完成一个追踪环节后，在通报产出物的同时，**必须**追加以下询问：

**首次询问（用户故事未缓存时）**：

```
✅ 环节【{环节名，如：人审① 上下文确认（文档整理）}】已完成。

📊 效能追踪（必填）：这一步为你节省了多少时间？
   参考值：约 {min}~{max} {unit}（{basis}）

   👤 员工：{会话缓存的员工姓名}
   📋 用户故事：___（请输入用户故事编号+名称，如 PRJ-00758363 优化分类下搜索商品逻辑）
   ⏱️ 节省时间：___
      - 回复"采纳"→ 使用参考值上限
      - 或直接输入，如"4小时""0.5人天""1.5人天"

   ⚠️ 此项为必填，不可跳过。这是衡量助手价值的关键数据。
```

**后续环节（用户故事已缓存）**：

```
✅ 环节【{环节名}】已完成。

📊 效能追踪（必填）：这一步节省了多少时间？
   参考值：约 {min}~{max} {unit}（{basis}）

   👤 员工：{缓存的员工}
   📋 用户故事：{缓存的故事}（如需更换请回复"新故事：PRJ-xxx 名称"）
   ⏱️ 节省时间：___
      - 回复"采纳"→ 使用参考值上限
      - 或直接输入，如"3小时""0.5人天"

   ⚠️ 此项为必填，不可跳过。
```

### 第 2 步：解析用户回复

- "采纳" → 使用参考时间上限值（max_hours）
- "4个小时" / "4小时" / "4h" → hours=4.0
- "0.5人天" / "半天" → person_days=0.5（换算 4.0 小时存储）
- "一天" / "1人天" → person_days=1.0（换算 8.0 小时存储）
- "1.5天" / "1.5人天" → person_days=1.5（换算 12.0 小时存储）
- "3.5" → 默认小时，hours=3.5
- "新故事：PRJ-xxx 名称" → 更新缓存的用户故事，继续等待时间输入
- 用户拒绝填写 → 再次强调必填，最多追问 2 次，仍拒绝则记录 time_saved_hours=0, remark="用户未反馈"

> **单位换算规则**：无论输入小时还是人天，**底层存储统一为小时**（1 人天 = 8 小时）。

### 第 3 步：二次确认（不可跳过）

解析出时间数据后，**必须**展示确认信息并等待回复：

```
📋 请确认以下时间节省数据是否准确：

   👤 员工：{员工姓名}
   📋 用户故事：{用户故事}
   📝 步骤：{步骤名称}（{步骤代码}）
   ⏱️ 节省时间：{输入值}（换算 {hours} 小时 / {person_days} 人天）
   💬 备注：{备注，如有}

   确定准确并提交？请回复"确定"或"确认"以提交，或回复修改内容。
```

- "确定" / "确认" / "对" / "yes" / "y" → 执行第 4 步保存
- 回复修改内容（如"改为5小时"）→ 重新解析，再次确认
- "取消" / "不要了" → 不保存，标注「用户取消记录」，继续推进工作流
- **不确认不保存**：用户未明确确认前，禁止调用记录脚本

### 第 4 步：写入本地 JSONL（兜底，主流程）

用户确认后，在**套件根目录**执行：

```bash
python src/scripts/time-tracking/scripts/record_time_saved.py \
  --employee "{员工姓名}" \
  --user-story "{PRJ-xxxxxxx 需求名称}" \
  --step "{步骤名称}" \
  --step-code "{步骤代码}" \
  --hours {小时数} \
  --biz-line "{biz_line}" \
  --remark "{备注，可选}"
```

> 可省略 `--biz-line`（脚本自动读 config 的 `default_biz_line`）。用户用人天则用 `--person-days` 代替 `--hours`。
> **记录环节只写本地，不调用任何网络接口，永不失败**。MySQL 同步由定时任务完成，
> **AI 在记录环节不需要、也不应该直接调用 `sync_to_mysql.py`**。

### 第 5 步：确认记录

只给一行结论，不解释脚本、存储文件、同步机制等技术细节：

```
✅ 已记录：{员工} / {用户故事} / {步骤名称}：节省 {person_days} 人天（{hours} 小时）。
```

---

## 五、生成分析报告

### 触发条件

用户说「查看时间统计」「时间节省分析」「时间报告」「查看时间节省统计」「效能统计」「节省了多少时间」「工时统计」「我的时间统计」「个人时间报告」任一即触发。

> 触发后必须按完整流程执行：**读取数据 → 识别报告范围 → 生成 HTML 报告 → 按宿主环境展示 → 回复中给出本地完整路径与关键数字**。

### 报告范围识别（先做）

| 查看者角色 | 报告范围 | 脚本参数 | 文件名 |
|-----------|---------|---------|--------|
| **测试人员**（普通员工） | 个人历史累计（所有故事、所有步骤） | `--person "{姓名}"` | `time_analytics_{biz_line}_{姓名}.html` |
| **管理员**（role: admin） | 当前业务线所有人员汇总 | 不传 `--person` | `time_analytics_{biz_line}.html` |

### 生成命令（套件根目录）

```bash
# 测试人员（个人报告）
python src/scripts/time-tracking/scripts/generate_time_analytics.py --biz-line "{biz_line}" --person "{姓名}"
# 管理员（业务线报告）
python src/scripts/time-tracking/scripts/generate_time_analytics.py --biz-line "{biz_line}"
```

数据始终从本地 JSONL（`~/.workbuddy/data/time-tracking/{biz_line}/records.jsonl`）读取，最完整最实时。

### 展示方式（宿主无关）

| 宿主环境 | 展示方式 |
|---------|---------|
| **WorkBuddy**（智慧记 AI 进销存专家） | 调用 `present_files` 工具，右侧面板打开 HTML 预览，回复中附本地完整路径 |
| **IDE**（VSCode / OpenCode / Claude Code 等） | 回复中给出报告文件完整本地路径，提示用浏览器打开 |

> 两种环境都**必须完成**：① 生成 HTML 报告文件；② 按宿主方式展示；③ 回复中附本地完整路径；④ 给出关键数字（以人天为主）。四者缺一不可，**禁止只以聊天表格播报数字**。

CSV 导出：`python src/scripts/time-tracking/scripts/generate_time_analytics.py --biz-line "{biz_line}" --format csv`

---

## 六、MySQL 集中存储与定时任务（部署时一次性配置）

### 同步原理

```
你反馈时间 → 本地 records.jsonl → 定时任务(每日 09:00 / 12:00 / 18:00) 幂等同步 → 共享 MySQL agent_time_tracking
```

- 同步幂等 upsert（唯一键 `record_key`），重复跑不产生重复数据
- 记录自动携带 `user_story_code`（如 `PRJ-00769736`），便于按故事维度统计

### 定时任务注册（v5.3 起 AI 自动完成，手动方式仅作备选）

> **正常情况下由 AI 自动完成**：会话启动检测到未注册 → 自动 `schtasks /create` 注册早/午/晚三任务（见 §一第 3 点）。
> 以下为手动备选方式，仅在 AI 无法自动完成（如权限不足）或管理员排查时使用：

以管理员身份打开 CMD（把 `<scripts目录>` 换成实际部署路径，如 `C:\...\testcase-generation-skills\src\scripts\time-tracking\scripts`）：

```bat
schtasks /create /tn "AI进销存时间同步-早" /tr "<scripts目录>\sync_task.bat" /sc daily /st 09:00 /f
schtasks /create /tn "AI进销存时间同步-午" /tr "<scripts目录>\sync_task.bat" /sc daily /st 12:00 /f
schtasks /create /tn "AI进销存时间同步-晚" /tr "<scripts目录>\sync_task.bat" /sc daily /st 18:00 /f
```

> `sync_task.bat` 顶部已预置 `set BIZ_LINE=AI进销存`，并内置 Python 自动探测 + GBK/CRLF 编码修复。
> 查看：`schtasks /query /tn "AI进销存时间同步-午"`；删除：`schtasks /delete /tn "..." /f`。

### 手动同步 / 验证（可选）

用户说「同步到数据库」/「同步时间数据」时：

```bat
python src/scripts/time-tracking/scripts/sync_to_mysql.py --biz-line AI进销存 --dry-run
python src/scripts/time-tracking/scripts/sync_to_mysql.py --biz-line AI进销存
```

### 常见问题

| 现象 | 处理 |
|------|------|
| 提示「配置文件不存在」 | 正常流程：会话启动时 AI 自动生成全空模板 + notes，按备注本地填写 |
| 新电脑没有 mysql_config.json | 正常：本机私有配置不随 Skill 分发，AI 首次使用自动引导 |
| 同步报「无法连接 MySQL」 | 检查网络到 host/port 的连通性与密码 |
| 忘记数据库密码 | 联系管理员获取，密码不随 Skill 分发 |

---

## 七、数据存储

### 本地存储（始终启用，唯一数据源）

```
~/.workbuddy/data/time-tracking/AI进销存/
├── records.jsonl                  # 原始记录（每行一条）
├── mysql_config.json              # MySQL 连接配置（本机私有，含密码！）
├── time_analytics_AI进销存.html   # HTML 分析报告
└── time_analytics_AI进销存.csv    # CSV 导出（按需生成）
```

### 数据格式（每条记录，存储单位统一为小时）

```json
{
  "timestamp": "2026-08-19T17:24:07+08:00",
  "date": "2026-08-19",
  "biz_line": "AI进销存",
  "employee": "{员工姓名}",
  "user_story": "PRJ-00758363 优化分类下搜索商品逻辑",
  "user_story_code": "PRJ-00758363",
  "step": "文档整理",
  "step_code": "01",
  "time_saved_hours": 4.0,
  "time_saved_pd": 0.5,
  "total_hours": 4.0,
  "remark": "原本需手动整理5个文档"
}
```

---

## 八、约束

1. **强制反馈**：每个追踪环节完成后必须收集，不允许跳过；拒绝时最多追问 2 次，仍拒绝记录 0 并标注「用户未反馈」。
2. **二次确认**：解析后必须展示确认，明确回复「确定」才保存。不确认不保存。
3. **不阻塞主流程**：用户拒绝反馈或取消记录，仍正常推进 Fast Path 下一环节。
4. **不伪造**：禁止 AI 自行估算时间，必须由用户提供；参考时间仅展示不自动填入。
5. **身份必选且严格校验**：会话开始必须盲输入+花名册精确匹配；不展示列表、无 fallback、失败直接拒绝。
6. **会话缓存**：员工姓名、业务线、用户故事（编号+名称）会话内缓存；周迭代切换子需求必须更新故事缓存。
7. **业务线隔离**：所有记录使用身份确认环节确定的 `biz_line`（默认「AI进销存」）。
8. **统一存储单位**：底层小时（1人天=8小时），报告以人天为主。
9. **本地优先**：记录只写本地 JSONL，MySQL 同步由定时任务完成；AI 不主动调用同步脚本（用户明确要求除外）。
10. **报告必生成必展示**：查看统计时必须同时完成 ① 生成 HTML；② 按宿主展示（WorkBuddy `present_files` / IDE 给路径）；③ 回复附本地完整路径；④ 关键数字（人天为主）。缺任一项禁止发送最终回复。
11. **MySQL 初始化自动完成 + 花名册实时查 MySQL**：检测 `mysql_config.json` 缺失 → 自动生成全空模板（不在对话索要密码）；身份识别一律 `load_roster.py --json` 查 MySQL，禁止读 `team_roster.yaml` 匹配。
12. **嵌入版边界**：时间追踪挂在环节 approve/交付**之后**；跳过的环节不追踪；故事编号仅用于时间追踪与 Stage5 PRJ 关联，不作工作区主键、不写入 session_info。
