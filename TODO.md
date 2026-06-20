# EvoMate Implementation TODO

## Current Product Direction

```text
EvoMate = EvoMap-native Self-Evolving Yes Engineer
```

Core architecture:

```text
User Input / Feedback
  -> Semantic Parser
    -> Behavior Policy Evolution Layer
    -> Instruction Evolution Layer
    -> Workflow / Tool Evolution Layer
  -> Evolution Composer
  -> EvoMap GEP Assets
  -> MCP Hosts: Claude Code / Codex / Cursor
```

## Priority 0 — Keep Demo Running

- [x] Local frontend at `http://localhost:3001`
- [x] Local API at `http://localhost:8787`
- [x] Frontend layout changed away from EvoMap homepage clone
- [x] Frontend shows semantic-first three-layer architecture
- [x] TypeScript checks pass
- [x] Fix responsive visual issues found in in-app browser review
- [ ] Decide final roadshow first-screen copy

## Priority 1 — Semantic Parser

Goal: one shared semantic contract before ML / instruction / workflow evolution.

- [x] Create `packages/evomate-core/src/semantic.ts`
- [x] Define `SemanticParseResult` type
- [x] Move rule-based signal extraction behind semantic parser
- [x] Add parser fields:
  - [x] `taskType`
  - [x] `intent`
  - [x] `riskLevel`
  - [x] `permissionMode`
  - [x] `userTone`
  - [x] `workstyleSignals`
  - [x] `domainSignals`
  - [x] `toolNeeds`
  - [x] `feedbackSemantics`
  - [x] `confidence`
- [x] Update `extractSignals()` to derive from semantic parser
- [x] Add API response field `semantic`
- [x] Show semantic parser output on frontend

## Priority 2 — Three Evolution Layers

### 2.1 Behavior Policy Evolution Layer

Already started with contextual bandit.

- [x] Linear contextual bandit
- [x] Reward learning
- [x] Yesness Score
- [ ] Feed `SemanticParseResult` into policy layer instead of raw regex signals
- [ ] Add policy confidence and explanation
- [ ] Log policy decisions to interaction history

### 2.2 Instruction Evolution Layer

Turns user corrections into durable instructions.

- [ ] Create `packages/evomate-core/src/instructions.ts`
- [ ] Define `InstructionMutation`
- [ ] Generate instruction mutations from feedback semantics
- [ ] Store user-specific standing rules
- [ ] Expose instruction mutations in `/api/feedback`
- [ ] Render instruction mutation panel on frontend

Example:

```text
User: 以后别乱动代码，先分析。
Instruction Mutation: When working in code repos, inspect and summarize before edits.
```

### 2.3 Workflow / Tool Evolution Layer

Evolves MCP/tool execution routes.

- [ ] Create `packages/evomate-core/src/workflows.ts`
- [ ] Define `WorkflowGene`
- [ ] Define workflow templates:
  - [ ] `safe_repo_workflow`
  - [ ] `fast_answer_workflow`
  - [ ] `research_first_workflow`
  - [ ] `roadshow_packaging_workflow`
  - [ ] `frontend_iteration_workflow`
- [ ] Select workflow from semantic parser result
- [ ] Expose selected workflow through API and MCP
- [ ] Render workflow route in frontend

## Priority 3 — Evolution Composer / EvoMap GEP Mapping

Goal: every learning cycle becomes GEP-compatible evidence.

- [ ] Create `packages/evomate-core/src/evolution.ts`
- [ ] Define `EvolutionBundle`
- [ ] Compose:
  - [ ] `policyMutation`
  - [ ] `instructionMutation`
  - [ ] `workflowMutation`
  - [ ] `signalMutation`
  - [ ] `capsuleCandidate`
  - [ ] `validationReport`
- [ ] Map EvoMate outputs to EvoMap assets:
  - [ ] Behavior Gene -> `Gene`
  - [ ] Instruction/Policy update -> `Mutation`
  - [ ] User feedback cycle -> `EvolutionEvent`
  - [ ] Reward evidence -> `ValidationReport`
  - [ ] Stable preference -> `Capsule`
- [ ] Return `evolutionBundle` from `/api/feedback`
- [ ] Render `Evolution Composer` output on frontend

## Priority 4 — MCP Host Integration

Target hosts:

```text
Claude Code / Codex / Cursor
```

- [x] `packages/evomate-mcp` exists
- [x] `evomate_select_behavior_gene`
- [x] `evomate_record_feedback`
- [x] `evomate_predict_satisfaction`
- [x] `evomate_get_evolution_state`
- [x] Add `evomate_parse_semantics`
- [x] Add non-blocking hook sidecar package for Codex / Claude Code / Cursor
- [x] Add hook API endpoints:
  - [x] `/api/agent-events/observe`
  - [x] `/api/advisor/prepare`
  - [x] `/api/agent-events/outcome`
- [x] Add hook config templates in `configs/hooks/`
- [ ] Add `evomate_select_workflow`
- [ ] Add `evomate_compose_evolution_bundle`
- [x] Add MCP / hook config examples for Claude Code / Codex / Cursor
- [x] Add `UserPromptSubmit` advisor auto-injection for Codex / Claude Code hooks
- [x] Add CLI state panel for Codex users with hook/model/evolution status
- [x] Document host flow:

