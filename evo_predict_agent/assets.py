from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .evomap_gep import official_schema_version, stamp_asset

SCHEMA_VERSION = official_schema_version()

DEFAULT_GENES = [
    {
        "type": "Gene",
        "schema_version": SCHEMA_VERSION,
        "id": "gene_repair_auth_flow",
        "category": "repair",
        "signals_match": ["auth", "permission", "api-contract"],
        "strategy": [
            "Check server/client session boundary before changing business logic.",
            "Verify callback URL, cookie domain, token refresh, and middleware order.",
            "Add a minimal request-level reproduction and validate 401/403 behavior.",
        ],
        "constraints": {"max_files": 6, "forbidden_paths": [".git", "node_modules", "dist"]},
        "validation": ["run auth-related tests or reproduce login callback manually"],
    },
    {
        "type": "Gene",
        "schema_version": SCHEMA_VERSION,
        "id": "gene_repair_typescript_build",
        "category": "repair",
        "signals_match": ["typescript-error", "build-fail", "api-contract"],
        "strategy": [
            "Reproduce the smallest build/typecheck command and capture the exact diagnostic.",
            "Trace the failing type boundary instead of broad-casting any or suppressions.",
            "Patch the narrowest interface or call site, then run typecheck and tests.",
        ],
        "constraints": {"max_files": 5, "forbidden_paths": [".git", "node_modules", "dist"]},
        "validation": ["npm run typecheck", "npm test"],
    },
    {
        "type": "Gene",
        "schema_version": SCHEMA_VERSION,
        "id": "gene_repair_timeout_minimal_repro",
        "category": "repair",
        "signals_match": ["timeout", "test-failure"],
        "strategy": [
            "Create the smallest reproduction that times out before changing concurrency code.",
            "Inspect cancellation, retry, timers, and resource cleanup paths first.",
            "Add regression coverage for both success and timeout/cancel branches.",
        ],
        "constraints": {"max_files": 6, "forbidden_paths": [".git", "node_modules", "dist"]},
        "validation": ["run the failing test repeatedly"],
    },
    {
        "type": "Gene",
        "schema_version": SCHEMA_VERSION,
        "id": "gene_optimize_measure_first",
        "category": "optimize",
        "signals_match": ["performance"],
        "strategy": [
            "Measure baseline latency, cost, or memory before optimizing.",
            "Change one variable at a time and keep a rollback path.",
            "Record before/after metrics so the result can become a reusable capsule.",
        ],
        "constraints": {"max_files": 8, "forbidden_paths": [".git", "node_modules", "dist"]},
        "validation": ["run the benchmark or collect comparable before/after metrics"],
    },
]

GENE_ALLOWED = {
    "type",
    "schema_version",
    "id",
    "category",
    "signals_match",
    "preconditions",
    "strategy",
    "constraints",
    "validation",
    "summary",
    "epigenetic_marks",
    "learning_history",
    "anti_patterns",
    "asset_id",
}

CAPSULE_ALLOWED = {
    "type",
    "schema_version",
    "id",
    "trigger",
    "gene",
    "summary",
    "confidence",
    "blast_radius",
    "outcome",
    "success_streak",
    "success_reason",
    "gene_library_version",
    "env_fingerprint",
    "source_type",
    "reused_asset_id",
    "content",
    "diff",
    "strategy",
    "execution_trace",
    "a2a",
    "cost_tokens",
    "cost_usd",
    "trigger_context",
    "asset_id",
    "visibility",
    "scope",
    "cost_tier",
    "pack_of",
    "author",
}


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _items(data: Any, key: str) -> list[dict]:
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if isinstance(data, dict) and isinstance(data.get(key), list):
        return [x for x in data[key] if isinstance(x, dict)]
    return []


def _normalize_gene(gene: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in gene.items() if k in GENE_ALLOWED and k != "asset_id"}
    out.setdefault("type", "Gene")
    out["schema_version"] = SCHEMA_VERSION
    out.setdefault("constraints", {"max_files": 8, "forbidden_paths": [".git", "node_modules", "dist"]})
    return stamp_asset(out)


