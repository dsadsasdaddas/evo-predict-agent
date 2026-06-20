# EvoMate Android Hook

Android companion app for reproducing the existing EvoMate mobile chat hook flow on Android phones.

It uses an Android `AccessibilityService` to observe supported AI chat app screens, normalize visible chat text into the existing `evomate.hook.v1` contract, and upload events to the same EvoMap endpoint used by the web/browser hook:

```text
https://evomate-api-3mkana4zma-df.a.run.app/api/hook-events
```

## Protocol Mapping

Android events keep the same names and route as the iOS/mobile protocol:

```json
{
  "protocolVersion": "evomate.hook.v1",
  "source": "mobile-chat:doubao",
  "channel": "mobile-chat",
  "event": "mobile_chat_user",
  "eventKind": "user_message",
  "direction": "inbound",
  "device": "android"
}
```

Assistant messages use:

```json
{
  "event": "mobile_chat_assistant",
  "eventKind": "assistant_message",
  "direction": "outbound"
}
```

Feedback gestures use `copy`, `regenerate`, or `stop`, which the API routes to the outcome path.

## Supported Apps

The default package allowlist includes:

```text
com.larus.nova
com.openai.chatgpt
com.anthropic.claude
com.google.android.apps.bard
ai.perplexity.app.android
com.quora.poe
com.deepseek.chat
com.moonshot.kimichat
com.alibaba.tongyi
```

You can edit this list inside the app. Doubao is commonly distributed as `com.larus.nova`; if your phone shows a different package name, add it on a new line.

## Build

Open `apps/android` in Android Studio, then build and install the `app` module.

The project is intentionally native Java Android with no runtime dependencies beyond the Android SDK.

## Use

1. Install the app.
2. Open **EvoMate Hook**.
3. Confirm the API URL is the EvoMap `/api/hook-events` endpoint.
4. Tap **发送测试 hook** to confirm upload.
5. Tap **打开安卓无障碍设置**.
6. Enable **EvoMate AI Chat Hook**.
7. Open Doubao or another configured AI app and chat normally.

The app performs client-side redaction by default before uploading:

- API keys and bearer tokens
- email addresses
- phone-like numbers

## Android Limits

This is not a root/network hook. It does not patch Doubao or any model app. It listens through the Android accessibility layer, which is the deployable Android equivalent of the browser extension's DOM observer and the iOS/mobile `mobile-chat` protocol path.
