from __future__ import annotations

from datetime import datetime, timezone

from .assets import AssetStore
from .hash_utils import compute_asset_id


def build_pre_evolution_card(*, context: str, signals: list[str], prediction, store: AssetStore) -> dict:
    gene = store.select_gene(signals, prediction.family)
    capsules = store.recall_capsules(signals, prediction.family)
    card = {
        "type": "PreEvolutionCard",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "context_summary": context[:500],
        "signals": signals,
        "predicted_family": prediction.family,
        "confidence": prediction.confidence,
        "predictor": prediction.model,
        "reasons": prediction.reasons,
        "selected_gene": {
            "id": gene["id"],
            "asset_id": gene.get("asset_id"),
            "category": gene.get("category"),
            "strategy": gene.get("strategy"),
            "validation": gene.get("validation"),
        },
        "recalled_capsules": [
            {
                "id": c.get("id"),
                "asset_id": c.get("asset_id"),
                "summary": c.get("summary"),
                "confidence": c.get("confidence"),
            }
            for c in capsules
        ],
        "prepared_prompt": build_prompt(context, signals, prediction.family, gene, capsules),
    }
    card["asset_id"] = compute_asset_id(card)
    return card


def build_prompt(context: str, signals: list[str], family: str, gene: dict, capsules: list[dict]) -> str:
    cap_block = "\n".join(f"- {c.get('summary')}" for c in capsules) or "- no prior capsule found"
    steps = "\n".join(f"{i+1}. {s}" for i, s in enumerate(gene.get("strategy", [])))
    return f"""Predicted next problem family: {family}
Signals: {', '.join(signals)}

Use Gene: {gene.get('id')}
Strategy:
{steps}

Relevant prior Capsules:
{cap_block}

Current context:
{context[:1200]}

Prepare an answer or repair plan, but do not make destructive changes until the user confirms.
""".strip()
