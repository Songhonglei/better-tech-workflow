#!/usr/bin/env bash
# hn-nurture 个人档案配置脚本
#
# 用法:
#   bash scripts/setup_profile.sh                  # 交互式配置（首次/重新配置）
#   bash scripts/setup_profile.sh --show           # 查看当前生效配置 + 来源
#   bash scripts/setup_profile.sh --path           # 打印 profile 路径
#   bash scripts/setup_profile.sh --non-interactive # CI 模式，从已有环境变量读取
#
# 配置存放位置（优先级）:
#   $XDG_CONFIG_HOME/hn-nurture/profile.env  →  ~/.config/hn-nurture/profile.env
#
# 放在用户 HOME 而非 skill 目录的原因:
#   - skill 升级/重装不丢配置
#   - 配置含个人身份信息，不随 skill 进 git

set -euo pipefail

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/hn-nurture"
PROFILE="$CONFIG_DIR/profile.env"

# ---------- 默认值（用户可直接回车接受） ----------
DEFAULT_TOPIC_DIRECTIONS="AI coding,教育,企业软件,CRM,个人成长,软件开发"
DEFAULT_TOPIC_STRONG="企业软件,CRM,AI coding,软件开发"
DEFAULT_TOPIC_WEAK="教育,个人成长"
DEFAULT_TOPIC_AVOID="泛技术怀旧（复古硬件/老游戏/老式计算机）"

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
}

profile_path() { echo "$PROFILE"; }

show_profile() {
  echo "profile 路径: $PROFILE"
  if [[ -f "$PROFILE" ]]; then
    echo "--- 当前配置 ---"
    # 脱敏展示：用户名只显示首尾字符
    while IFS='=' read -r k v; do
      [[ -z "${k:-}" || "$k" =~ ^# ]] && continue
      if [[ "$k" == "HN_USERNAME" && -n "${v:-}" ]]; then
        local masked
        if (( ${#v} <= 2 )); then masked="***"; else masked="${v:0:1}***${v: -1}"; fi
        echo "  $k=$masked (len=${#v})"
      else
        echo "  $k=$v"
      fi
    done < "$PROFILE"
  else
    echo "  (未配置，运行 bash scripts/setup_profile.sh 创建)"
  fi

  echo "--- 环境变量覆盖 ---"
  local found=0
  for var in HN_USERNAME USER_ROLE USER_EXPERTISE TOPIC_DIRECTIONS TOPIC_STRONG TOPIC_WEAK TOPIC_AVOID; do
    if [[ -n "${!var:-}" ]]; then echo "  $var (env) 已设置"; found=1; fi
  done
  (( found == 0 )) && echo "  (无)"
}

write_profile() {
  mkdir -p "$CONFIG_DIR"
  cat > "$PROFILE" <<EOF
# hn-nurture 个人档案
# 生成时间: $(date '+%Y-%m-%d %H:%M:%S')
# 本文件含个人身份信息，位于用户 HOME，不随 skill 进 git。
# 修改后即时生效（下次 agent 读取时自动应用）。

# ---- HN 账号 ----
# 你的 Hacker News 用户名，用于 threads 页与可见性检测
HN_USERNAME=$HN_USERNAME

# ---- 职业背景 ----
# 职位角色，用于判断哪些话题你能写第一手经验
USER_ROLE=$USER_ROLE
# 专业领域（用斜杠分隔，写你真正做过的方向）
USER_EXPERTISE=$USER_EXPERTISE

# ---- 选题方向（逗号分隔）----
# 全部允许的方向
TOPIC_DIRECTIONS=$TOPIC_DIRECTIONS
# 强优势区：能写一手经验，优先选这些
TOPIC_STRONG=$TOPIC_STRONG
# 需谨慎：必须挂具体亲历场景，否则易出空话
TOPIC_WEAK=$TOPIC_WEAK
# 明确排除的方向
TOPIC_AVOID=$TOPIC_AVOID
EOF
  chmod 600 "$PROFILE"
  echo ""
  echo "✅ 已写入: $PROFILE (权限 600)"
}

prompt() {
  # prompt <变量名> <提示语> <默认值>
  local varname="$1" desc="$2" default="$3"
  local input
  printf '%s\n' "$desc"
  if [[ -n "$default" ]]; then
    read -r -p "  > [默认: $default] " input
  else
    read -r -p "  > " input
  fi
  input="${input:-$default}"
  # 清洗：去掉换行与危险字符
  input="$(printf '%s' "$input" | tr -d '\n\r' | sed 's/[;`$"\\]//g' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  printf -v "$varname" '%s' "$input"
}

interactive() {
  echo "=== hn-nurture 个人档案配置 ==="
  echo "这些信息用于让 agent 判断「哪些 HN 帖子你能写第一手经验」。"
  echo "直接回车可接受默认值。所有内容只存在你本机 $PROFILE"
  echo ""

  prompt HN_USERNAME  "1/7 你的 HN 用户名（如 johndoe）:" ""
  prompt USER_ROLE    "2/7 你的职位角色（如「后端工程师」「产品经理」「SRE」）:" ""
  prompt USER_EXPERTISE "3/7 你的专业领域（斜杠分隔，如「企业软件 / CRM / AI+财务流程」）:" ""
  prompt TOPIC_DIRECTIONS "4/7 选题方向全集（逗号分隔）:" "$DEFAULT_TOPIC_DIRECTIONS"
  prompt TOPIC_STRONG     "5/7 强优势方向（能写一手经验，优先选）:" "$DEFAULT_TOPIC_STRONG"
  prompt TOPIC_WEAK       "6/7 需谨慎方向（必须挂具体经历）:" "$DEFAULT_TOPIC_WEAK"
  prompt TOPIC_AVOID      "7/7 排除的方向:" "$DEFAULT_TOPIC_AVOID"

  if [[ -z "$HN_USERNAME" ]]; then
    echo "⚠️  HN 用户名为空，flag 自检将无法定位你的评论。" >&2
  fi

  write_profile
  echo ""
  echo "配置完成。可运行 --show 查看（用户名脱敏展示）。"
}

non_interactive() {
  HN_USERNAME="${HN_USERNAME:-}"
  USER_ROLE="${USER_ROLE:-}"
  USER_EXPERTISE="${USER_EXPERTISE:-}"
  TOPIC_DIRECTIONS="${TOPIC_DIRECTIONS:-$DEFAULT_TOPIC_DIRECTIONS}"
  TOPIC_STRONG="${TOPIC_STRONG:-$DEFAULT_TOPIC_STRONG}"
  TOPIC_WEAK="${TOPIC_WEAK:-$DEFAULT_TOPIC_WEAK}"
  TOPIC_AVOID="${TOPIC_AVOID:-$DEFAULT_TOPIC_AVOID}"
  write_profile
}

case "${1:-}" in
  --show)             show_profile ;;
  --path)             profile_path ;;
  --non-interactive)  non_interactive ;;
  -h|--help)          usage ;;
  "")                 interactive ;;
  *)                  echo "未知参数: $1"; usage; exit 1 ;;
esac
