#!/bin/bash

# zhihuiji-aijxc-test-expert - Mac Register Script
# Registers the installed zhihuiji-aijxc-test-expert plugin as a WorkBuddy expert
# Usage: chmod +x register_expert.sh && ./register_expert.sh
# Prerequisite: zhihuiji-aijxc-test-expert plugin installed via team marketplace
# NOTE: Do NOT run with sudo - this script writes to your user directory only

set -e

# Color definitions
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
WHITE='\033[0;37m'
NC='\033[0m' # No Color

expert_id="zhihuiji-aijxc-test-expert"

print_header() {
    echo ""
    echo -e "${CYAN}=========================================${NC}"
    echo -e "${CYAN}  智慧记AI进销存测试专家 - 安装后注册脚本${NC}"
    echo -e "${CYAN}=========================================${NC}"
    echo ""
}

print_header

# Detect actual user home directory (even if run with sudo)
if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
    REAL_HOME=$(eval echo "~$SUDO_USER")
elif [ "$(id -u)" = "0" ]; then
    echo -e "${RED}[X] 检测到以 root 权限运行，无法定位用户目录。${NC}"
    echo -e "${YELLOW}请勿使用 sudo 运行本脚本。请直接运行：${NC}"
    echo -e "${WHITE}  chmod +x register_expert.sh && ./register_expert.sh${NC}"
    echo ""
    read -p "按回车键退出"
    exit 1
else
    REAL_HOME="$HOME"
fi

# 1. Locate WorkBuddy home directory
wb_home="${REAL_HOME}/.workbuddy"
if [ ! -d "$wb_home" ]; then
    echo -e "${RED}[X] 未找到 WorkBuddy 目录: $wb_home${NC}"
    echo -e "${YELLOW}请确认 WorkBuddy 已安装并至少打开过一次。${NC}"
    read -p "按回车键退出"
    exit 1
fi
echo -e "${GREEN}[1/5] WorkBuddy 目录: $wb_home${NC}"

# 2. Get user ID
user_id=""
sessions_path="${wb_home}/app/sessions.json"

