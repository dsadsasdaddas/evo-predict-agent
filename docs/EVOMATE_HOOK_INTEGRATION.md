# EvoMate Hook Integration

EvoMate should **not** replace Codex / Claude Code / Cursor. It runs as a sidecar:

```text
Codex / Claude Code / Cursor
  -> normal agent flow continues
  -> EvoMate hook observes prompt/outcome in parallel
  -> EvoMate API parses semantics + selects Behavior Gene
  -> optional advisor text is injected only if host supports it
  -> outcome becomes reward learning + EvoMap GEP assets
```

## What was added

### API endpoints

| Endpoint | Role | Side effect |
| --- | --- | --- |
| `POST /api/agent-events/observe` | Observe a host event and select a behavior gene | Adds timeline event |
| `POST /api/advisor/prepare` | Build read-only advisor prompt for the next agent turn | No state mutation |
| `POST /api/agent-events/outcome` | Convert completion / correction / interruption into reward | Updates policy + writes GEP assets |

### Sidecar CLI

```bash
npm --silent run evomate:observe -- --source codex --event user_message --content "先分析这个 hook 怎么做"
npm --silent run evomate:advisor -- --source codex --event advisor_prepare --input "改一下前端" --text
npm --silent run evomate:advisor -- --source codex --event user_prompt_submit --input "改一下前端" --hook-json --hook-event-name UserPromptSubmit
npm --silent run evomate:outcome -- --source codex --event task_completed --outcome success --content "用户接受了改动"
```

All sidecar commands are designed to be hook-safe:

- short API timeout, default `900ms`
- local JSONL queue under `memory/evomate/hooks/`
- secret redaction before queue/API post
- never exits with failure for observe/outcome hook usage
- host command should still use `|| true`

## Environment

```bash
EVOMATE_API_URL=http://localhost:8787
EVOMATE_HOOK_TIMEOUT_MS=900
EVOMATE_HOOK_QUEUE_DIR=memory/evomate/hooks
EVOMATE_PROJECT_ROOT=/path/to/evo-predict-agent
```

## Payload contract

Observation:

```json
{
  "source": "codex",
  "event": "user_message",
  "workspace": "/repo/path",
  "sessionId": "local-session",
  "content": "用户原始请求",
  "metadata": { "host": "codex" }
}
```

Outcome:

```json
{
  "source": "codex",
  "event": "task_completed",
  "outcome": "success",
  "content": "用户说 ok / 或任务完成摘要",
  "geneId": "gene_ask_before_execution",
  "signals": ["coding_task", "permission_sensitive"]
}
```


## Omni Hook Protocol

Codex / Claude Code hooks are now one adapter inside a broader protocol layer. Mobile chat, web chat, browser extensions, and custom SDK clients should send `evomate.hook.v1` compatible events to:

```text
POST /api/hook-events
```

The API normalizes each event, chooses a route (`advisor`, `observe`, `outcome`, `ignore`), then reuses the same semantic parser, Gene Tournament, advisor injection, reward learning, and GEP asset path. Full contract: `docs/EVOMATE_HOOK_PROTOCOL.md`.

## Three operating modes

1. **Observer mode** — safest demo mode. EvoMate only sees events and updates the control plane.
2. **Advisor mode** — EvoMate returns a small instruction block; Codex/Claude Code may include it as context.
3. **Control mode** — future mode. EvoMate selects workflow/tool routes before execution.

Current implementation is Observer + Advisor. Control mode stays opt-in because we do not want to break the original agent UX.

## Auto-injection path

`UserPromptSubmit` now has two hook commands:

```text
Codex / Claude Code prompt
  -> observe hook: write lifecycle signal to EvoMate
  -> inject hook: call /api/advisor/prepare
  -> sidecar returns hookSpecificOutput.additionalContext
  -> host model receives EvoMate Advisor block in the next turn context
```

Generated hook JSON shape:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "EvoMate Advisor ..."
  }
}
```

Files:

| Host | Observe adapter | Injection adapter | Config |
| --- | --- | --- | --- |
| Codex | `.codex/hooks/evomate-codex-hook.sh` | `.codex/hooks/evomate-codex-inject.sh` | `.codex/hooks.json` |
| Claude Code | `.claude/hooks/evomate-claude-hook.sh` | `.claude/hooks/evomate-claude-inject.sh` | `.claude/settings.json` |

Injection is fail-open:

- stdout is always hook JSON (`{}` on empty input / API timeout)
- API timeout defaults to `1200ms` in injection scripts
- advisor context is capped by `EVOMATE_ADVISOR_MAX_CONTEXT_CHARS`, default `9000`
- secrets are redacted before queue/API posting
- the original Codex / Claude Code task continues even when EvoMate is down

### Codex CLI trust gotcha

Codex CLI only runs trusted hooks unless launched with `--dangerously-bypass-hook-trust`.
After adding a second `UserPromptSubmit` hook for advisor injection, the CLI may still run
the old observe hook but silently skip the new inject hook until its `trusted_hash` is recorded
under `~/.codex/config.toml`:

```toml
[hooks.state."/path/to/project/.codex/hooks.json:user_prompt_submit:0:1"]
trusted_hash = "sha256:..."
```

Diagnosis:

```bash
codex exec -C /path/to/project "Reply exactly: hook-test"
```

Expected healthy output shows two `UserPromptSubmit` lines:

```text
hook: UserPromptSubmit
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
hook: UserPromptSubmit Completed
```

If only one line appears, observe is trusted but advisor injection is not. Either approve the
hook in Codex's startup hook review UI, or run a trusted installer that computes and writes the
current hook hashes. For one-off debugging only:

```bash
codex exec --dangerously-bypass-hook-trust -C /path/to/project "Reply exactly: hook-test"
```

Manual smoke test:

```bash
printf '{"prompt":"我们没有真训练吗，把完整机器学习训练闭环做出来","session_id":"local"}' \
  | .codex/hooks/evomate-codex-inject.sh \
  | python3 -m json.tool
```

## CLI state panel

Hook stdout must stay machine-readable, so dynamic EvoMate state should be shown through a separate
CLI status command instead of printing inside hook scripts:

```bash
npm --silent run evomate:status
npm --silent run evomate:status -- --watch
npm --silent run evomate:status -- --json
```

The panel shows API health, current phase, Yesness, latest selected Behavior Gene, installed trained
models, hook queue counts, and the latest Evolution Timeline events. It is the terminal equivalent
of the web dashboard for Codex CLI users.


## EvoMap fit

The hook sidecar makes EvoMate deeply compatible with EvoMap because every lifecycle signal becomes an evolvable asset:

```text
Prompt / event
  -> SemanticParseResult
  -> BehaviorGene decision
  -> Reward from outcome
  -> Mutation + EvolutionEvent + Capsule candidate
  -> GEP assets in assets/events.jsonl and assets/capsules.json
```

This is the core competition story: the user keeps using their existing coding agent, while EvoMate quietly learns how that agent should behave for this specific user.
