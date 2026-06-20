# EvoMate Codex Vendor

EvoMate keeps the modified Codex client as a git submodule instead of copying the full Codex source into this repository.

## Location

```text
vendor/codex
```

Submodule target:

```text
https://github.com/dsadsasdaddas/codex.git
branch: wangyue/evomate-codex-tui
pinned commit: 71945c159b2d4115cb85e33ca6cb8f9352bb128a
```

## Clone with Codex

```bash
git clone --recurse-submodules git@github.com:dsadsasdaddas/evo-predict-agent.git
```

If the repo was already cloned:

```bash
git submodule update --init --recursive
```

## Build modified Codex

```bash
cd vendor/codex/codex-rs
cargo build -p codex-cli --bin codex
```

## Run with EvoMate cloud hook

```bash
EVOMATE_API_URL=https://evomate-api-3mkana4zma-df.a.run.app \
  vendor/codex/codex-rs/target/debug/codex
```

For local development, the helper wrapper on the demo machine is:

```text
/Users/wangyue/.local/bin/evocodex
```

It launches the modified Codex binary with `EVOMATE_API_URL` pointing to the shared Cloud Run API, so the phone page can observe the same evolution stream.

## Why submodule

- Keeps this repository focused on EvoMate product/backend/frontend code.
- Avoids vendoring the full Codex source tree into every commit.
- Makes Codex changes auditable in their own fork and branch.
- Lets hackathon reviewers reproduce the exact modified Codex commit.