if [ -z "$user_id" ] && [ -f "$sessions_path" ]; then
    user_id=$(python3 -c "
import json, sys
try:
    with open('$sessions_path', 'r', encoding='utf-8') as f:
        data = json.load(f)
    sessions = data.get('sessions', [])
    for s in sessions:
        if s.get('userId'):
            print(s['userId'])
            sys.exit(0)
except Exception as e:
    sys.exit(1)
" 2>/dev/null || true)
fi

# Method B: find existing user directory from experts/custom
if [ -z "$user_id" ]; then
    custom_base="${wb_home}/experts/custom"
    if [ -d "$custom_base" ]; then
        user_dir=$(find "$custom_base" -maxdepth 1 -type d | tail -n 1)
        if [ "$user_dir" != "$custom_base" ] && [ -n "$user_dir" ]; then
            user_id=$(basename "$user_dir")
        fi
    fi
fi

if [ -z "$user_id" ]; then
    echo -e "${RED}[X] 无法自动获取用户 ID。${NC}"
    echo ""
    echo -e "${YELLOW}请手动执行以下步骤：${NC}"
    echo -e "${WHITE}  1. 在 WorkBuddy 中随便发起一个对话（新建会话）${NC}"
    echo -e "${WHITE}  2. 完全退出 WorkBuddy${NC}"
    echo -e "${WHITE}  3. 重新运行本脚本${NC}"
    read -p "按回车键退出"
    exit 1
fi
echo -e "${GREEN}[2/5] 用户 ID: $user_id${NC}"

# 3. Check if plugin is installed
settings_path="${wb_home}/settings.json"
plugin_installed=false

if [ -f "$settings_path" ]; then
    plugin_check=$(python3 -c "
import json, sys
try:
    with open('$settings_path', 'r', encoding='utf-8') as f:
        data = json.load(f)
    enabled = data.get('enabledPlugins', {})
    key = 'zhihuiji-aijxc-test-expert@zhihuiji-AIjxc-test-expert-marketplace'
    if enabled.get(key) == True:
        print('yes')
    else:
        print('no')
except Exception as e:
    print('error')
" 2>/dev/null || echo "error")

    if [ "$plugin_check" = "yes" ]; then
        plugin_installed=true
    fi
fi

if [ "$plugin_installed" = true ]; then
    echo -e "${GREEN}[3/5] 套件已安装${NC}"
else
    echo -e "${YELLOW}[!] 未检测到已安装的 zhihuiji-aijxc-test-expert 套件。${NC}"
    echo -e "${YELLOW}    请先在 WorkBuddy 中安装套件后再运行本脚本。${NC}"
    read -p "是否仍然继续注册？(y/n) " continue
    if [ "$continue" != "y" ] && [ "$continue" != "Y" ]; then
        read -p "按回车键退出"
        exit 0
    fi
    echo -e "${GREEN}[3/5] 跳过套件检查${NC}"
fi

# 4. Copy expert package to my-experts marketplace
# WorkBuddy's scanCustomExperts only scans the my-experts marketplace directory
# Must copy the expert package from the install marketplace to my-experts
marketplaces_dir="${wb_home}/plugins/marketplaces"

# Find expert package source directory (search all marketplaces)
source_dir=""
for mp_dir in "$marketplaces_dir"/*/; do
    candidate="${mp_dir}plugins/${expert_id}"
    if [ -f "${candidate}/.codebuddy-plugin/plugin.json" ]; then
        source_dir="$candidate"
        break
    fi
done

if [ -z "$source_dir" ]; then
    echo -e "${RED}[X] 未找到 ${expert_id} 专家包。${NC}"
    echo -e "${YELLOW}    请确认已通过团队市场安装套件。${NC}"
    read -p "按回车键退出"
    exit 1
fi

my_experts_dir="${marketplaces_dir}/my-experts"
dest_dir="${my_experts_dir}/plugins/${expert_id}"
dest_manifest_dir="${my_experts_dir}/.codebuddy-plugin"
dest_manifest_path="${dest_manifest_dir}/marketplace.json"

# Check if destination already has plugin.json
need_copy=true
if [ -f "${dest_dir}/.codebuddy-plugin/plugin.json" ]; then
    echo -e "${GREEN}[4/5] my-experts 市场中已存在专家包${NC}"
    need_copy=false
fi

if [ "$need_copy" = true ]; then
    echo -e "${WHITE}[4/5] 正在复制专家包到 my-experts 市场...${NC}"

    # Create destination directory
    mkdir -p "$dest_dir"

    # Copy expert package (excluding .workbuddy/ and __pycache__/)
    # Use rsync if available, otherwise use cp + find
    if command -v rsync &> /dev/null; then
        rsync -a --exclude='.workbuddy/' --exclude='__pycache__/' "$source_dir/" "$dest_dir/"
    else
        # Fallback: cp -r then remove excluded dirs
        cp -R "$source_dir/." "$dest_dir/"
        find "$dest_dir" -name '.workbuddy' -type d -exec rm -rf {} + 2>/dev/null || true
        find "$dest_dir" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true
    fi

    echo -e "${WHITE}      专家包已复制到: $dest_dir${NC}"
fi

# Create/update marketplace.json
need_manifest=true
if [ -f "$dest_manifest_path" ]; then
    manifest_check=$(python3 -c "
import json, sys
try:
    with open('$dest_manifest_path', 'r', encoding='utf-8') as f:
        data = json.load(f)
    for p in data.get('plugins', []):
        if p.get('name') == '$expert_id':
            print('found')
            sys.exit(0)
    print('not_found')
except:
    print('error')
" 2>/dev/null || echo "error")
    if [ "$manifest_check" = "found" ]; then
        need_manifest=false
    fi
fi

if [ "$need_manifest" = true ]; then
    mkdir -p "$dest_manifest_dir"

    python3 -c "
import json, os

manifest_path = '$dest_manifest_path'
expert_id = '$expert_id'
source_dir = '$source_dir'

# Read plugin.json for description
plugin_desc = 'ZhihuiJi AI-JXC Testing Expert'
plugin_json_path = os.path.join(source_dir, '.codebuddy-plugin', 'plugin.json')
if os.path.exists(plugin_json_path):
    try:
        with open(plugin_json_path, 'r', encoding='utf-8') as f:
            pj = json.load(f)
        plugin_desc = pj.get('description', plugin_desc)
    except:
        pass

plugin_entry = {
    'name': expert_id,
    'source': f'./plugins/{expert_id}',
    'description': plugin_desc
}

# Load existing manifest or create new
manifest = None
if os.path.exists(manifest_path):
    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)
    except:
        manifest = None

if manifest is None:
    manifest = {
        'name': 'my-experts',
        'description': 'my-experts marketplace (auto-generated)',
        'plugins': [plugin_entry]
    }
else:
    plugins = manifest.get('plugins', [])
    # Check if already exists
    found = any(p.get('name') == expert_id for p in plugins)
    if not found:
        plugins.append(plugin_entry)
    manifest['plugins'] = plugins

with open(manifest_path, 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
" 2>/dev/null

    if [ $? -eq 0 ]; then
        echo -e "${WHITE}      marketplace.json 已创建/更新${NC}"
    else
        echo -e "${RED}[X] marketplace.json 创建失败${NC}"
        read -p "按回车键退出"
        exit 1
    fi
fi

if [ "$need_copy" = true ] || [ "$need_manifest" = true ]; then
    echo -e "${GREEN}[4/5] 专家包已部署到 my-experts 市场${NC}"
else
    echo -e "${GREEN}[4/5] my-experts 市场配置完整${NC}"
fi

# 5. Write expert registration
custom_dir="${wb_home}/experts/custom/${user_id}"
experts_json_path="${custom_dir}/experts.json"
already_registered=false

if [ -f "$experts_json_path" ]; then
    registered=$(python3 -c "
import json, sys
try:
    with open('$experts_json_path', 'r', encoding='utf-8') as f:
        data = json.load(f)
    if isinstance(data, str):
        data = [data]
    if '$expert_id' in data:
        print('yes')
    else:
        print('no')
except Exception as e:
    print('error')
" 2>/dev/null || echo "error")

    if [ "$registered" = "yes" ]; then
        already_registered=true
    fi
fi

if [ "$already_registered" = true ]; then
    echo -e "${GREEN}[5/5] 专家已注册，无需重复操作。${NC}"
else
    mkdir -p "$custom_dir"

    python3 -c "
import json, os
path = '$experts_json_path'
expert_id = '$expert_id'

existing = []
if os.path.exists(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            existing = json.load(f)
        if isinstance(existing, str):
            existing = [existing]
    except:
        existing = []

if expert_id not in existing:
    existing.append(expert_id)

with open(path, 'w', encoding='utf-8') as f:
    json.dump(existing, f, ensure_ascii=False, indent=2)
" 2>/dev/null

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}[5/5] 专家注册成功！${NC}"
    else
        echo -e "${RED}[X] 专家注册失败，请检查权限或手动创建文件。${NC}"
        read -p "按回车键退出"
        exit 1
    fi
fi

echo ""
echo -e "${CYAN}=========================================${NC}"
echo -e "${GREEN}  注册完成！${NC}"
echo -e "${CYAN}=========================================${NC}"
echo ""
echo -e "${WHITE}下一步操作：${NC}"
echo -e "${WHITE}  1. 完全退出 WorkBuddy（菜单栏图标 -> 退出）${NC}"
echo -e "${WHITE}  2. 重新打开 WorkBuddy${NC}"
echo -e "${WHITE}  3. 进入 [专家 技能 链接] -> [专家] -> 右上角 [我的专家]${NC}"
echo -e "${WHITE}  4. 应该能看到 [智慧记AI进销存专家]${NC}"
echo ""
read -p "按回车键退出"
