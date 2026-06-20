# EvoMate Semantic-First Evolution Architecture

## Core Architecture

EvoMate should not send raw user text directly into ML, prompts, or workflows.

The correct architecture is:

```text
User Input / Feedback
  -> Semantic Parser
    -> Behavior Policy Evolution Layer
    -> Instruction Evolution Layer
    -> Workflow / Tool Evolution Layer
  -> Evolution Composer
  -> EvoMap GEP Assets
```

## Why Semantic Parser First

A single user sentence contains multiple meanings:

```text
"你先看这个仓库，别乱动代码，我们要做 EvoMap-native Yes Engineer。"
```

It contains:

- task: coding / product architecture
- intent: analyze before execution
- risk: permission-sensitive repo work
- style preference: do not act without confirmation
- domain: EvoMap / MCP / ML
- evolution signal: user is shaping agent behavior

If each subsystem parses raw text separately, the system becomes inconsistent.

So EvoMate needs one semantic contract.

## Semantic Parser Output

The parser should output structured meaning:

```json
{
  "schemaVersion": "evomate.semantic.v1",
  "rawInput": "你先看这个仓库，别乱动代码，我们要做 EvoMap-native Yes Engineer。",
  "taskType": "coding",
  "intent": "analysis_before_execution",
  "riskLevel": "medium",
  "permissionMode": "ask_before_editing",
  "userTone": "direct",
  "workstyleSignals": [
    "dislikes_unconfirmed_edits",
    "wants_fast_iteration",
    "prefers_architecture_first"
  ],
  "domainSignals": ["evomap", "mcp", "ml_policy"],
  "toolNeeds": ["repo_inspection", "frontend_iteration"],
  "feedbackSemantics": null,
  "signals": [
    "coding_task",
    "ambiguous_execution_permission",
    "permission_sensitive",
    "evomap_integration",
    "mcp_native"
  ],
  "confidence": 0.86
}
```

## Stable Field Contract

Only the internal contract below can enter ML, Gene Tournament, training, advisor generation, or GEP writing:

| Field | Allowed values / shape |
| --- | --- |
| `schemaVersion` | `"evomate.semantic.v1"` |
| `rawInput` | original user text |
| `taskType` | `coding` / `product` / `research` / `general` |
| `intent` | `analysis_before_execution` / `direct_execution` / `architecture_planning` / `frontend_iteration` / `roadshow_packaging` / `ml_optimization` / `research_and_compare` / `general_help` |
| `riskLevel` | `low` / `medium` / `high` |
| `permissionMode` | `safe_to_execute` / `ask_before_editing` / `analysis_only` / `unknown` |
| `userTone` | `direct` / `impatient` / `cautious` / `exploratory` / `neutral` |
| `workstyleSignals` | `string[]`, normalized snake_case |
| `domainSignals` | `string[]`, normalized snake_case |
| `toolNeeds` | `string[]`, normalized snake_case |
| `feedbackSemantics` | `null` or `{ sentiment, correctionType?, rewardHint }` |
| `signals` | `string[]`, normalized snake_case |
| `confidence` | number in `0..1` |

External LLM JSON is not trusted directly:

```text
LLM JSON
  -> parse
  -> normalize aliases
  -> validate allowed fields
  -> confidence gate
  -> merge with rule-based seed parser
  -> SemanticParseResult v1
```

Accepted aliases are repaired into the stable field names. Examples:

```text
task / task_type / taskType       -> taskType
risk / risk_level / riskLevel     -> riskLevel
tone / user_tone / userTone       -> userTone
permission / permission_mode      -> permissionMode
tools / tool_hints / toolNeeds    -> toolNeeds
```

Value aliases are also repaired:

```text
repo / programming    -> coding
dangerous / risky     -> high
read_only / no_edit   -> analysis_only
corrective            -> cautious
training / model      -> ml_optimization
```

The implementation lives in:

```text
packages/evomate-core/src/semantic.ts
packages/evomate-core/src/semantic-schema.ts
apps/api/src/evomap-llm.ts
```

## Three Evolution Layers

### 1. Behavior Policy Evolution Layer

Purpose:

```text
Decide how the agent should behave right now.
```

Input:

```text
Semantic Parser result
```

Output:

```text
selected Behavior Gene / Yes Mode
predicted Yesness
policy score distribution
```

Implementation:

```text
Contextual Bandit + Reward Learning
```

Examples:

- Safe Yes
- Fast Yes
- Architect Yes
- Research Yes
- Policy Yes

### 2. Instruction Evolution Layer

Purpose:

```text
Turn user corrections into durable prompt/instruction mutations.
```

Example user feedback:

```text
以后别乱动代码，先分析。
```

Becomes:

```text
When working in code repositories, inspect and summarize before editing files.
```

Output:

- instruction mutation
- prompt patch
- user-specific standing rule
- candidate Capsule

### 3. Workflow / Tool Evolution Layer

Purpose:

```text
Change the agent's action workflow and MCP tool route.
```

Example evolution:

Before:

```text
answer directly
```

After:

```text
1. recall behavior capsule
2. inspect repo
3. produce plan
4. ask confirmation
5. execute worker
6. record outcome
```

Output:

- workflow gene
- tool route
- execution gate
- MCP trace

## Evolution Composer

The composer merges outputs from the three layers into GEP-compatible assets.

```text
Behavior policy update -> Mutation
Instruction update     -> Mutation / Capsule
Workflow update        -> Gene / Capsule
User feedback          -> EvolutionEvent
Reward evidence        -> ValidationReport
```

## EvoMap Mapping

| EvoMate Concept | EvoMap / GEP Asset |
| --- | --- |
| Behavior Gene | Gene |
| Instruction Mutation | Mutation |
| Workflow Gene | Gene |
| User feedback cycle | EvolutionEvent |
| Reward / Yesness evidence | ValidationReport |
| Stable user preference | Capsule |

## Product Explanation

English:

```text
EvoMate parses user intent once, then evolves behavior, instructions, and workflows in parallel.
```

Chinese:

```text
EvoMate 先统一理解用户语义，再同时进化行为策略、提示词规则和工具工作流。
```
