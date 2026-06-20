# EvoMate Desktop Demo

EvoMate Desktop is the roadshow shell for the product. It is an Electron app that opens the existing EvoMate control plane as a native desktop window and starts the local runtime for you.

## Why desktop first

EvoMate integrates with local coding agents:

- Codex reads `.codex/hooks.json`
- Claude Code reads `.claude/settings.json`
- EvoMate sidecar writes local hook events and GEP assets

That means the main demo surface should be a desktop app, not a mobile app. Mobile can be a companion dashboard later, but it cannot install or observe local Codex / Claude Code hooks directly.

## Run

```bash
cd /Users/wangyue/evo/evo-predict-agent
npm run evomate:desktop
```

The desktop shell starts:

```text
EvoMate API  -> http://127.0.0.1:8787
EvoMate Web  -> http://localhost:3333
Electron UI  -> EvoMate Desktop window
```

Electron loads the same control plane with `?shell=electron`, which gives the native traffic-light titlebar room and locks the default desktop workbench into a three-column proof-chain layout.

## Roadshow flow

1. Open `EvoMate Desktop`.
2. Show hook status and current Yesness score.
3. Trigger a Codex or Claude Code prompt.
4. Watch EvoMate poll `/api/evolution/state` every 1.5s, observe the event, and select a Behavior Gene.
5. Press feedback buttons to show reward learning.
6. Show GEP assets and remote evolution dry-run.

## Stable fallback

If Codex / Claude Code auth fails on stage, keep using the desktop app:

- paste a sample prompt into `Live Agent Session`
- click `Observe Agent Event`
- click `Accepted / Corrected / Interrupted`
- click `Submit Job` and `Import`

This still demonstrates the full product loop without depending on external model availability.

## Useful env vars

```bash
EVOMATE_API_PORT=8787
EVOMATE_WEB_PORT=3333
EVOMATE_API_URL=http://127.0.0.1:8787
EVOMATE_WEB_URL=http://localhost:3333
EVOMATE_DESKTOP_DEVTOOLS=1
EVOMAP_LLM_DISABLED=1
```

## Notes

This is currently a development desktop shell. A signed `.app` package can be added later with `electron-builder` after the UI and demo script are stable.
