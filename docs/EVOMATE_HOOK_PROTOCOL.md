# EvoMate Omni Hook Protocol

EvoMate should not be coupled to one host such as Codex or Claude Code. The unified protocol layer makes every AI surface emit the same event contract:

```text
Codex / Claude Code
Mobile AI chat
Web AI chat
Browser extension
Custom SDK / API

  -> evomate.hook.v1
  -> POST /api/hook-events
  -> Semantic Parser
  -> Gene Tournament
  -> Advisor / Outcome
  -> EvoMap GEP assets
```

## Package

```text
packages/evomate-hooks
```

Exports:

```ts
import {
  EvoMateHookClient,
  createMobileChatEvent,
  createWebChatEvent,
  createBrowserExtensionEvent,
  normalizeHookInput
} from '@evomate/hooks';
```

## Endpoint

```text
POST /api/hook-events
```

Single event:

```json
{
  "protocolVersion": "evomate.hook.v1",
  "source": "web-chat",
  "channel": "web-chat",
  "eventKind": "user_message",
  "sessionId": "web-demo-1",
  "content": "帮我改一下这个网页，但先解释你要改哪里",
  "metadata": {
    "surface": "landing-page-assistant"
  }
}
```

Batch:

```json
{
  "protocolVersion": "evomate.hook.v1",
  "events": [
    {
      "source": "mobile-chat",
      "channel": "mobile-chat",
      "eventKind": "user_message",
      "content": "用手机问 AI：给我一个更直接的答案"
    },
    {
      "source": "browser-extension",
      "channel": "browser-extension",
      "eventKind": "regenerate",
      "content": "用户点击重新生成",
      "score": 0.25
    }
  ]
}
```

## Required fields

| Field | Meaning |
| --- | --- |
| `protocolVersion` | `evomate.hook.v1` |
| `source` | concrete producer: `codex`, `claude-code`, `mobile-chat`, `web-chat`, `browser-extension` |
| `channel` | normalized surface: `coding-agent`, `mobile-chat`, `web-chat`, `browser-extension`, `desktop`, `api-sdk` |
| `eventKind` | normalized lifecycle event |
| `content` | latest user / assistant / feedback text if available |
| `sessionId` | stable conversation/session key |
| `metadata` | host-specific details after secret redaction |

## Event kinds and routes

| eventKind | Route | Product meaning |
| --- | --- | --- |
| `user_message` | `advisor` | Select behavior gene and prepare advisor context |
| `advisor_request` | `advisor` | Explicit request for next-turn behavior guidance |
| `assistant_message` | `observe` | Record AI output as lifecycle evidence |
| `tool_use` / `tool_result` | `observe` | Record coding-agent execution lifecycle |
| `feedback` | `outcome` | Convert user feedback to reward |
| `copy` | `outcome` | Treat answer copy as accepted signal |
| `regenerate` | `outcome` | Treat retry as correction signal |
| `stop` | `outcome` | Treat stop/interrupt as interruption signal |

## Client SDK examples

Mobile chat:

```ts
const evomate = new EvoMateHookClient({ baseUrl: 'http://localhost:8787' });

await evomate.mobileChat({
  eventKind: 'user_message',
  sessionId: 'ios-session-1',
  device: 'ios',
  content: '我想让 AI 更懂我，不要总是废话'
});
```

Web chat:

```ts
await evomate.webChat({
  eventKind: 'copy',
  sessionId: 'web-session-1',
  content: '用户复制了答案',
  score: 0.9
});
```

Browser extension:

```ts
await evomate.browserExtension({
  eventKind: 'regenerate',
  url: 'https://chat.example.com/thread/123',
  content: '用户点击重新生成'
});
```

## Why this matters for the roadshow

Before this layer, EvoMate looked like a Codex / Claude Code sidecar. After this layer, EvoMate becomes the user's cross-surface AI behavior memory:

```text
Every AI interaction becomes a training signal.
Every feedback gesture becomes reward.
Every repeated preference becomes a GEP asset.
```

That is the product upgrade:

```text
from coding-agent hook
  to personal AI evolution protocol
```
