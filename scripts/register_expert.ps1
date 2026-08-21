# 智慧记AI进销存测试专家 - 安装后注册脚本（健壮版 v2）
# 用途：将 zhihuiji-aijxc-test-expert 套件注册为 WorkBuddy 专家
# 使用方法：双击 register_expert.bat，或右键本文件 ->"使用 PowerShell 运行"
# 改进点（相对 v1）：
#   - 第4步源目录搜索改为「按 plugin.json 的 name 字段递归匹配」，兼容以下任意布局：
#       * 团队市场：<market>\plugins\zhihuiji-aijxc-test-expert\
#       * GitHub 缓存：<market>\zhihuiji-aijxc-test-expert\  （包在仓库根）
#       * GitHub 缓存：<market>\plugins\zhihuiji-aijxc-test-expert\
#       * 脚本自身所在仓库：<repo根>\  （用户直接克隆/解压在本地）
#   - 未找到时支持手动输入路径兜底
#   - 第3步套件检查改为仅警告、不阻断（避免误选 n 直接退出）
#   - 已处于 my-experts 目标目录时不重复复制

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  智慧记AI进销存测试专家 - 安装后注册脚本" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 定位 WorkBuddy 主目录
$wbHome = Join-Path $env:USERPROFILE ".workbuddy"
if (-not (Test-Path $wbHome)) {
    Write-Host "[X] 未找到 WorkBuddy 目录: $wbHome" -ForegroundColor Red
    Write-Host "请确认 WorkBuddy 已安装并至少打开过一次。" -ForegroundColor Yellow
    Read-Host "按回车键退出"
    exit 1
}
Write-Host "[1/5] WorkBuddy 目录: $wbHome" -ForegroundColor Green

# 2. 获取用户 ID
$userId = $null

# 方式 A：从 sessions.json 获取
$sessionsPath = Join-Path $wbHome "app\sessions.json"
if ((-not $userId) -and (Test-Path $sessionsPath)) {
    try {
        $sessions = Get-Content $sessionsPath -Encoding UTF8 -Raw | ConvertFrom-Json
        if ($sessions.sessions -and $sessions.sessions.Count -gt 0) {
            foreach ($s in $sessions.sessions) {
                if ($s.userId) {
                    $userId = $s.userId
                    break
                }
            }
        }
    } catch {
        Write-Host "[!] sessions.json 解析失败，尝试其他方式..." -ForegroundColor Yellow
    }
}

# 方式 B：从 experts/custom 目录中查找已有用户目录
if (-not $userId) {
    $customBase = Join-Path $wbHome "experts\custom"
    if (Test-Path $customBase) {
        $userDirs = Get-ChildItem $customBase -Directory -ErrorAction SilentlyContinue
        if ($userDirs -and $userDirs.Count -gt 0) {
            $userId = $userDirs[0].Name
        }
    }
}

if (-not $userId) {
    Write-Host "[X] 无法自动获取用户 ID。" -ForegroundColor Red
    Write-Host ""
    Write-Host "请手动执行以下步骤：" -ForegroundColor Yellow
    Write-Host "  1. 在 WorkBuddy 中随便发起一个对话（新建会话）"
    Write-Host "  2. 完全退出 WorkBuddy"
    Write-Host "  3. 重新运行本脚本"
    Read-Host "按回车键退出"
    exit 1
}
Write-Host "[2/5] 用户 ID: $userId" -ForegroundColor Green

# 3. 检查套件是否已安装（仅警告，不阻断）
$settingsPath = Join-Path $wbHome "settings.json"
$pluginInstalled = $false
if (Test-Path $settingsPath) {
    try {
        $settings = Get-Content $settingsPath -Encoding UTF8 -Raw | ConvertFrom-Json
        if ($settings.enabledPlugins) {
            foreach ($prop in $settings.enabledPlugins.PSObject.Properties) {
                if ($prop.Name -like "*zhihuiji-aijxc-test-expert*") {
                    $pluginInstalled = $true
                    break
                }
            }
        }
    } catch {}
}

if ($pluginInstalled) {
    Write-Host "[3/5] 套件已安装（enabledPlugins 命中）" -ForegroundColor Green
} else {
    Write-Host "[3/5] 未检测到套件安装记录（不影响注册，继续）" -ForegroundColor Yellow
}

