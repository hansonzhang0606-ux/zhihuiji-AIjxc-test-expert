# 智慧记AI进销存功能测试专家使用操作手册

> **覆盖**：测试用例生成（Fast Path）+ 时间节省追踪，WorkBuddy 专家 / VSCode·OpenCode 等 IDE 双宿主通用，流程完全一致，仅报告展示方式不同
> **适用对象**：智慧记 AI 进销存（日常称「智慧记星火」，业务线编码 `AIJXC`）功能测试团队
> **套件版本**：testcase-generation-skills **v7.2.0**（已内置时间追踪能力）
> **专家包版本**：**v1.0.1**（2026-08-21 发布：时间追踪配置闭环 ＋ `sync_task.bat` 业务线参数化，内嵌 time-tracking 升级至 v5.5）
> **安装方式**：与「效贷测试专家」完全一致——三步法（添加团队市场 → 安装套件 → 运行注册脚本），详见下方「一、首次使用 → A. WorkBuddy 专家方式」
> **time-tracking-skill.zip 统一存放点（2026-08-20 用户指定）**：`D:\##AI转型\skills\节省工时追踪skill-自己\time-tracking-skill.zip` —— 智慧记星火测试专家每次需要读取/部署时间追踪套件时，**一律从该目录取最新版 zip 包**（固定名覆盖，不读其他散落位置）

---

## 〇、前置环境（两台机器都要满足）

| 依赖 | 要求 | 用途 |
|------|------|------|
| Node.js | 18+ | 用例生成脚本（Stage1/3/4 等） |
| Python | 3.8+ | 时间追踪脚本（record/sync/report） |
| MySQL | 可连通 | 身份识别（查花名册）+ 时间数据集中存储 |
| 已配 MySQL 配置 | 见「首次使用」 | 本机私有，含数据库密码 |

> 时间数据链路：**你反馈 → 本地 JSONL（永不失败）→ 定时任务(每日 09:00/12:00/18:00) 幂等同步 → 共享 MySQL `agent_time_tracking`**。
> 本地 JSONL 是唯一数据源，未联网也不丢数据。

---

## 一、首次使用（一次性配置）

### A. WorkBuddy 专家方式（三步安装法，与效贷测试专家完全一致）

#### 第 1 步：添加团队市场

1. 点击左侧栏「**专家·技能·链接**」
2. 切换到「**技能**」→「**套件**」标签页
3. 点击右上角「**+**」按钮
4. 填写市场源：`hansonzhang0606-ux/zhihuiji-AIjxc-test-expert`
5. 点击提交

> 市场源格式为 **GitHub用户名/仓库名**，不需要带 `https://` 前缀。⚠️ 注意：复制到 WorkBuddy【市场源】文本框后，删除前后的单引号。

#### 第 2 步：安装套件

在「**技能** → 「套件**」页面找到「**zhihuiji-AIjxc-test-expert**」，点击卡片右上角「**+**」安装。

#### 第 3 步：注册专家（重要！）

安装套件后专家不会自动出现，需运行一次注册脚本：

1. 打开 https://github.com/hansonzhang0606-ux/zhihuiji-AIjxc-test-expert/tree/main/scripts
2. 下载注册脚本：
   - **Windows**：下载 `register_expert.bat` 和 `register_expert.ps1`，放到同一目录
   - **Mac**：下载 `register_expert.sh`
3. 运行脚本：
   - **Windows**：双击 `register_expert.bat`
   - **Mac**：终端执行 `chmod +x register_expert.sh && ./register_expert.sh`（不要加 sudo）
4. 看到「**注册完成**」后，**完全退出 WorkBuddy 再重新打开**
5. 进入「**专家·技能·链接**」→「**专家**」→「**我的专家**」，确认看到「**智慧记AI进销存专家**」（即「智慧记AI进销存功能测试专家」）

> 此步骤只需执行一次。脚本会自动完成：复制专家包到 `my-experts` 市场、创建市场清单、写入专家注册记录。

#### 安装完成后首次会话

新建会话，AI 自动执行：