```text
Host receives user input
  -> call evomate_parse_semantics
  -> call evomate_select_behavior_gene
  -> follow selected instruction/workflow
  -> record feedback/outcome
```

Current hook flow:

```text
Host session continues normally
  -> sidecar observes prompt JSON or text
  -> EvoMate selects Behavior Gene + Advisor Prompt
  -> optional advisor injection if host supports it
  -> sidecar records outcome
  -> reward update writes EvoMap GEP assets
```

## Priority 5 — Better ML Optimization

### Local Online Learning

- [x] Contextual Bandit
- [x] Reward Learning
- [ ] Store interactions in JSONL
- [ ] Add offline replay evaluation
- [ ] Add basic A/B policy comparison

### Embedding Memory Retrieval

- [ ] Create interaction dataset format
- [ ] Add embedding generation script
- [ ] Add vector retrieval over past feedback
- [ ] Use nearest examples as features for policy layer

### Preference Model

- [ ] Collect preference pairs
- [ ] Define pair schema
- [ ] Train small reward/preference model
- [ ] Use remote V100 for training

### Evolution Gym

- [ ] Define simulated user personas
- [ ] Define scenario set
- [ ] Run workflow/gene candidates through simulated users
- [ ] Generate `ValidationReport`

## Priority 6 — Remote Compute / Deployment

Remote machine:

```text
ssh -i /path/to/ssh_key -o IdentitiesOnly=yes -p <port> <remote-user>@<remote-host>
```

Verified:

```text
Node v20.20.2
npm 10.8.2
Python 3.10.12
RAM 251 GiB
GPU 2 × Tesla V100 32GB
```

Tasks:

- [x] Create remote compute distribution skeleton
- [x] Add remote job API + MCP tools
- [x] Add Python remote worker with real preference/policy/memory training pipeline
- [x] Add deploy/remote bootstrap/sync/submit/import scripts
- [x] Add frontend Remote Compute control panel
- [x] Execute first real SSH remote job on GPU machine
- [x] Poll `/api/evolution/state` from frontend / desktop shell for live hook timeline updates
- [x] Install trained preference reward model, behavior policy model, and memory index into runtime advisor
- [x] Replace plain score sorting with weighted Condorcet / Gene Tournament behavior selection

## Priority 7 — Roadshow Packaging

- [x] Roadshow narrative doc
- [x] Yes Engineer positioning
- [x] Yesness Score metric
- [ ] 3-minute demo script
- [x] Slide architecture diagram
- [ ] Before/after agent behavior story
- [ ] Visual proof: feedback changes behavior gene
- [ ] Visual proof: EvolutionBundle maps to EvoMap assets


## Priority 8 — Desktop Roadshow Shell

- [x] Add `apps/desktop` Electron shell
- [x] Auto-start local API and web control plane
- [x] Load EvoMate in a native desktop window
- [x] Add desktop demo documentation
- [x] Show live API / hook state in the desktop-loaded control plane
- [ ] Add packaged `.app` build with electron-builder
- [ ] Add one-click hook installer UI
- [ ] Add mobile companion dashboard route

## Immediate Next Steps

1. ~~Implement `semantic.ts`.~~ Done.
2. ~~Return `semantic` from `/api/interactions/analyze`.~~ Done.
3. ~~Show semantic parser output on frontend.~~ Done.
4. ~~Add non-blocking hook sidecar for existing coding agents.~~ Done.
5. Implement `evolution.ts` composer.
6. Extend MCP tools with workflow/evolution bundle APIs. `evomate_parse_semantics` is done.


## Remote Compute Prototype Skeleton — Done

- [x] Shared remote job schema in `packages/evomate-core/src/jobs.ts`
- [x] API routes: `GET/POST /api/remote-jobs`
- [x] MCP tools: submit/status/import remote evolution jobs
- [x] Python worker: `evo_predict_agent/remote_worker.py`
- [x] Deploy scripts in `deploy/remote/`
- [x] Frontend Remote Compute panel
- [x] Documentation: `docs/REMOTE_COMPUTE_DISTRIBUTION.md`
- [ ] Real remote execution with `EVOMATE_REMOTE_EXECUTE=1`
- [ ] Convert imported artifacts into official GEP asset writes through Evolution Composer


### First Real Remote Run

- Date: 2026-06-19
- Job: `job_evolution_gym_eval_20260619090850_996f86`
- Target: `<remote-user>@<remote-host>:<port>`
- Worker: `python3 -m evo_predict_agent.remote_worker`
- Status: imported
- Artifacts:
  - `policy_eval.json`
  - `validation_report.json`
  - `suggested_mutations.json`
  - `evolution_bundle.json`
- Result: baseline `0.61`, evolved `0.78`, improvement `+0.17` / `27.87%`


## Responsive QA

- [x] Responsive QA: 360/390/430/768/1024/1280/1440 widths
- [x] No horizontal overflow across tested breakpoints
- [x] Key panels visible: Semantic Contract, Remote Compute, GEP Asset Stream, Evolution Timeline
- [x] Browser console has zero errors after refresh
