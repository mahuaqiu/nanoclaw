#!/bin/bash
#
# Prune stale session artifacts (JSONLs, debug logs, todos, telemetry, group logs).
# Safe to run while NanoClaw is live — active sessions are read from the DB.
#
# Usage:  ./scripts/cleanup-sessions.sh [--dry-run]
#
# Retention:
#   Session JSONLs + tool-results:  7 days  (active session always kept)
#   Session IDs in DB:              7 days  (同步清理，与文件保持一致)
#   Debug logs:                     3 days
#   Todo files:                     3 days
#   Telemetry:                      7 days
#   Group logs:                     7 days

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

STORE_DB="$PROJECT_ROOT/store/messages.db"
SESSIONS_DIR="$PROJECT_ROOT/data/sessions"
GROUPS_DIR="$PROJECT_ROOT/groups"

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

TOTAL_FREED=0

log() { echo "[cleanup] $*"; }

remove() {
  local target="$1"
  if $DRY_RUN; then
    if [ -d "$target" ]; then
      size=$(du -sk "$target" 2>/dev/null | cut -f1)
    else
      size=$(wc -c < "$target" 2>/dev/null || echo 0)
      size=$((size / 1024))
    fi
    TOTAL_FREED=$((TOTAL_FREED + size))
    log "would remove: $target (${size}K)"
  else
    if [ -d "$target" ]; then
      size=$(du -sk "$target" 2>/dev/null | cut -f1)
      rm -rf "$target"
    else
      size=$(wc -c < "$target" 2>/dev/null || echo 0)
      size=$((size / 1024))
      rm -f "$target"
    fi
    TOTAL_FREED=$((TOTAL_FREED + size))
  fi
}

# --- Collect active session IDs from the database (with group_folder) ---
# 返回格式: group_folder|session_id

if [ ! -f "$STORE_DB" ]; then
  log "ERROR: database not found at $STORE_DB"
  exit 1
fi

ACTIVE_SESSIONS=$(sqlite3 "$STORE_DB" "SELECT group_folder, session_id FROM sessions;" 2>/dev/null || true)

is_active() {
  # 检查 session_id 是否在活跃列表中
  echo "$ACTIVE_SESSIONS" | grep -qF "|$1"
}

get_group_folder() {
  # 根据 session_id 获取 group_folder
  echo "$ACTIVE_SESSIONS" | grep "|$1" | cut -d'|' -f1
}

# --- Prune session JSONLs and tool-results dirs ---
# 同时清理数据库中超过 7 天的 session_id

for group_dir in "$SESSIONS_DIR"/*/; do
  [ -d "$group_dir" ] || continue
  group_folder=$(basename "$group_dir")
  jsonl_dir="$group_dir/.claude/projects/-workspace-group"
  [ -d "$jsonl_dir" ] || continue

  for jsonl in "$jsonl_dir"/*.jsonl; do
    [ -f "$jsonl" ] || continue
    id=$(basename "$jsonl" .jsonl)

    # Never delete the active session
    if is_active "$id"; then
      # 活跃会话：检查是否超过 7 天
      if [ -n "$(find "$jsonl" -mtime +7 2>/dev/null)" ]; then
        # 活跃会话超过 7 天：清理数据库中的 session_id
        if ! $DRY_RUN; then
          sqlite3 "$STORE_DB" "DELETE FROM sessions WHERE session_id = '$id';"
          log "removed stale session_id from DB: $id (group: $group_folder)"
        else
          log "would remove stale session_id from DB: $id (group: $group_folder)"
        fi
      fi
      continue
    fi

    # 非活跃会话超过 7 天：删除文件和数据库记录
    if [ -n "$(find "$jsonl" -mtime +7 2>/dev/null)" ]; then
      remove "$jsonl"
      # Remove matching tool-results directory
      [ -d "$jsonl_dir/$id" ] && remove "$jsonl_dir/$id"
      # 清理数据库中的 session_id（如果存在）
      if ! $DRY_RUN; then
        sqlite3 "$STORE_DB" "DELETE FROM sessions WHERE session_id = '$id';"
        log "removed session_id from DB: $id"
      else
        log "would remove session_id from DB: $id"
      fi
    fi
  done
done

# --- 清理数据库中没有对应 JSONL 文件的 session_id ---
# 文件已被手动删除或损坏的情况

for row in $ACTIVE_SESSIONS; do
  group_folder=$(echo "$row" | cut -d'|' -f1)
  session_id=$(echo "$row" | cut -d'|' -f2)

  jsonl_path="$SESSIONS_DIR/$group_folder/.claude/projects/-workspace-group/$session_id.jsonl"

  # 如果 JSONL 文件不存在，删除 session_id
  if [ ! -f "$jsonl_path" ]; then
    if ! $DRY_RUN; then
      sqlite3 "$STORE_DB" "DELETE FROM sessions WHERE session_id = '$session_id';"
      log "removed orphan session_id from DB: $session_id (no JSONL file)"
    else
      log "would remove orphan session_id from DB: $session_id (no JSONL file)"
    fi
  fi
done

# --- Prune debug logs (>3 days, skip files named after active sessions) ---

for group_dir in "$SESSIONS_DIR"/*/; do
  debug_dir="$group_dir/.claude/debug"
  [ -d "$debug_dir" ] || continue
  while IFS= read -r -d '' f; do
    fname=$(basename "$f" .txt)
    is_active "$fname" && continue
    remove "$f"
  done < <(find "$debug_dir" -type f -mtime +3 ! -name "latest" -print0 2>/dev/null)
done

# --- Prune todo files (>3 days, skip files named after active sessions) ---

for group_dir in "$SESSIONS_DIR"/*/; do
  todos_dir="$group_dir/.claude/todos"
  [ -d "$todos_dir" ] || continue
  while IFS= read -r -d '' f; do
    fname=$(basename "$f" .json)
    # Todo filenames are like {session_id}-agent-{session_id}.json
    for aid in $(echo "$ACTIVE_SESSIONS" | cut -d'|' -f2); do
      if [[ "$fname" == *"$aid"* ]]; then
        continue 2
      fi
    done
    remove "$f"
  done < <(find "$todos_dir" -type f -mtime +3 -print0 2>/dev/null)
done

# --- Prune telemetry (>7 days, skip files named after active sessions) ---

for group_dir in "$SESSIONS_DIR"/*/; do
  telem_dir="$group_dir/.claude/telemetry"
  [ -d "$telem_dir" ] || continue
  while IFS= read -r -d '' f; do
    fname=$(basename "$f")
    for aid in $(echo "$ACTIVE_SESSIONS" | cut -d'|' -f2); do
      if [[ "$fname" == *"$aid"* ]]; then
        continue 2
      fi
    done
    remove "$f"
  done < <(find "$telem_dir" -type f -mtime +7 -print0 2>/dev/null)
done

# --- Prune group logs (>7 days) ---

while IFS= read -r -d '' f; do
  remove "$f"
done < <(find "$GROUPS_DIR"/*/logs -type f -mtime +7 -print0 2>/dev/null)

# --- Summary ---

if $DRY_RUN; then
  log "DRY RUN complete — would free ~${TOTAL_FREED}K"
else
  log "Done — freed ~${TOTAL_FREED}K"
fi
