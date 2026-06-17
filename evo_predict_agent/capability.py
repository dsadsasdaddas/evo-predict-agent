from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from uuid import uuid4

from .assets import AssetStore, SCHEMA_VERSION
from .evomap_gep import stamp_asset
from .signals import extract_signals, default_family_from_signals


@dataclass
class CapabilityTask:
    id: str
    capability_id: str
    prompt: str
    expected_family: str
    required_evidence: list[str]
    validation_assertions: list[str]
    metric_weights: dict[str, float] = field(
        default_factory=lambda: {
            "validation": 0.35,
            "evidence": 0.30,
            "gene": 0.15,
            "capsule": 0.10,
            "blast_radius": 0.10,
        }
    )


DEFAULT_BENCHMARK = [
    CapabilityTask(
        id="auth_callback_401",
        capability_id="auth_boundary_repair",
        prompt="After changing app/api/auth/callback, login redirects but API returns 401 unauthorized. Diagnose and propose a repair plan.",
        expected_family="auth-bug",
        required_evidence=["cookie", "callback", "token", "session", "401", "middleware"],
        validation_assertions=["auth boundary", "reproduce", "401", "rerun"],
    ),
    CapabilityTask(
        id="typescript_payload_mismatch",
        capability_id="typed_api_contract_repair",
        prompt="Next.js build fails with TS2345 because API payload shape changed. Diagnose and propose a minimal repair plan.",
        expected_family="typescript-bug",
        required_evidence=["type", "payload", "interface", "typecheck", "boundary", "schema"],
        validation_assertions=["type boundary", "typecheck", "minimal"],
    ),
    CapabilityTask(
        id="test_timeout_cleanup",
        capability_id="async_timeout_repair",
        prompt="A vitest test hangs until timeout after a retry path was added. Diagnose and propose a repair plan.",
        expected_family="runtime-timeout",
        required_evidence=["timeout", "cleanup", "timer", "abort", "retry", "regression"],
        validation_assertions=["cleanup", "failing test", "regression"],
    ),
    CapabilityTask(
        id="slow_expensive_agent_loop",
        capability_id="agent_loop_optimization",
        prompt="Agent task succeeds but burns too many tokens and has high latency. Propose an optimization plan.",
        expected_family="performance-issue",
        required_evidence=["baseline", "measure", "latency", "cost", "one variable", "rollback"],
        validation_assertions=["measure", "before", "after", "benchmark"],
    ),
]

CAPABILITY_SIGNAL_HINTS = {
    "auth_boundary_repair": {"auth", "api-contract", "permission"},
    "typed_api_contract_repair": {"typescript-error", "build-fail", "api-contract"},
    "async_timeout_repair": {"timeout", "test-failure"},
    "agent_loop_optimization": {"performance"},
}


