# EvoMate Web Hook Extension

Chrome Manifest V3 extension that turns AI web chat pages into EvoMate Hook Protocol sources.

## What it does

- Injects a content script into ChatGPT, Claude, Gemini, Doubao, Perplexity, Poe, and local demo pages.
- Uses `MutationObserver` to detect new chat message DOM nodes.
- Sends normalized `evomate.hook.v1` events to `/api/hook-events` through the background service worker.
- Keeps a popup toggle, API URL editor, recent send receipts, and manual selected-text capture.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:

```text
/Users/wangyue/evo/evo-predict-agent/apps/browser-extension
```

## Demo flow

```text
Open ChatGPT / Gemini / Claude Web
→ ask a question
→ EvoMate badge shows listening/captured
→ Cloud Run receives POST /api/hook-events
→ EvoMate web console timeline updates
```

Default API endpoint:

```text
https://evomate-api-3mkana4zma-df.a.run.app/api/hook-events
```

For local backend, open the extension popup and set:

```text
http://127.0.0.1:8787/api/hook-events
```

## Event mapping

- user bubble → `eventKind=user_message`, `direction=inbound`, route `advisor`
- assistant bubble → `eventKind=assistant_message`, `direction=outbound`, route `observe`
- manual selected text capture → `eventKind=copy`, `direction=feedback`, route `outcome`

This makes the browser extension the web-side intake, while MCP/Codex/Claude Code remain the execution-side output.
