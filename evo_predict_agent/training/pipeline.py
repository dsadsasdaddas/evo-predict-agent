from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from .preference_model import (
    build_embedding_index,
    build_training_sets,
    evaluate_evolution,
    read_json,
    suggested_mutations_from_models,
    train_pairwise_reward_model,
    train_policy_model,
    utc_now,
    write_json,
    write_jsonl,
)


def run_training_pipeline(job: dict[str, Any], dataset: dict[str, Any], artifacts: Path) -> dict[str, Any]:
    """Run the complete EvoMate training pipeline and write runtime artifacts.

    Output contract:
    - preference_model.json: pairwise reward model used by Node runtime.
    - policy_model.json: softmax behavior policy model used by Node runtime.
    - embedding_index.json: user memory retrieval index.
    - policy_eval.json / validation_report.json / suggested_mutations.json /
      evolution_bundle.json: EvoMap-facing evaluation artifacts.
    """

    artifacts = Path(artifacts)
    artifacts.mkdir(parents=True, exist_ok=True)
    job_id = str(job.get("jobId") or job.get("job_id") or "local_training")
    job_type = str(job.get("type") or "preference_train")

    datasets = build_training_sets(job, dataset)
    training_dir = artifacts / "training"
    write_jsonl(training_dir / "preference_dataset.jsonl", datasets["preference"])
    write_jsonl(training_dir / "pairwise_dataset.jsonl", datasets["pairwise"])
    write_jsonl(training_dir / "policy_dataset.jsonl", datasets["policy"])

    reward_result = train_pairwise_reward_model(datasets["pairwise"])
    policy_result = train_policy_model(datasets["policy"])
    embedding_index = build_embedding_index(datasets["preference"])
    eval_report = {
        "id": f"eval_{job_id}",
        "job_id": job_id,
        "job_type": job_type,
        "best_candidate": "trained_reward_policy_memory_v1",
        "notes": "Full training pipeline: pairwise reward model + behavior policy model + user memory index.",
        **evaluate_evolution(
            datasets["pairwise"],
            datasets["policy"],
            reward_result.model,
            policy_result.model,
            embedding_index,
        ),
    }
    validation_report = {
        "type": "ValidationReport",
        "id": f"val_{job_id}",
        "job_id": job_id,
        "score": eval_report["evolved_avg"],
        "passed": eval_report["evolved_avg"] >= 0.68,
        "evidence": [
            "pairwise_reward_model_training",
            "softmax_behavior_policy_training",
            "hashed_user_memory_index",
            "evolution_gym_validation",
        ],
        "created_at": utc_now(),
        "metrics": {
            "reward_model": reward_result.metrics,
            "policy_model": policy_result.metrics,
            "embedding_index": embedding_index.get("metrics"),
        },
    }
    mutations = suggested_mutations_from_models(reward_result.model, policy_result.model, eval_report, job_id)
    bundle = {
        "type": "EvolutionBundle",
        "id": f"bundle_{job_id}",
        "job_id": job_id,
        "source": "evomate_full_training_pipeline",
        "created_at": utc_now(),
        "assets": {
            "reward_model": "preference_model.json",
            "policy_model": "policy_model.json",
            "embedding_index": "embedding_index.json",
            "policy_eval": eval_report["id"],
            "validation_report": validation_report["id"],
            "mutations": [mutation["id"] for mutation in mutations],
            "capsule_candidate": f"capsule_{job_id}_trained_user_preference",
        },
    }

    reward_dir = artifacts / "reward_model"
    policy_dir = artifacts / "policy_model"
    memory_dir = artifacts / "embedding_index"
    write_json(reward_dir / "preference_model.json", reward_result.model)
    write_json(policy_dir / "policy_model.json", policy_result.model)
    write_json(memory_dir / "embedding_index.json", embedding_index)

    # Root-level copies keep the remote import path simple.
    write_json(artifacts / "preference_model.json", reward_result.model)
    write_json(artifacts / "policy_model.json", policy_result.model)
    write_json(artifacts / "embedding_index.json", embedding_index)
    write_json(artifacts / "policy_eval.json", eval_report)
    write_json(artifacts / "validation_report.json", validation_report)
    write_json(artifacts / "suggested_mutations.json", mutations)
    write_json(artifacts / "evolution_bundle.json", bundle)

    return {
        "policy_eval": eval_report,
        "validation_report": validation_report,
        "suggested_mutations": mutations,
        "evolution_bundle": bundle,
        "preference_model": reward_result.model,
        "policy_model": policy_result.model,
        "embedding_index": embedding_index,
        "dataset_counts": {key: len(value) for key, value in datasets.items()},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run full EvoMate training pipeline")
    parser.add_argument("--job", required=True, help="Path to job manifest JSON")
    parser.add_argument("--dataset", required=True, help="Path to remote dataset JSON")
    parser.add_argument("--artifacts", required=True, help="Output artifact directory")
    args = parser.parse_args()

    job = read_json(Path(args.job), {})
    dataset = read_json(Path(args.dataset), {"samples": []})
    result = run_training_pipeline(job, dataset, Path(args.artifacts))
    print({
        "ok": True,
        "policy_eval": result["policy_eval"],
        "dataset_counts": result["dataset_counts"],
    })


if __name__ == "__main__":
    main()
