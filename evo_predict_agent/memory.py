from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable


class JsonlMemory:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.records: list[dict] = []
        if self.path.exists():
            for line in self.path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    self.records.append(json.loads(line))

    def append(self, record: dict) -> dict:
        record = dict(record)
        record.setdefault("seq", len(self.records) + 1)
        self.records.append(record)
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        return record

    def tail(self, n: int = 20) -> list[dict]:
        return self.records[-n:]

    def all(self) -> list[dict]:
        return list(self.records)

    def __len__(self) -> int:
        return len(self.records)


def families(records: Iterable[dict]) -> list[str]:
    out = []
    for r in records:
        fam = r.get("family") or r.get("actual_family") or r.get("predicted_family")
        if fam:
            out.append(str(fam))
    return out
