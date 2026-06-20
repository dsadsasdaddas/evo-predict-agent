# EvoMate Remote Compute Distribution

## Product Positioning

Remote compute is the **Evolution Lab** behind EvoMate.

Real-time agent behavior stays local and low latency:

```text
User / Codex / Claude Code / Cursor
  -> EvoMate MCP
  -> EvoMate API
  -> semantic parser + behavior policy
```

Long-running evolution work is distributed to remote GPU workers:

```text
EvoMate API
  -> SSH Job Queue
  -> <remote-host>:<port> GPU Worker
  -> Python remote_worker
  -> policy_eval / validation_report / suggested_mutations / evolution_bundle
  -> import into EvoMate + EvoMap GEP loop
```

This keeps the product fast while still allowing heavy ML, replay eval, embedding builds, and Evolution Gym runs.

Full system diagrams: `docs/EVOMATE_ARCHITECTURE_DIAGRAMS.md`.

## Current Prototype Skeleton

Implemented layers:

```text
packages/evomate-core/src/jobs.ts       # shared job schema and command plan
apps/api/src/remote-jobs.ts             # API-side job queue + artifact import
apps/api/src/server.ts                  # /api/remote-jobs routes
packages/evomate-mcp/src/server.ts      # MCP tools for remote jobs
evo_predict_agent/remote_worker.py      # Python worker: replay + full training dispatch
evo_predict_agent/training/*            # reward model / policy model / memory index training
deploy/remote/*.sh                      # bootstrap / sync / submit / import scripts
apps/web/app/page.tsx                   # Remote Compute panel in the control plane
```

## API

```text
GET  /api/remote-jobs
POST /api/remote-jobs/submit
GET  /api/remote-jobs/:jobId
POST /api/remote-jobs/:jobId/import
```

Submit body:

```json
{
  "type": "evolution_gym_eval",
  "objective": "Validate self-evolving behavior policies on remote compute.",
  "executeRemote": false
}
```

`executeRemote=false` is the default prototype mode. It writes a real job manifest and command plan locally without firing SSH.

Set either of these to actually execute SSH distribution:

```bash
export EVOMATE_REMOTE_EXECUTE=1
# or POST executeRemote=true
```

## MCP Tools

```text
evomate_submit_remote_evolution_job
evomate_get_remote_job_status
evomate_import_remote_artifacts
```

These call the EvoMate API. The host only needs EvoMate MCP configured; the remote compute backend remains behind the API.

## Remote Machine Defaults

```text
host: <remote-host>
port: <port>
user: <remote-user>
ssh key: /path/to/ssh_key
remote root: ~/evomate-worker
remote repo: ~/evomate-worker/repo
```

Override with:

```bash
EVOMATE_REMOTE_HOST=<remote-host>
EVOMATE_REMOTE_PORT=<port>
EVOMATE_REMOTE_USER=<remote-user>
EVOMATE_REMOTE_SSH_KEY=/path/to/ssh_key
EVOMATE_REMOTE_ROOT=~/evomate-worker
EVOMATE_REMOTE_REPO_DIR=~/evomate-worker/repo
EVOMATE_REMOTE_PYTHON=python3
```

## Remote Worker Contract

Input:

```text
jobs/<job_id>.json      # RemoteEvolutionJob manifest
datasets/<job_id>.json  # portable state / feedback / timeline dataset
```

Output:

```text
artifacts/<job_id>/status.json
artifacts/<job_id>/policy_eval.json
artifacts/<job_id>/validation_report.json
artifacts/<job_id>/suggested_mutations.json
artifacts/<job_id>/evolution_bundle.json
```

Artifact meaning:

```text
policy_eval.json          -> offline replay / candidate quality
validation_report.json    -> GEP-compatible validation evidence
suggested_mutations.json  -> policy/workflow/instruction mutation candidates
evolution_bundle.json     -> one importable evolution unit for the product story
```

## Manual Remote Flow

Bootstrap remote folders:

```bash
deploy/remote/bootstrap.sh
```

Sync repo:

```bash
deploy/remote/sync.sh
```

Create job locally through API:

```bash
curl -X POST http://localhost:8787/api/remote-jobs/submit \
  -H 'content-type: application/json' \
  -d '{"type":"evolution_gym_eval","objective":"Roadshow remote evolution rehearsal"}'
```

Submit the generated job to remote:

```bash
deploy/remote/submit_job.sh memory/evomate/remote-jobs/<job_id>/job.json
```

Import artifacts:

```bash
deploy/remote/import_artifacts.sh <job_id>
curl -X POST http://localhost:8787/api/remote-jobs/<job_id>/import
```

## Roadshow Story

> EvoMate keeps the agent runtime local through MCP, but distributes long-horizon evolution to a remote worker. The current worker performs real training for a pairwise preference reward model, a behavior policy model, and a user-memory embedding index, then returns auditable artifacts: policy evaluation, validation report, suggested mutations, model files, and an evolution bundle.

## Next Hardening Steps

```text
1. Add JSONL feedback compaction from long-running hook sessions.
2. Upgrade pairwise reward model to PyTorch/Transformer when the dataset is large enough.
3. Upgrade hashed embedding index to FAISS or SQLite vector search.
4. Convert imported training artifacts into official GEP assets through recordFeedbackGepAssets / Evolution Composer.
5. Add job auth and signed artifact hashes before public deployment.
```
