from __future__ import annotations

import re

_RULES: list[tuple[str, str]] = [
    (r"\b401\b|unauthorized|auth|login|cookie|session|token|callback", "auth"),
    (r"typescript|\bts\d{4}\b|type error|tsc|cannot assign", "typescript-error"),
    (r"build failed|next build|webpack|vite|missing env|env var", "build-fail"),
    (r"timeout|timed out|etimedout|abortcontroller|hang", "timeout"),
    (r"test failed|assertionerror|unit test|pytest|jest|vitest", "test-failure"),
    (r"api|schema|contract|json|payload|response", "api-contract"),
    (r"database|sql|postgres|supabase|migration|prisma", "database"),
    (r"permission|forbidden|\b403\b|policy|role", "permission"),
    (r"performance|slow|latency|cost|token|memory", "performance"),
    (r"ui|css|layout|component|react|tailwind", "frontend-ui"),
]

_SIGNAL_TO_FAMILY = {
    "auth": "auth-bug",
    "typescript-error": "typescript-bug",
    "build-fail": "build-bug",
    "timeout": "runtime-timeout",
    "test-failure": "test-failure",
    "api-contract": "api-bug",
    "database": "database-bug",
    "permission": "permission-bug",
    "performance": "performance-issue",
    "frontend-ui": "frontend-ui-bug",
}


def extract_signals(text: str | None) -> list[str]:
    lower = (text or "").lower()
    found: list[str] = []
    for pattern, signal in _RULES:
        if re.search(pattern, lower) and signal not in found:
            found.append(signal)
    return found or ["general-question"]


def default_family_from_signals(signals: list[str]) -> str:
    for sig in signals:
        if sig in _SIGNAL_TO_FAMILY:
            return _SIGNAL_TO_FAMILY[sig]
    return "general-question"
