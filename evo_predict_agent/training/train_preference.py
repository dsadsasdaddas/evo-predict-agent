from __future__ import annotations

import argparse
from pathlib import Path

from .preference_model import read_jsonl, train_pairwise_reward_model, write_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Train EvoMate pairwise preference reward model")
    parser.add_argument("--dataset", required=True, help="pairwise_dataset.jsonl")
    parser.add_argument("--out", required=True, help="Output reward model directory")
    parser.add_argument("--epochs", type=int, default=90)
    args = parser.parse_args()

    rows = read_jsonl(Path(args.dataset))
    result = train_pairwise_reward_model(rows, epochs=args.epochs)
    out = Path(args.out)
    write_json(out / "preference_model.json", result.model)
    write_json(out / "metrics.json", result.metrics)
    print({"ok": True, "metrics": result.metrics, "out": str(out)})


if __name__ == "__main__":
    main()
