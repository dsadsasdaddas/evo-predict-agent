# EvoMate Local Agent

EvoMate Local Agent is the local workflow sensor layer for the roadshow demo.

It does **not** record every keystroke or screen frame. It sends authorized,
low-risk workflow events to the EvoMate Hook Protocol:

- active app / window title
- git workspace status
- terminal command start / result

Default API:

```txt
https://evomate.yueanlab.com/api/hook-events
```

## One-shot test

```bash
cd /Users/wangyue/evo/evo-predict-agent
npm run evomate:local -- once --dry-run
npm run evomate:local -- once
```

## Monitor active window + git status

```bash
cd /Users/wangyue/evo/evo-predict-agent
npm run evomate:local -- monitor
```

On macOS, active-window capture may require:

```txt
System Settings → Privacy & Security → Accessibility → allow Terminal/Chrome/Codex
```

## Terminal hook

For a temporary shell session:

```bash
source /Users/wangyue/evo/evo-predict-agent/apps/local-agent/shell/evomate-zsh-hook.zsh
```

Then run:

```bash
npm run check
git status
```

The hook sends:

- `terminal_command_start` as `tool_use`
- `terminal_command_done` as `tool_result`
- `outcome=success/failure`

To disable in that shell:

```bash
export EVOMATE_TERMINAL_HOOK=0
```

To install permanently, append this line to `~/.zshrc` manually:

```bash
source /Users/wangyue/evo/evo-predict-agent/apps/local-agent/shell/evomate-zsh-hook.zsh
```

## Demo story

1. User works in Gemini / Codex / Terminal.
2. Local Agent converts actions into `evomate.hook.v1` events.
3. Cloud Run API writes them into the evolution timeline.
4. Dashboard flashes and shows Local Activity.
5. Failed terminal commands become feedback signals, changing behavior-gene selection.
