from __future__ import annotations

import argparse
from pathlib import Path

from .preference_model import read_jsonl, train_policy_model, write_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Train EvoMate behavior policy model")
    parser.add_argument("--dataset", required=True, help="policy_dataset.jsonl")
    parser.add_argument("--out", required=True, help="Output policy model directory")
    parser.add_argument("--epochs", type=int, default=120)
    args = parser.parse_args()

    rows = read_jsonl(Path(args.dataset))
    result = train_policy_model(rows, epochs=args.epochs)
    out = Path(args.out)
    write_json(out / "policy_model.json", result.model)
    write_json(out / "metrics.json", result.metrics)
    print({"ok": True, "metrics": result.metrics, "out": str(out)})


if __name__ == "__main__":
    main()