- **MySQL 配置检查**：若本机没有配置，AI 自动生成全空模板（**不会在对话里问你密码**）。v1.0.1 起为**配置闭环**——AI 会强制校验 `AI进销存/mysql_config.json` 是否真实生成，未生成则不进入工作流，避免「假配置」导致时间数据丢失。
- 按提示打开生成的 `mysql_config.notes.md`，把 `host/port/user/password/database/table/charset/biz_line/biz_line_code` 填完整（不清楚找管理员），保存后回复「**已填好**」。
- **身份识别**：AI 会问「请输入你的姓名」——**盲输入姓名即可**，不会展示花名册名单。
- 输入后系统用 MySQL 花名册精确匹配；匹配成功即进入工作流。
- AI 自动完成**定时同步任务注册**（无需手动，见第四节）。

### B. IDE 方式（VSCode / OpenCode / Claude Code 等）

1. 将 `testcase-generation-skills.zip` 解压到本地目录（记为**套件根目录**，如 `D:\tools\testcase-generation-skills`）。
2. 在 `套件根目录/src/scripts/` 下执行 `npm install`（zip 已含 `node_modules`，重装一遍确保平台兼容）。
3. 在 IDE 中让 AI Agent 把 `testcase-generation-skills/skill.md` 作为入口读取。
4. 首次会话与 A 一致：AI 自动生成 MySQL 模板 → 你填好回复「已填好」→ 盲输入姓名完成身份识别。
5. AI 自动完成**定时同步任务注册**（无需手动，见第四节）。

> ⚠️ `mysql_config.json` 含数据库密码，**不随套件分发、不发群、不提交 Git**，每台电脑只需初始化一次。

---

## 二、日常使用流程

### 1. 启动会话

- WorkBuddy：直接对专家说话，如「帮我生成 PRJ-xxxxxxx 优化分类下搜索商品逻辑的测试用例」。
- IDE：在 Agent 对话中输入同样需求。
- 首次触发用例生成时，AI 会收集**用户故事编号 + 名称**（如 `PRJ-00758363 优化分类下搜索商品逻辑`），仅存会话缓存，不写文件。

### 2. 五阶段工作流（Fast Path）

AI 按以下流程推进，**三处人审必须你明确确认才通过，AI 不会自作主张点「通过」**：

| 阶段 | 产出 | 你的动作 |
|------|------|---------|
| Stage1 下载 + 1CTX | 产品/版本/端识别 | ⛔ **人审①**：确认三维对不对 |
| Stage1A 需求点提取 | 需求点 XMind | ⛔ **人审①′**：确认需求点全不全 |
| Stage3A/3B 测试点合成 | 测试点 XMind | ⛔ **人审②**：确认测试点 OK |
| Stage4 用例生成 | 用例 XMind | 预览，说「可以了」即交付 |
| Stage5 平台导入（可选） | P0 Excel → DevOps | 确认导出并导入完成 |

### 3. 每个环节结束后的时间反馈（强制·立即·不可跳过）

每通过一个人审 / 完成一个环节，AI 会**立即**询问「这一步为你节省了多少时间？」——**不会先问「下一步做什么」**，必须先完成时间反馈后才会展示下一步。流程固定 5 步：

1. **通报完成** + 展示参考时间（如「约 2~4 小时」）
2. **你反馈**：直接填「4小时」「0.5人天」「采纳」（采纳=用参考上限）
3. **AI 解析**你的输入（底层统一存小时，1人天=8小时）
4. **二次确认**：AI 展示「员工/故事/步骤/节省时间」，你回「确定」才保存
5. **本地记录**：AI 写入本地 JSONL，回一句「已记录：X 人天（Y 小时）」

> 五个追踪点对应步骤代码：**01 文档整理 / 02 需求评审 / 04 生成测试点 / 06 用例细化 / 07 知识入库**。
> 跳过的环节不追踪（如只要测试点，只收 01/02/04）。**拒绝填写**时 AI 最多追问 2 次，仍拒则记 0 并标注「用户未反馈」，不阻塞主流程。

---

## 三、查看时间统计

对话中说任一句即可触发：**「查看时间统计」「时间报告」「我的时间节省」「效能统计」**。

AI 会：① 生成 HTML 报告（个人/业务线）；② 按宿主展示；③ 回复中附本地完整路径与关键数字（以人天为主）。

- **WorkBuddy**：右侧面板直接打开 HTML 预览。
- **IDE**：回复中给出报告文件路径，用浏览器打开。

