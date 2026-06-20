from __future__ import annotations

import argparse
from pathlib import Path

from .preference_model import build_embedding_index, read_jsonl, write_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Build EvoMate user-memory embedding index")
    parser.add_argument("--dataset", required=True, help="preference_dataset.jsonl")
    parser.add_argument("--out", required=True, help="Output embedding index directory")
    parser.add_argument("--dimensions", type=int, default=64)
    args = parser.parse_args()

    rows = read_jsonl(Path(args.dataset))
    index = build_embedding_index(rows, dimensions=args.dimensions)
    out = Path(args.out)
    write_json(out / "embedding_index.json", index)
    print({"ok": True, "metrics": index.get("metrics"), "out": str(out)})


if __name__ == "__main__":
    main()