def _normalize_capsule(capsule: dict[str, Any]) -> dict[str, Any]:
    cap = dict(capsule)
    content = cap.get("content")
    if content is None:
        content = {}
    elif isinstance(content, str):
        content = {"lesson": content}
    elif not isinstance(content, dict):
        content = {"value": content}

    if cap.get("problem_family"):
        content.setdefault("problem_family", cap["problem_family"])
    if cap.get("capability_id"):
        content.setdefault("capability_id", cap["capability_id"])

    trace = cap.get("execution_trace")
    if isinstance(trace, dict):
        trace = [
            {"stage": "build", "note": json.dumps(trace, ensure_ascii=False)[:500]},
        ]
    elif not isinstance(trace, list):
        trace = []

    outcome = cap.get("outcome") if isinstance(cap.get("outcome"), dict) else {}
    outcome = {
        "status": outcome.get("status") if outcome.get("status") in {"success", "failed"} else "success",
        "score": float(outcome.get("score", cap.get("confidence", 0.5))),
    }
    outcome["score"] = min(1.0, max(0.0, outcome["score"]))

    out = {k: v for k, v in cap.items() if k in CAPSULE_ALLOWED and k != "asset_id"}
    out.update(
        {
            "type": "Capsule",
            "schema_version": SCHEMA_VERSION,
            "id": str(cap.get("id") or "capsule_local"),
            "trigger": cap.get("trigger") if isinstance(cap.get("trigger"), list) and cap.get("trigger") else ["general-question"],
            "gene": str(cap.get("gene") or "ad_hoc"),
            "summary": str(cap.get("summary") or "Local capability evolution capsule."),
            "confidence": min(1.0, max(0.0, float(cap.get("confidence", outcome["score"])))),
            "blast_radius": cap.get("blast_radius") if isinstance(cap.get("blast_radius"), dict) else {"files": 0, "lines": 0},
            "outcome": outcome,
            "source_type": cap.get("source_type") if cap.get("source_type") in {"generated", "reused", "reference", "user_authored", None} else "generated",
            "content": content,
            "strategy": cap.get("strategy") if isinstance(cap.get("strategy"), list) else [],
            "execution_trace": trace,
            "env_fingerprint": cap.get("env_fingerprint") if isinstance(cap.get("env_fingerprint"), dict) else {"platform": "local", "arch": "agent-runtime"},
        }
    )
    br = out["blast_radius"]
    out["blast_radius"] = {"files": int(br.get("files", 0)), "lines": int(br.get("lines", 0))}
    if not out["summary"].strip():
        out["summary"] = "Local capability evolution capsule."
    return stamp_asset({k: v for k, v in out.items() if k in CAPSULE_ALLOWED and v is not None})


class AssetStore:
    """Local GEP asset store compatible with @evomap/gep-mcp-server.

    Files are stored in MCP's native shape:
    - assets/genes.json    => {"version": 1, "genes": [...]}
    - assets/capsules.json => {"version": 1, "capsules": [...]}
    - assets/events.jsonl  => one stamped EvolutionEvent per line
    """

    def __init__(self, root: str | Path = "assets"):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.genes_path = self.root / "genes.json"
        self.capsules_path = self.root / "capsules.json"
        self.events_path = self.root / "events.jsonl"

    def init_defaults(self) -> None:
        if self.genes_path.exists():
            genes = [_normalize_gene(g) for g in _items(_read_json(self.genes_path, {"genes": []}), "genes")]
        else:
            genes = [_normalize_gene(g) for g in DEFAULT_GENES]
        if not genes:
            genes = [_normalize_gene(g) for g in DEFAULT_GENES]
        _write_json(self.genes_path, {"version": 1, "genes": genes})

        capsules = [_normalize_capsule(c) for c in _items(_read_json(self.capsules_path, {"capsules": []}), "capsules")]
        _write_json(self.capsules_path, {"version": 1, "capsules": capsules})
        self.events_path.touch(exist_ok=True)

    def load_genes(self) -> list[dict]:
        self.init_defaults()
        return _items(_read_json(self.genes_path, {"genes": []}), "genes")

    def load_capsules(self) -> list[dict]:
        self.init_defaults()
        return _items(_read_json(self.capsules_path, {"capsules": []}), "capsules")

    def load_events(self) -> list[dict]:
        self.init_defaults()
        events = []
        for line in self.events_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                events.append(json.loads(line))
        return events

    def save_capsule(self, capsule: dict[str, Any]) -> dict:
        self.init_defaults()
        cap = _normalize_capsule(capsule)
        capsules = self.load_capsules()
        if not any(c.get("asset_id") == cap["asset_id"] for c in capsules):
            capsules.append(cap)
            _write_json(self.capsules_path, {"version": 1, "capsules": capsules})
        return cap

    def save_event(self, event: dict[str, Any]) -> dict:
        self.init_defaults()
        ev = stamp_asset(dict(event))
        existing = {e.get("asset_id") for e in self.load_events()}
        if ev.get("asset_id") not in existing:
            with self.events_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(ev, ensure_ascii=False) + "\n")
        return ev

    def select_gene(self, signals: list[str], family: str | None = None, capability_id: str | None = None) -> dict:
        genes = self.load_genes()
        sigset = set(signals)
        best = None
        best_score = -1.0
        for gene in genes:
            matches = set(gene.get("signals_match", []))
            score = float(len(sigset & matches))
            if signals and signals[0] in matches:
                score += 1.0
            if capability_id and capability_id in (gene.get("summary") or ""):
                score += 0.25
            if family and family.replace("-bug", "") in gene.get("id", ""):
                score += 0.5
            if score > best_score:
                best = gene
                best_score = score
        return best or genes[0]

    def recall_capsules(self, signals: list[str], family: str | None = None, capability_id: str | None = None, limit: int = 3) -> list[dict]:
        sigset = set(signals)
        scored = []
        for cap in self.load_capsules():
            trigger = set(cap.get("trigger", []))
            content = cap.get("content") if isinstance(cap.get("content"), dict) else {}
            score = len(sigset & trigger) + float(cap.get("confidence", 0))
            if family and family == content.get("problem_family"):
                score += 1.0
            if capability_id and capability_id == content.get("capability_id"):
                score += 2.0
            if score > 0:
                scored.append((score, cap))
        scored.sort(key=lambda x: -x[0])
        return [c for _, c in scored[:limit]]
