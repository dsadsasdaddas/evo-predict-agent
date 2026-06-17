from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .hash_utils import compute_asset_id

SCHEMA_VERSION = "1.0.0-local"

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
        "signals_match": ["typescript-error", "build-fail"],
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


class AssetStore:
    def __init__(self, root: str | Path = "assets"):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.genes_path = self.root / "genes.json"
        self.capsules_path = self.root / "capsules.json"

    def init_defaults(self) -> None:
        if not self.genes_path.exists():
            genes = []
            for g in DEFAULT_GENES:
                gg = dict(g)
                gg["asset_id"] = compute_asset_id(gg)
                genes.append(gg)
            self.genes_path.write_text(json.dumps(genes, ensure_ascii=False, indent=2), encoding="utf-8")
        if not self.capsules_path.exists():
            self.capsules_path.write_text("[]\n", encoding="utf-8")

    def load_genes(self) -> list[dict]:
        self.init_defaults()
        return json.loads(self.genes_path.read_text(encoding="utf-8"))

    def load_capsules(self) -> list[dict]:
        self.init_defaults()
        return json.loads(self.capsules_path.read_text(encoding="utf-8"))

    def save_capsule(self, capsule: dict[str, Any]) -> dict:
        self.init_defaults()
        cap = dict(capsule)
        cap.setdefault("type", "Capsule")
        cap.setdefault("schema_version", SCHEMA_VERSION)
        cap["asset_id"] = compute_asset_id(cap)
        capsules = self.load_capsules()
        if not any(c.get("asset_id") == cap["asset_id"] for c in capsules):
            capsules.append(cap)
            self.capsules_path.write_text(json.dumps(capsules, ensure_ascii=False, indent=2), encoding="utf-8")
        return cap

    def select_gene(self, signals: list[str], family: str | None = None) -> dict:
        genes = self.load_genes()
        best = None
        best_score = -1
        sigset = set(signals)
        for gene in genes:
            score = len(sigset & set(gene.get("signals_match", [])))
            if family and family.replace("-bug", "") in gene.get("id", ""):
                score += 0.5
            if score > best_score:
                best = gene
                best_score = score
        return best or genes[0]

    def recall_capsules(self, signals: list[str], family: str | None = None, limit: int = 3) -> list[dict]:
        sigset = set(signals)
        scored = []
        for cap in self.load_capsules():
            trigger = set(cap.get("trigger", []))
            score = len(sigset & trigger) + float(cap.get("confidence", 0))
            if family and family == cap.get("problem_family"):
                score += 1.0
            if score > 0:
                scored.append((score, cap))
        scored.sort(key=lambda x: -x[0])
        return [c for _, c in scored[:limit]]
