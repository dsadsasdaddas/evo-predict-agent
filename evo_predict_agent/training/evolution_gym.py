from __future__ import annotations

import argparse
from pathlib import Path

from .preference_model import evaluate_evolution, read_json, read_jsonl, suggested_mutations_from_models, utc_now, write_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate trained EvoMate models in Evolution Gym")
    parser.add_argument("--pairwise", required=True, help="pairwise_dataset.jsonl")
    parser.add_argument("--policy", required=True, help="policy_dataset.jsonl")
    parser.add_argument("--reward-model", required=True, help="preference_model.json")
    parser.add_argument("--policy-model", required=True, help="policy_model.json")
    parser.add_argument("--embedding-index", required=True, help="embedding_index.json")
    parser.add_argument("--out", required=True, help="Output artifact directory")
    parser.add_argument("--job-id", default="local_evolution_gym")
    args = parser.parse_args()

    pairwise_rows = read_jsonl(Path(args.pairwise))
    policy_rows = read_jsonl(Path(args.policy))
    reward_model = read_json(Path(args.reward_model), {})
    policy_model = read_json(Path(args.policy_model), {})
    embedding_index = read_json(Path(args.embedding_index), {})
    eval_report = {
        "id": f"eval_{args.job_id}",
        "job_id": args.job_id,
        "job_type": "evolution_gym_eval",
        "best_candidate": "trained_reward_policy_memory_v1",
        **evaluate_evolution(pairwise_rows, policy_rows, reward_model, policy_model, embedding_index),
    }
    validation_report = {
        "type": "ValidationReport",
        "id": f"val_{args.job_id}",
        "job_id": args.job_id,
        "score": eval_report["evolved_avg"],
        "passed": eval_report["evolved_avg"] >= 0.68,
        "evidence": ["evolution_gym_validation"],
        "created_at": utc_now(),
    }
    mutations = suggested_mutations_from_models(reward_model, policy_model, eval_report, args.job_id)
    out = Path(args.out)
    write_json(out / "policy_eval.json", eval_report)
    write_json(out / "validation_report.json", validation_report)
    write_json(out / "suggested_mutations.json", mutations)
    print({"ok": True, "policy_eval": eval_report, "out": str(out)})


if __name__ == "__main__":
    main()
