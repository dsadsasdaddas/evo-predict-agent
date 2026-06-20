#!/usr/bin/env bash
# EvoMate Claude Code advisor injection hook.
# Reads Claude Code UserPromptSubmit JSON from stdin and returns hookSpecificOutput.additionalContext.
# Stdout must stay valid hook JSON; failures return {} and never block Claude Code.
set -u

EVENT="${1:-user_prompt_submit}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
EVOMATE_REPO="${EVOMATE_REPO:-$PROJECT_ROOT}"
WORKSPACE="${CLAUDE_PROJECT_DIR:-${PWD}}"

export EVOMATE_API_URL="${EVOMATE_API_URL:-http://127.0.0.1:8787}"
export EVOMATE_PROJECT_ROOT="$EVOMATE_REPO"
export EVOMATE_HOOK_QUEUE_DIR="${EVOMATE_HOOK_QUEUE_DIR:-memory/evomate/hooks}"
export EVOMATE_HOOK_TIMEOUT_MS="${EVOMATE_HOOK_TIMEOUT_MS:-1200}"
export EVOMATE_ADVISOR_MAX_CONTEXT_CHARS="${EVOMATE_ADVISOR_MAX_CONTEXT_CHARS:-9000}"

if [ ! -d "$EVOMATE_REPO" ]; then
  printf '{}\n'
  exit 0
fi
cd "$EVOMATE_REPO" || { printf '{}\n'; exit 0; }

OUTPUT="$(npm --silent run evomate:advisor -- \
  --source claude-code \
  --event "$EVENT" \
  --workspace "$WORKSPACE" \
  --hook-json \
  --hook-event-name UserPromptSubmit 2>/dev/null || true)"

if [ -n "$OUTPUT" ]; then
  printf '%s\n' "$OUTPUT"
else
  printf '{}\n'
fi

exit 0