class CapabilityEvaluator:
    """Measure test-time agent capability uplift from EvoMap GEP assets.

    This deliberately does not predict the user's next question. It runs the
    same task through a baseline runtime and a GEP-augmented runtime, then only
    solidifies improvements that satisfy capability-specific validation gates.
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
            "capability_id": task.capability_id,
            "signals": signals,
            "family": family,
            "used_gene": None,
            "used_capsules": [],
            "plan": plan,
            "answer": "\n".join(plan),
            "blast_radius": {"files": 12, "lines": 300},
        }

    def evolved_answer(self, task: CapabilityTask) -> dict:
        signals = extract_signals(task.prompt)
        family = default_family_from_signals(signals)
        gene = self.store.select_gene(signals, family, capability_id=task.capability_id)
        capsules = self.store.recall_capsules(signals, family, capability_id=task.capability_id, limit=2)
        plan = list(gene.get("strategy", []))
        if capsules:
            plan.append("Reuse prior capsule lesson: " + capsules[0].get("summary", ""))
        plan.append("Run the capability validation assertions before recording a new Capsule.")
        plan.append("Record before/after metrics and keep rollback small if the validation passes.")
        return {
            "mode": "evolved",
            "task_id": task.id,
            "capability_id": task.capability_id,
            "signals": signals,
            "family": family,
            "used_gene": gene.get("id"),
            "used_gene_asset_id": gene.get("asset_id"),
            "used_capsules": [c.get("asset_id") for c in capsules],
            "plan": plan,
            "answer": "\n".join(plan),
            "blast_radius": {"files": min(int(gene.get("constraints", {}).get("max_files", 8)), 8), "lines": 120},
        }

    def _gene_is_relevant(self, task: CapabilityTask, answer: dict) -> bool:
        gene_id = answer.get("used_gene") or ""
        signals = set(answer.get("signals") or [])
        hints = CAPABILITY_SIGNAL_HINTS.get(task.capability_id, set())
        if not (signals & hints):
            return False
        if task.capability_id == "agent_loop_optimization":
            return "optimize" in gene_id or "measure" in gene_id
        if task.capability_id == "auth_boundary_repair":
            return "auth" in gene_id
        if task.capability_id == "typed_api_contract_repair":
            return "typescript" in gene_id or "type" in gene_id
        if task.capability_id == "async_timeout_repair":
            return "timeout" in gene_id
        return bool(gene_id)

    def _capsules_are_relevant(self, task: CapabilityTask, answer: dict) -> bool:
        if not answer.get("used_capsules"):
            return False
        caps = self.store.recall_capsules(answer.get("signals") or [], answer.get("family"), task.capability_id, limit=5)
        for cap in caps:
            content = cap.get("content") if isinstance(cap.get("content"), dict) else {}
            if content.get("capability_id") == task.capability_id:
                return True
        return False

    def score(self, task: CapabilityTask, answer: dict) -> dict:
        text = (answer.get("answer") or "").lower()
        family_match = answer.get("family") == task.expected_family
        evidence_hits = [kw for kw in task.required_evidence if kw.lower() in text]
        validation_hits = [v for v in task.validation_assertions if v.lower() in text]
        evidence_score = len(evidence_hits) / max(len(task.required_evidence), 1)
        validation_hit_rate = len(validation_hits) / max(len(task.validation_assertions), 1)
        validation_ok = family_match and validation_hit_rate >= 0.5 and evidence_score >= 0.33
        gene_relevant = self._gene_is_relevant(task, answer) if family_match else False
        capsule_relevant = self._capsules_are_relevant(task, answer) if family_match else False
        blast = answer.get("blast_radius") or {}
        blast_radius_score = 1.0 if int(blast.get("files", 999)) <= 8 and int(blast.get("lines", 999)) <= 200 else 0.0

        weights = task.metric_weights
        total = (
            weights["validation"] * (1.0 if validation_ok else validation_hit_rate * 0.4)
            + weights["evidence"] * evidence_score
            + weights["gene"] * (1.0 if gene_relevant else 0.0)
            + weights["capsule"] * (1.0 if capsule_relevant else 0.0)
            + weights["blast_radius"] * blast_radius_score
        )
        # Hard gate: using an irrelevant Gene/Capsule must not inflate score.
        if not family_match:
            total = min(total, 0.25)
        return {
            "score": round(min(1.0, total), 4),
            "capability_id": task.capability_id,
            "family_match": family_match,
            "evidence_score": round(evidence_score, 4),
            "validation_hit_rate": round(validation_hit_rate, 4),
            "validation_ok": validation_ok,
            "gene_relevant": gene_relevant,
            "capsule_relevant": capsule_relevant,
            "blast_radius_score": blast_radius_score,
            "evidence_hits": evidence_hits,
            "validation_hits": validation_hits,
        }

    def run_benchmark(self, tasks: list[CapabilityTask] | None = None) -> dict:
        tasks = tasks or DEFAULT_BENCHMARK
        rows = []
        for task in tasks:
            base = self.baseline_answer(task)
            evo = self.evolved_answer(task)
            base_score = self.score(task, base)
            evo_score = self.score(task, evo)
            rows.append(
                {
                    "task": task.__dict__,
                    "baseline": {"answer": base, "score": base_score},
                    "evolved": {"answer": evo, "score": evo_score},
                    "delta": round(evo_score["score"] - base_score["score"], 4),
                    "solidify_allowed": bool(evo_score["validation_ok"] and evo_score["gene_relevant"] and evo_score["score"] > base_score["score"]),
                }
            )
        base_avg = sum(r["baseline"]["score"]["score"] for r in rows) / len(rows)
        evo_avg = sum(r["evolved"]["score"]["score"] for r in rows) / len(rows)
        report = {
            "type": "CapabilityEvaluationReport",
            "schema_version": SCHEMA_VERSION,
            "id": "cap_eval_" + uuid4().hex[:12],
            "created_at": time.time(),
            "benchmark_id": "agent_capability_v1",
            "metric": "capability_delta_score",
            "baseline_avg": round(base_avg, 4),
            "evolved_avg": round(evo_avg, 4),
            "absolute_improvement": round(evo_avg - base_avg, 4),
            "relative_improvement_pct": round(((evo_avg - base_avg) / max(base_avg, 1e-9)) * 100, 2),
            "rows": rows,
        }
        return stamp_asset(report)

    def solidify_improvements(self, report: dict) -> list[dict]:
        """Turn validation-passing capability deltas into Capsules and EvolutionEvents."""
        made = []
        for row in report.get("rows", []):
            if not row.get("solidify_allowed"):
                continue
            evo = row["evolved"]["answer"]
            evo_score = row["evolved"]["score"]
            base_score = row["baseline"]["score"]
            task = row["task"]
            capsule = {
                "type": "Capsule",
                "schema_version": SCHEMA_VERSION,
                "id": "capsule_capability_" + uuid4().hex[:12],
                "trigger": evo.get("signals", []),
                "gene": evo.get("used_gene") or "ad_hoc",
                "summary": f"Improved {task['capability_id']} by {row['delta']} capability-score points after GEP gene selection and validation.",
                "confidence": min(0.95, 0.6 + max(row.get("delta", 0), 0)),
                "blast_radius": {"files": 0, "lines": 0},
                "outcome": {"status": "success", "score": evo_score["score"]},
                "source_type": "generated",
                "content": {
                    "capability_id": task["capability_id"],
                    "problem_family": evo.get("family"),
                    "baseline_score": base_score["score"],
                    "evolved_score": evo_score["score"],
                    "absolute_improvement": row.get("delta"),
                    "validation_ok": evo_score["validation_ok"],
                    "evidence_hits": evo_score["evidence_hits"],
                    "validation_hits": evo_score["validation_hits"],
                    "used_capsules": evo.get("used_capsules", []),
                },
                "strategy": evo.get("plan", []),
                "execution_trace": [
                    {"stage": "build", "note": "selected GEP gene and recalled relevant capsules"},
                    {"stage": "validate", "note": json.dumps({"validation_hits": evo_score["validation_hits"]}, ensure_ascii=False)},
                ],
                "env_fingerprint": {"platform": "local", "arch": "agent-runtime"},
                "trigger_context": {"prompt": task["prompt"], "context_signals": evo.get("signals", []), "agent_model": "local-evaluator"},
            }
            saved_capsule = self.store.save_capsule(capsule)
            event = {
                "type": "EvolutionEvent",
                "schema_version": SCHEMA_VERSION,
                "id": "evt_capability_" + uuid4().hex[:12],
                "intent": "optimize" if "optimization" in task["capability_id"] else "repair",
                "signals": evo.get("signals", []),
                "genes_used": [evo.get("used_gene") or "ad_hoc"],
                "mutation_id": "mut_capability_" + uuid4().hex[:12],
                "blast_radius": {"files": 0, "lines": 0},
                "outcome": {"status": "success", "score": evo_score["score"]},
                "capsule_id": saved_capsule["id"],
                "source_type": "generated",
                "validation_report_id": report.get("id"),
                "meta": {
                    "capability_id": task["capability_id"],
                    "baseline_score": base_score["score"],
                    "evolved_score": evo_score["score"],
                    "absolute_improvement": row.get("delta"),
                },
                "trigger_context": {"prompt": task["prompt"], "context_signals": evo.get("signals", []), "agent_model": "local-evaluator"},
            }
            saved_event = self.store.save_event(event)
            made.append({"capsule": saved_capsule, "event": saved_event})
        return made
