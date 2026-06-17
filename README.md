# Evo Predict Agent

一个基于 **EvoMap GEP 技术栈** 的 **能力自进化 Agent** 原型。

重点不是“预测用户下一类问题”，而是验证：

```text
同一组任务
baseline agent（无 Gene/Capsule）
vs
 evolved agent（复用 EvoMap Gene/Capsule）
```

如果 evolved agent 在同题 benchmark 上通过 capability validation，并且相关 Gene/Capsule 复用带来分数提升，才把这次提升固化为新的 Capsule / EvolutionEvent / CapabilityEvaluationReport。

## 核心闭环

```text
Capability Benchmark
  -> baseline answer
  -> evolved answer with GEP Gene/Capsule
  -> score before/after with validation gates
  -> CapabilityEvaluationReport
  -> solidify successful deltas into Capsules + EvolutionEvents
  -> next run reuses stronger memory
```

## 为什么这是 EvoMap 逻辑

EvoMap 的核心不是模型权重训练，而是 **agent runtime capability evolution**：

- `Gene`：可复用策略
- `Capsule`：具体成功/失败经验
- `asset_id`：官方 GEP 内容哈希
- `EvolutionEvent / CapabilityEvaluationReport`：证明复用后能力提升
- `MCP`：让其他 agent 读取/复用这些资产

本项目用本地 benchmark 证明：同样的问题集，使用 GEP 资产后的 agent 比 baseline 更会解决问题。

## 快速 demo

```bash
cd /Users/wangyue/evo/evo-predict-agent
npm install
python3 -m evo_predict_agent.cli init
python3 -m evo_predict_agent.cli capability-eval --out memory/capability_report.json
python3 -m evo_predict_agent.cli capability-solidify --report memory/capability_report.json
python3 -m evo_predict_agent.cli verify-assets
python3 -m evo_predict_agent.cli gep-schema-validate
python3 -m evo_predict_agent.cli export-gep --out memory/gep_bundle.local.json
```

你会看到类似：

```json
{
  "baseline_avg": 0.2,
  "evolved_avg": 0.75,
  "absolute_improvement": 0.55,
  "relative_improvement_pct": 275
}
```

## 当前 CLI

```bash
python3 -m evo_predict_agent.cli capability-eval
python3 -m evo_predict_agent.cli capability-solidify
python3 -m evo_predict_agent.cli verify-assets
python3 -m evo_predict_agent.cli export-gep
python3 -m evo_predict_agent.cli gep-info
python3 -m evo_predict_agent.cli gep-schema-validate
npm run mcp:local
```

旧的 `predict/pre-evolve` 命令仍保留为辅助实验，但不再是主叙事。

## 关键文件

```text
evo_predict_agent/capability.py   # baseline vs evolved 能力评测闭环
evo_predict_agent/assets.py       # Gene/Capsule store
evo_predict_agent/evomap_gep.py   # Python -> @evomap/gep-sdk bridge
evo_predict_agent/cli.py          # CLI
scripts/gep_bridge.mjs            # 官方 GEP SDK 调用
.mcp/gep-local.json               # 本地 MCP server 配置
```

## 与 atomation 的关系

`atomation` 是比赛用自动机器学习实验 Agent，本仓库不修改它。

我们借鉴它的“实验闭环”思想，但改造成 EvoMap 能力进化闭环：

```text
experiment config -> score feedback
```

变成：

```text
agent strategy -> capability score -> capsule solidification
```

## EvoMap 技术栈接入

这个仓库现在不是只“借概念”，而是接了 EvoMap 官方本地技术栈：

- `@evomap/gep-sdk`：官方 GEP schema version、content hash、asset id。
- `@evomap/gep-mcp-server`：本地 MCP GEP server，可用本项目的 `assets/` 和 `memory/evolution/`。
- `scripts/gep_bridge.mjs`：Python agent 与官方 Node GEP SDK 的桥。

安装 Node 依赖：

```bash
npm install
npm run gep:info
```

Python 侧验证：

```bash
python3 -m evo_predict_agent.cli gep-info
python3 -m evo_predict_agent.cli verify-assets
python3 -m evo_predict_agent.cli gep-schema-validate
python3 -m evo_predict_agent.cli export-gep --out memory/gep_bundle.local.json
```

启动本地 GEP MCP Server：

```bash
npm run mcp:local
```

MCP 配置示例：

```text
.mcp/gep-local.json
```

默认仍然 **不联网、不 publish、不上传 Hub**。如果后续要接 EvoMap Hub，再显式配置 `EVOMAP_NODE_ID / EVOMAP_NODE_SECRET / EVOMAP_API_KEY`。

## 当前边界

这不是模型权重 fine-tuning，而是 EvoMap 风格的 test-time/runtime 能力提升：通过 Gene 选择、Capsule 召回、Validation gate、EvolutionEvent 审计，让 agent 下一次做同类能力任务时更稳。旧的 `predict/pre-evolve` 只是保留实验入口，不是主线。