# 4. 定位专家包源目录（健壮搜索）
$expertId = "zhihuiji-aijxc-test-expert"
$marketplacesDir = Join-Path $wbHome "plugins\marketplaces"
$sourceDir = $null

# 4a. 脚本自身所在仓库（scripts/.. 即包根目录）
$scriptPkgRoot = Split-Path $PSScriptRoot -Parent
if (Test-Path (Join-Path $scriptPkgRoot ".codebuddy-plugin\plugin.json")) {
    $sourceDir = $scriptPkgRoot
    Write-Host "      [匹配] 脚本所在仓库根目录" -ForegroundColor DarkGray
}

# 4b. 在 marketplaces 下递归搜索 plugin.json，按 name/id 字段匹配
if (-not $sourceDir) {
    $allPJs = Get-ChildItem $marketplacesDir -Recurse -Filter "plugin.json" -Force -ErrorAction SilentlyContinue
    foreach ($pj in $allPJs) {
        try {
            $pjObj = Get-Content $pj.FullName -Encoding UTF8 -Raw | ConvertFrom-Json
            if ($pjObj.name -eq $expertId -or $pjObj.id -eq $expertId) {
                $sourceDir = Split-Path (Split-Path $pj.FullName -Parent) -Parent
                break
            }
        } catch {}
    }
    if ($sourceDir) {
        Write-Host "      [匹配] marketplaces 递归搜索" -ForegroundColor DarkGray
    }
}

# 4c. 手动输入兜底
if (-not $sourceDir) {
    Write-Host "[!] 未能自动定位专家包。" -ForegroundColor Yellow
    $manual = Read-Host "请手动输入专家包目录（含 .codebuddy-plugin\plugin.json 的文件夹）路径"
    if ($manual -and (Test-Path (Join-Path $manual ".codebuddy-plugin\plugin.json"))) {
        $sourceDir = $manual
        Write-Host "      [匹配] 手动指定路径" -ForegroundColor DarkGray
    }
}

if (-not $sourceDir) {
    Write-Host "[X] 仍未找到 $expertId 专家包，注册中止。" -ForegroundColor Red
    Write-Host "    请确认已安装/加载套件，或手动指定正确路径。" -ForegroundColor Yellow
    Read-Host "按回车键退出"
    exit 1
}
Write-Host "[4/5] 找到专家包源: $sourceDir" -ForegroundColor Green

# 部署到 my-experts 市场
$myExpertsDir = Join-Path $marketplacesDir "my-experts"
$destDir = Join-Path $myExpertsDir "plugins\$expertId"
$destManifestDir = Join-Path $myExpertsDir ".codebuddy-plugin"
$destManifestPath = Join-Path $destManifestDir "marketplace.json"

# 检查目标是否已存在且完整
$needCopy = $true
if (($sourceDir -eq $destDir) -or (Test-Path (Join-Path $destDir ".codebuddy-plugin\plugin.json"))) {
    Write-Host "[4/5] my-experts 市场中已存在专家包" -ForegroundColor Green
    $needCopy = $false
}

if ($needCopy) {
    Write-Host "[4/5] 正在复制专家包到 my-experts 市场..." -ForegroundColor White

    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }

    $excludeDirs = @(".workbuddy", "__pycache__")
    $sourceItems = Get-ChildItem $sourceDir -Recurse -Force
    foreach ($item in $sourceItems) {
        $relativePath = $item.FullName.Substring($sourceDir.Length + 1)
        $skip = $false
        foreach ($ex in $excludeDirs) {
            if ($relativePath -like "*\$ex\*" -or $relativePath -like "$ex\*") {
                $skip = $true
                break
            }
        }
        if ($skip) { continue }

        $destPath = Join-Path $destDir $relativePath
        if ($item.PSIsContainer) {
            if (-not (Test-Path $destPath)) {
                New-Item -ItemType Directory -Path $destPath -Force | Out-Null
            }
        } else {
            $parentDir = Split-Path $destPath -Parent
            if (-not (Test-Path $parentDir)) {
                New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
            }
            Copy-Item $item.FullName $destPath -Force
        }
    }

    Write-Host "      专家包已复制到: $destDir" -ForegroundColor DarkGray
}

