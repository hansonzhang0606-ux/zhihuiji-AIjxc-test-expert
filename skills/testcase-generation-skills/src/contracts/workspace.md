# 工作区目录约定（Demand 6.0 / FOUND-03，目录修订）

## 1. 工程对外布局

```
testcase-generation-skills/
├── README.md               # 着陆索引
├── bootstrap.md            # 无记忆冷启动
├── skill.md
├── output/                 # ★ 生成产物基目录（替代 code/）
├── skills/
└── src/                    # 规格与脚本（本文件位于 src/contracts/）
```

## 2. 原则

1. 工作区目录名 = 需求文档 title（清洗后）。
2. 工作区创建在 **`testcase-generation-skills/output/`** 下：
   - 标题以 `v4.6.0` / `V4.6.0` 等形式**开头** → `output/v4.6.0/{title}/`（版本目录名统一小写 `v` + `x.y.z`）
   - 标题**无**版本前缀 → `output/{title}/`
3. 工作区内 `input/` 与 `output/` 平级；`script/` 收纳中间产物。
4. 工作区内 `output/` 只放交付用 `*.xmind`；`input/` 子目录中文命名。
5. **周迭代**总览页（标题含「周迭代」）：须拆成子需求 `v4.6.0_周迭代_{需求名称}`，逐个建工作区（见 `stages/stage0_weekly_iteration.md`）。

运行时创建工具：`src/scripts/lib/workspace.js`（默认 `--output-dir` = 工程根 `output/`；版本路径由 `naming.resolveWorkspaceRelPath` 计算）。

## 3. 单需求工作区树

```
{PROJECT}/output/
├── v4.6.0/                          # ★ 版本维度目录（标题有版本前缀时）
│   └── {requirementTitle}/
│       ├── input/
│       │   ├── 需求文档/
│       │   ├── 技术文档/
│       │   └── 历史文档参考/
│       ├── output/
│       │   ├── 需求点_{title}.xmind
│       │   ├── 测试点_{title}.xmind
│       │   ├── 测试用例_{title}.xmind
│       │   └── 技术改动_{title}.xmind   # 可选
│       └── script/
│           ├── config/
│           ├── stage1/ … stage4/
│           └── …
└── {requirementTitle}/              # 标题无版本前缀时，直接落在 output/ 下
    └── input/ | output/ | script/
```

模板统一：`testcase-generation-skills/src/templates/`（只读，不复制进工作区）。

`script/config/path_mode.json`：`{ "mode": "fast"|"full", "schema_version": "6.0", "flags": {} }`，默认 `fast`。

`session_info.json` 可含：`version_folder`、`workspace_rel`、`is_weekly_iteration`。

## 4. CLI

```bash
cd src/scripts
node lib/workspace.js --create --title "客户来源调研弹窗" [--path-mode fast|full]
# 默认落到 ../../output/客户来源调研弹窗/

node lib/workspace.js --assert-root --project-dir ../../output/客户来源调研弹窗 --title "客户来源调研弹窗"
```