报告路径示例：`~/.workbuddy/data/time-tracking/AI进销存/time_analytics_AI进销存_{姓名}.html`

---

## 四、定时同步与数据说明

### 定时任务（AI 自动注册，无需手动）

会话启动时，AI 会**自动检查并注册**本机「定时同步」计划任务（早/午/晚三个，`sync_task.bat` 支持以第 1 个参数 `%1` 指定业务线，不传则默认 `AI进销存`，并内置 Python 自动探测）。仅在 AI 自动注册失败（如权限不足）时，才需你以管理员身份手动执行以下命令（把 `<scripts目录>` 换成实际路径，如 `D:\tools\testcase-generation-skills\src\scripts\time-tracking\scripts`；以下命令不传 `%1`，即默认业务线 `AI进销存`）：

```bat
schtasks /create /tn "AI进销存时间同步-早" /tr "<scripts目录>\sync_task.bat" /sc daily /st 09:00 /f
schtasks /create /tn "AI进销存时间同步-午" /tr "<scripts目录>\sync_task.bat" /sc daily /st 12:00 /f
schtasks /create /tn "AI进销存时间同步-晚" /tr "<scripts目录>\sync_task.bat" /sc daily /st 18:00 /f
```

### 手动同步（可选，你说「同步到数据库」时 AI 会跑）

```bat
python src/scripts/time-tracking/scripts/sync_to_mysql.py --biz-line AI进销存
```

- 同步是**幂等 upsert**（唯一键 `record_key`），重复跑不产生重复数据。
- 记录自动携带 `user_story_code`（如 `PRJ-00758363`），可按故事维度统计。

---

## 五、常见问题

| 现象 | 处理 |
|------|------|
| 套件页面看不到本套件 | 确认已在「技能→套件」标签页添加团队市场 `hansonzhang0606-ux/zhihuiji-AIjxc-test-expert`（不带 https://，复制后删除前后单引号），添加后刷新页面 |
| 安装后「我的专家」里看不到 | 正常！需执行**第3步注册脚本**（下载 scripts 目录下的 register_expert.bat 双击运行），看到「注册完成」后完全退出 WorkBuddy 再重新打开 |
| 提示「配置文件不存在」 | 正常：首次会话 AI 自动生成全空模板 + notes，你按说明本地填好即可 |
| 换电脑 / 新环境 | 正常：MySQL 配置本机私有，AI 首次使用自动引导重新生成；新电脑需重新从团队市场安装专家 |
| 同步报「无法连接 MySQL」 | 检查到 host/port 的网络连通性与密码 |
| 忘记数据库密码 | 联系管理员获取，密码不随套件分发 |
| 周迭代切到下一个子需求 | 反馈时间时回复「新故事：PRJ-xxx 名称」，AI 会更新缓存并确认 |
| 输入姓名提示「不在花名册」 | 联系管理员通过 `sync_roster_to_mysql.py` 补登 `agent_team_roster` 表 |
| 不想填时间 | 可拒绝，AI 记录 0 并标注，不影响用例生成主流程 |

---

## 附：关键路径速查

```
套件根目录/
├── skill.md                          # 编排入口（IDE Agent 读取）
└── src/scripts/
    ├── stage1/ stage3/ stage4/ ...   # 用例生成 Node 脚本
    └── time-tracking/
        ├── prompts/time_tracking.md  # 时间追踪完整规则
        ├── config/time_tracking_config.yaml   # default_biz_line: AI进销存
        └── scripts/
            ├── record_time_saved.py   # 写本地 JSONL（主流程）
            ├── sync_to_mysql.py       # 同步 MySQL（定时任务）
            ├── load_roster.py         # 身份识别查花名册
            ├── init_mysql_config.py   # 生成 MySQL 配置模板
            ├── generate_time_analytics.py  # 生成统计报告
            └── sync_task.bat          # 定时任务入口（已预置 BIZ_LINE=AI进销存 + Python 自动探测）
```

```
本机数据目录（唯一数据源）：
~/.workbuddy/data/time-tracking/AI进销存/
├── records.jsonl          # 原始记录
├── mysql_config.json      # 本机私有配置（含密码！）
└── time_analytics_*.html  # 报告
```
