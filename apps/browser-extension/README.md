# EvoMate Web Hook Extension

Chrome Manifest V3 extension that turns AI web chat pages into EvoMate Hook Protocol sources.

## What it does

- Injects a content script into ChatGPT, Claude, Gemini, Doubao, Perplexity, Poe, and local demo pages.
- Uses `MutationObserver` to detect new chat message DOM nodes.
- Sends normalized `evomate.hook.v1` events to `/api/hook-events` through the background service worker.
- Converts everyday AI-tool actions (`copy`, `regenerate`, `stop`, thumbs up/down) into outcome/feedback hooks.
- Before a normal prompt is sent, calls `/api/advisor/prepare` and injects a compact EvoMate Advisor block into the same ChatGPT/Claude/Gemini/Doubao prompt box.
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
→ EvoMate asks the hosted server for evolved advisor guidance
→ extension injects the advisor block into the normal AI prompt
→ AI answers with the evolved behavior policy
→ copy/regenerate/stop/feedback buttons become outcome hooks
→ GEP memory + policy weights update
→ next prompt gets a better advisor block
```

Default API endpoint:

```text
http://100.70.188.115:8878/api/hook-events
```

For local backend, open the extension popup and set:

```text
http://127.0.0.1:8787/api/hook-events
```

## Event mapping

- user bubble → `eventKind=user_message`, `direction=inbound`, route `advisor`
- assistant bubble → `eventKind=assistant_message`, `direction=outbound`, route `observe`
- manual selected text capture → `eventKind=copy`, `direction=feedback`, route `outcome`
- copy answer → `eventKind=copy`, `kind=accepted`, route `outcome`
- regenerate answer → `eventKind=regenerate`, `kind=corrected`, route `outcome`
- stop generation → `eventKind=stop`, `kind=interrupted`, route `outcome`
- thumbs up/down → `eventKind=feedback`, `kind=accepted/corrected`, route `outcome`

This makes the browser extension both the web-side intake and the web-side advisor injector: normal AI tools become EvoMate-evolving tools without replacing their UI.
