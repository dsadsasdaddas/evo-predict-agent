from __future__ import annotations

import argparse
from pathlib import Path

from .preference_model import build_training_sets, read_json, write_jsonl


def main() -> None:
    parser = argparse.ArgumentParser(description="Build EvoMate preference/policy training datasets")
    parser.add_argument("--job", help="Optional job manifest JSON")
    parser.add_argument("--dataset", help="Optional remote dataset JSON")
    parser.add_argument("--out", required=True, help="Output training directory")
    args = parser.parse_args()

    job = read_json(Path(args.job), {}) if args.job else {}
    dataset = read_json(Path(args.dataset), {"samples": []}) if args.dataset else {"samples": []}
    sets = build_training_sets(job, dataset)
    out = Path(args.out)
    write_jsonl(out / "preference_dataset.jsonl", sets["preference"])
    write_jsonl(out / "pairwise_dataset.jsonl", sets["pairwise"])
    write_jsonl(out / "policy_dataset.jsonl", sets["policy"])
    print({"ok": True, "counts": {key: len(value) for key, value in sets.items()}, "out": str(out)})


if __name__ == "__main__":
    main()