# 创建/更新 marketplace.json
$needManifest = $true
if (Test-Path $destManifestPath) {
    try {
        $existingManifest = Get-Content $destManifestPath -Encoding UTF8 -Raw | ConvertFrom-Json
        $found = $false
        foreach ($p in $existingManifest.plugins) {
            if ($p.name -eq $expertId) { $found = $true; break }
        }
        if ($found) { $needManifest = $false }
    } catch {}
}

if ($needManifest) {
    if (-not (Test-Path $destManifestDir)) {
        New-Item -ItemType Directory -Path $destManifestDir -Force | Out-Null
    }

    $pluginJsonPath = Join-Path $destDir ".codebuddy-plugin\plugin.json"
    $pluginDesc = "ZhihuiJi AI-JXC Testing Expert"
    if (Test-Path $pluginJsonPath) {
        try {
            $pj = Get-Content $pluginJsonPath -Encoding UTF8 -Raw | ConvertFrom-Json
            if ($pj.description) { $pluginDesc = $pj.description }
        } catch {}
    }

    $pluginEntry = @{
        name = $expertId
        source = "./plugins/$expertId"
        description = $pluginDesc
    }

    if (Test-Path $destManifestPath) {
        try {
            $manifest = Get-Content $destManifestPath -Encoding UTF8 -Raw | ConvertFrom-Json
            $manifest.plugins = @($manifest.plugins) + @($pluginEntry)
        } catch {
            $manifest = @{
                name = "my-experts"
                description = "my-experts marketplace (auto-generated)"
                plugins = @($pluginEntry)
            }
        }
    } else {
        $manifest = @{
            name = "my-experts"
            description = "my-experts marketplace (auto-generated)"
            plugins = @($pluginEntry)
        }
    }

    $manifestJson = $manifest | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText($destManifestPath, $manifestJson, [System.Text.UTF8Encoding]::new($false))

    Write-Host "      marketplace.json 已创建/更新" -ForegroundColor DarkGray
}

if ($needCopy -or $needManifest) {
    Write-Host "[4/5] 专家包已部署到 my-experts 市场" -ForegroundColor Green
} else {
    Write-Host "[4/5] my-experts 市场配置完整" -ForegroundColor Green
}

# 5. 写入专家注册表
$customDir = Join-Path $wbHome "experts\custom\$userId"
$expertsJsonPath = Join-Path $customDir "experts.json"

$alreadyRegistered = $false
if (Test-Path $expertsJsonPath) {
    try {
        $existing = Get-Content $expertsJsonPath -Encoding UTF8 -Raw | ConvertFrom-Json
        if ($existing -is [string]) {
            $existing = @($existing)
        }
        if ($existing -contains $expertId) {
            $alreadyRegistered = $true
        }
    } catch {}
}

if ($alreadyRegistered) {
    Write-Host "[5/5] 专家已注册，无需重复操作。" -ForegroundColor Green
} else {
    if (-not (Test-Path $customDir)) {
        New-Item -ItemType Directory -Path $customDir -Force | Out-Null
    }

    $expertList = @($expertId)
    if (Test-Path $expertsJsonPath) {
        try {
            $existingList = Get-Content $expertsJsonPath -Encoding UTF8 -Raw | ConvertFrom-Json
            if ($existingList -is [string]) {
                $existingList = @($existingList)
            }
            if ($existingList -and $existingList -notcontains $expertId) {
                $expertList = @($existingList) + @($expertId)
            }
        } catch {}
    }

    if ($expertList.Count -eq 1) {
        $jsonContent = "[`n  `"$expertId`"`n]"
    } else {
        $jsonContent = $expertList | ConvertTo-Json -Depth 5
    }
    [System.IO.File]::WriteAllText($expertsJsonPath, $jsonContent, [System.Text.UTF8Encoding]::new($false))

    Write-Host "[5/5] 专家注册成功！" -ForegroundColor Green
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  注册完成！" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步操作：" -ForegroundColor White
Write-Host "  1. 完全退出 WorkBuddy（托盘图标右键 -> 退出）" -ForegroundColor White
Write-Host "  2. 重新打开 WorkBuddy" -ForegroundColor White
Write-Host "  3. 进入 [专家 技能 链接] -> [专家] -> 右上角 [我的专家]" -ForegroundColor White
Write-Host "  4. 应该能看到 [智慧记AI进销存专家]" -ForegroundColor White
Write-Host ""
Read-Host "按回车键退出"
