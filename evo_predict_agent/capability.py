from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from .assets import AssetStore, SCHEMA_VERSION
from .evomap_gep import stamp_asset
from .signals import extract_signals, default_family_from_signals


@dataclass
class CapabilityTask:
    id: str
    prompt: str
    expected_family: str
    expected_keywords: list[str]
    validation: str


DEFAULT_BENCHMARK = [
    CapabilityTask(
        id="auth_callback_401",
        prompt="After changing app/api/auth/callback, login redirects but API returns 401 unauthorized. Diagnose and propose a repair plan.",
        expected_family="auth-bug",
        expected_keywords=["cookie", "callback", "token", "session", "401", "middleware"],
        validation="plan mentions auth boundary and concrete validation",
    ),
    CapabilityTask(
        id="typescript_payload_mismatch",
        prompt="Next.js build fails with TS2345 because API payload shape changed. Diagnose and propose a minimal repair plan.",
        expected_family="typescript-bug",
        expected_keywords=["type", "payload", "interface", "typecheck", "boundary", "schema"],
        validation="plan isolates type boundary and runs typecheck",
    ),
    CapabilityTask(
        id="test_timeout_cleanup",
        prompt="A vitest test hangs until timeout after a retry path was added. Diagnose and propose a repair plan.",
        expected_family="runtime-timeout",
        expected_keywords=["timeout", "cleanup", "timer", "abort", "retry", "regression"],
        validation="plan checks cancellation/cleanup and repeats failing test",
    ),
    CapabilityTask(
        id="slow_expensive_agent_loop",
        prompt="Agent task succeeds but burns too many tokens and has high latency. Propose an optimization plan.",
        expected_family="performance-issue",
        expected_keywords=["baseline", "measure", "latency", "cost", "one variable", "rollback"],
        validation="plan measures before optimizing",
    ),
]


class CapabilityEvaluator:
    """Evaluate agent capability before and after GEP asset reuse.

    This does not claim to train model weights. It measures an agent-runtime
    capability: whether Gene/Capsule memory causes better strategy selection,
    more concrete validation, and more reusable outcomes on the same task set.
    """

    def __init__(self, asset_store: AssetStore):
        self.store = asset_store
        self.store.init_defaults()

    def baseline_answer(self, task: CapabilityTask) -> dict:
        signals = extract_signals(task.prompt)
        family = default_family_from_signals(signals)
        plan = [
            "Read the problem statement and identify the likely failure area.",
            "Inspect related code and logs.",
            "Make a minimal fix and rerun the relevant validation.",
        ]
        return {
            "mode": "baseline",
            "task_id": task.id,
            "signals": signals,
            "family": family,
            "used_gene": None,
            "used_capsules": [],
            "plan": plan,
            "answer": "\n".join(plan),
        }

    def evolved_answer(self, task: CapabilityTask) -> dict:
        signals = extract_signals(task.prompt)
        family = default_family_from_signals(signals)
        gene = self.store.select_gene(signals, family)
        capsules = self.store.recall_capsules(signals, family, limit=2)
        plan = list(gene.get("strategy", []))
        if capsules:
            plan.append("Reuse prior capsule lesson: " + capsules[0].get("summary", ""))
        plan.append("Record the outcome as a new Capsule if validation passes.")
        return {
            "mode": "evolved",
            "task_id": task.id,
            "signals": signals,
            "family": family,
            "used_gene": gene.get("id"),
            "used_gene_asset_id": gene.get("asset_id"),
            "used_capsules": [c.get("asset_id") for c in capsules],
            "plan": plan,
            "answer": "\n".join(plan),
        }

    def score(self, task: CapabilityTask, answer: dict) -> dict:
        text = (answer.get("answer") or "").lower()
        hits = [kw for kw in task.expected_keywords if kw.lower() in text]
        keyword_score = len(hits) / max(len(task.expected_keywords), 1)
        family_score = 1.0 if answer.get("family") == task.expected_family else 0.0
        gene_score = 1.0 if answer.get("used_gene") else 0.0
        capsule_score = min(len(answer.get("used_capsules") or []) / 2, 1.0)
        validation_score = 1.0 if any(v in text for v in ["validation", "test", "typecheck", "measure", "reproduce", "rerun"]) else 0.0
        total = 0.45 * keyword_score + 0.2 * family_score + 0.15 * gene_score + 0.1 * capsule_score + 0.1 * validation_score
        return {
            "score": round(total, 4),
            "keyword_score": round(keyword_score, 4),
            "family_score": family_score,
            "gene_reuse_score": gene_score,
            "capsule_reuse_score": capsule_score,
            "validation_score": validation_score,
            "keyword_hits": hits,
        }

    def run_benchmark(self, tasks: list[CapabilityTask] | None = None) -> dict:
        tasks = tasks or DEFAULT_BENCHMARK
        rows = []
        for task in tasks:
            base = self.baseline_answer(task)
            evo = self.evolved_answer(task)
            base_score = self.score(task, base)
            evo_score = self.score(task, evo)
            rows.append({
                "task": task.__dict__,
                "baseline": {"answer": base, "score": base_score},
                "evolved": {"answer": evo, "score": evo_score},
                "delta": round(evo_score["score"] - base_score["score"], 4),
            })
        base_avg = sum(r["baseline"]["score"]["score"] for r in rows) / len(rows)
        evo_avg = sum(r["evolved"]["score"]["score"] for r in rows) / len(rows)
        report = {
            "type": "CapabilityEvaluationReport",
            "schema_version": SCHEMA_VERSION,
            "id": "cap_eval_" + uuid4().hex[:12],
            "created_at": time.time(),
            "metric": "strategy_quality_score",
            "baseline_avg": round(base_avg, 4),
            "evolved_avg": round(evo_avg, 4),
            "absolute_improvement": round(evo_avg - base_avg, 4),
            "relative_improvement_pct": round(((evo_avg - base_avg) / max(base_avg, 1e-9)) * 100, 2),
            "rows": rows,
        }
        return stamp_asset(report)

    def solidify_improvements(self, report: dict) -> list[dict]:
        """Turn successful capability deltas into Capsules."""
        made = []
        for row in report.get("rows", []):
            if row.get("delta", 0) <= 0:
                continue
            evo = row["evolved"]["answer"]
            task = row["task"]
            capsule = {
                "type": "Capsule",
                "schema_version": SCHEMA_VERSION,
                "id": "capsule_capability_" + uuid4().hex[:12],
                "trigger": evo.get("signals", []),
                "problem_family": evo.get("family"),
                "gene": evo.get("used_gene") or "ad_hoc",
                "summary": f"GEP memory improved {task['id']} by {row['delta']} strategy-quality points.",
                "confidence": min(0.95, 0.6 + max(row.get("delta", 0), 0)),
                "blast_radius": {"files": 0, "lines": 0},
                "outcome": {"status": "success", "score": row["evolved"]["score"]["score"]},
                "source_type": "generated",
                "content": evo.get("answer", ""),
                "strategy": evo.get("plan", []),
                "execution_trace": {
                    "baseline_score": row["baseline"]["score"]["score"],
                    "evolved_score": row["evolved"]["score"]["score"],
                    "delta": row.get("delta"),
                    "used_capsules": evo.get("used_capsules", []),
                },
                "env_fingerprint": {"platform": "local", "arch": "agent-runtime"},
            }
            made.append(self.store.save_capsule(capsule))
        return made
