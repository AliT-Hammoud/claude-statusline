#!/bin/bash
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name')
DIR=$(echo "$input" | jq -r '.workspace.current_dir')
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
DURATION_MS=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')
FIVE_H=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
WEEK=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
FIVE_H_RESET=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
WEEK_RESET=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')
VERSION=$(echo "$input" | jq -r '.version // empty')
ACCOUNT_EMAIL="aliosdeveloper@gmail.com"

CYAN='\033[36m'; GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; MAGENTA='\033[35m'; RESET='\033[0m'

# Context window bar color
if [ "$PCT" -ge 90 ]; then BAR_COLOR="$RED"
elif [ "$PCT" -ge 70 ]; then BAR_COLOR="$YELLOW"
else BAR_COLOR="$GREEN"; fi

FILLED=$((PCT / 10)); EMPTY=$((10 - FILLED))
printf -v FILL "%${FILLED}s"; printf -v PAD "%${EMPTY}s"
BAR="${FILL// /█}${PAD// /░}"

MINS=$((DURATION_MS / 60000)); SECS=$(((DURATION_MS % 60000) / 1000))

BRANCH=""
if git --no-optional-locks rev-parse --git-dir > /dev/null 2>&1; then
  BRANCH_NAME=$(git --no-optional-locks branch --show-current 2>/dev/null)
  DIRTY=""
  [ -n "$(git --no-optional-locks status --porcelain 2>/dev/null)" ] && DIRTY="*"
  BRANCH=" | 🌿 ${BRANCH_NAME}${DIRTY}"
fi

# Helper: build a 10-char progress bar for a percentage value
make_bar() {
  local val=$(printf '%.0f' "$1")
  local filled=$((val / 10)); local empty=$((10 - filled))
  printf -v f "%${filled}s"; printf -v e "%${empty}s"
  echo "${f// /█}${e// /░}"
}

# Rate limit color picker
rate_color() {
  local val=$(printf '%.0f' "$1")
  if [ "$val" -ge 90 ]; then echo "$RED"
  elif [ "$val" -ge 70 ]; then echo "$YELLOW"
  else echo "$GREEN"; fi
}

# Compute human-readable time remaining from a Unix epoch timestamp (hours/minutes)
time_until() {
  local ts="$1"
  [ -z "$ts" ] && return
  local now diff
  now=$(date +%s)
  diff=$((ts - now))
  [ "$diff" -le 0 ] && echo "now" && return
  local h=$((diff / 3600)); local m=$(((diff % 3600) / 60))
  if [ "$h" -gt 0 ]; then echo "${h}h ${m}m"
  else echo "${m}m"; fi
}

# Compute human-readable time remaining, using days when >= 24h
time_until_long() {
  local ts="$1"
  [ -z "$ts" ] && return
  local now diff
  now=$(date +%s)
  diff=$((ts - now))
  [ "$diff" -le 0 ] && echo "now" && return
  local total_h=$((diff / 3600)); local m=$(((diff % 3600) / 60))
  if [ "$total_h" -ge 24 ]; then
    local d=$((total_h / 24)); local h=$((total_h % 24))
    echo "${d}d ${h}h ${m}m"
  elif [ "$total_h" -gt 0 ]; then echo "${total_h}h ${m}m"
  else echo "${m}m"; fi
}

VER_STR=""
[ -n "$VERSION" ] && VER_STR=" ${CYAN}v${VERSION}${RESET}"
echo -e "${CYAN}[$MODEL]${RESET}${VER_STR} 📁 ${DIR##*/}$BRANCH | ${MAGENTA}✉ ${ACCOUNT_EMAIL}${RESET}"
COST_FMT=$(printf '$%.2f' "$COST")
echo -e "ctx ${BAR_COLOR}${BAR}${RESET} ${PCT}% | ${YELLOW}${COST_FMT}${RESET} | ⏱️ ${MINS}m ${SECS}s"

if [ -n "$FIVE_H" ] || [ -n "$WEEK" ]; then
  RATE_LINE=""
  if [ -n "$FIVE_H" ]; then
    FH_BAR=$(make_bar "$FIVE_H")
    FH_PCT=$(printf '%.0f' "$FIVE_H")
    FH_COLOR=$(rate_color "$FIVE_H")
    FH_TIME=$(time_until "$FIVE_H_RESET")
    FH_TIME_STR=""
    [ -n "$FH_TIME" ] && FH_TIME_STR=" ⏳ ${FH_TIME}"
    RATE_LINE="5h: ${FH_COLOR}${FH_BAR}${RESET} ${FH_PCT}%${FH_TIME_STR}"
  fi
  if [ -n "$WEEK" ]; then
    WK_BAR=$(make_bar "$WEEK")
    WK_PCT=$(printf '%.0f' "$WEEK")
    WK_COLOR=$(rate_color "$WEEK")
    WK_TIME=$(time_until_long "$WEEK_RESET")
    WK_TIME_STR=""
    [ -n "$WK_TIME" ] && WK_TIME_STR=" ⏳ ${WK_TIME}"
    [ -n "$RATE_LINE" ] && RATE_LINE="$RATE_LINE | 7d: "
    [ -z "$RATE_LINE" ] && RATE_LINE="7d: "
    RATE_LINE="${RATE_LINE}${WK_COLOR}${WK_BAR}${RESET} ${WK_PCT}%${WK_TIME_STR}"
  fi
  echo -e "$RATE_LINE"
fi
