# EvoMate zsh hook.
#
# Usage:
#   source /Users/wangyue/evo/evo-predict-agent/apps/local-agent/shell/evomate-zsh-hook.zsh
#
# Optional env:
#   export EVOMATE_API_URL="https://evomate.yueanlab.com"
#   export EVOMATE_TERMINAL_HOOK=1

: "${EVOMATE_API_URL:=https://evomate.yueanlab.com}"
: "${EVOMATE_TERMINAL_HOOK:=1}"
: "${EVOMATE_TERMINAL_TIMEOUT:=1.2}"

evomate__post_terminal_event() {
  emulate -L zsh
  [[ "$EVOMATE_TERMINAL_HOOK" == "1" ]] || return 0
  command -v python3 >/dev/null 2>&1 || return 0
  command -v curl >/dev/null 2>&1 || return 0

  local event="$1"
  local event_kind="$2"
  local direction="$3"
  local command_text="$4"
  local session_id="$5"
  local exit_code="${6:-}"
  local duration_ms="${7:-}"
  local api_base="${EVOMATE_API_URL%/}"
  api_base="${api_base%/api/hook-events}"
  local endpoint="${api_base}/api/hook-events"

  (
    python3 - "$event" "$event_kind" "$direction" "$command_text" "$session_id" "$PWD" "$exit_code" "$duration_ms" <<'PY' | \
      curl -fsS -m "${EVOMATE_TERMINAL_TIMEOUT}" -X POST "$endpoint" -H 'content-type: application/json' --data-binary @- >/dev/null 2>&1
import json
import os
import platform
import re
import sys

event, event_kind, direction, command_text, session_id, cwd, exit_code, duration_ms = sys.argv[1:9]

def redact(value: str) -> str:
    value = re.sub(r"Bearer\s+[A-Za-z0-9._=-]{12,}", "Bearer [redacted]", value or "", flags=re.I)
    value = re.sub(r"sk-(?:evomap-)?[A-Za-z0-9_-]{16,}", "sk-[redacted]", value)
    value = re.sub(r"((?:api[_-]?key|token|secret|password)[\"']?\s*[:=]\s*[\"']?)[^\"'\s,}]{6,}", r"\1[redacted]", value, flags=re.I)
    return value[:1600]

ok = exit_code in ("", "0")
metadata = {
    "command": redact(command_text),
    "cwd": cwd,
    "shell": "zsh",
    "hook": "evomate-zsh-hook",
}
if exit_code != "":
    try:
        metadata["exitCode"] = int(exit_code)
    except ValueError:
        metadata["exitCode"] = exit_code
if duration_ms != "":
    try:
        metadata["durationMs"] = int(duration_ms)
    except ValueError:
        metadata["durationMs"] = duration_ms

payload = {
    "protocolVersion": "evomate.hook.v1",
    "source": "terminal:zsh",
    "channel": "desktop",
    "event": event,
    "eventKind": event_kind,
    "direction": direction,
    "sessionId": session_id,
    "workspace": cwd,
    "cwd": cwd,
    "device": platform.system().lower() or "desktop",
    "app": "zsh",
    "content": f"Terminal command {'started' if event == 'terminal_command_start' else ('succeeded' if ok else 'failed')}: {redact(command_text)}",
    "metadata": metadata,
    "privacy": {"consent": True, "redaction": "client", "pii": "possible", "retention": "short"},
    "signals": ["local_agent", "terminal_command", "coding_task", "command_start" if event == "terminal_command_start" else ("command_success" if ok else "command_failed")],
}
if event == "terminal_command_done":
    payload["outcome"] = "success" if ok else "failure"
    payload["kind"] = "accepted" if ok else "rejected"
    payload["score"] = 0.72 if ok else 0.28
print(json.dumps(payload, ensure_ascii=False))
PY
  ) &!
}

evomate__preexec() {
  emulate -L zsh
  [[ "$EVOMATE_TERMINAL_HOOK" == "1" ]] || return 0
  local command_text="$1"
  [[ -n "$command_text" ]] || return 0
  [[ "$command_text" == evomate* ]] && return 0
  [[ "$command_text" == *evomate-zsh-hook* ]] && return 0

  EVOMATE_LAST_COMMAND="$command_text"
  EVOMATE_LAST_STARTED_MS="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
  EVOMATE_LAST_SESSION="terminal-${EVOMATE_LAST_STARTED_MS}-${RANDOM}"
  evomate__post_terminal_event "terminal_command_start" "tool_use" "tool" "$EVOMATE_LAST_COMMAND" "$EVOMATE_LAST_SESSION"
}

evomate__precmd() {
  emulate -L zsh
  local exit_code="$?"
  [[ "$EVOMATE_TERMINAL_HOOK" == "1" ]] || return 0
  [[ -n "$EVOMATE_LAST_COMMAND" ]] || return 0

  local now_ms
  now_ms="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
  local duration_ms=$(( now_ms - ${EVOMATE_LAST_STARTED_MS:-$now_ms} ))
  evomate__post_terminal_event "terminal_command_done" "tool_result" "tool" "$EVOMATE_LAST_COMMAND" "$EVOMATE_LAST_SESSION" "$exit_code" "$duration_ms"
  unset EVOMATE_LAST_COMMAND EVOMATE_LAST_STARTED_MS EVOMATE_LAST_SESSION
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec evomate__preexec
add-zsh-hook precmd evomate__precmd
