# EvoMate Desktop

Electron shell for a roadshow-ready local demo.

It starts:

- EvoMate API on `127.0.0.1:8787`
- EvoMate web control plane on `localhost:3333`
- a desktop window titled `EvoMate Desktop`, loading `localhost:3333?shell=electron`

Run:

```bash
npm run evomate:desktop
```

Useful env vars:

```bash
EVOMATE_API_PORT=8787
EVOMATE_WEB_PORT=3333
EVOMATE_DESKTOP_DEVTOOLS=1
EVOMAP_LLM_DISABLED=1
```

For roadshows, keep the real Codex / Claude Code hooks installed, but use the desktop app as the main visible control plane. The loaded control plane polls the local API state feed, uses the Electron workbench layout, and shows hook events in the timeline without refreshing. If the external agent is not available, use the web control buttons and demo replay flow as a stable fallback.
