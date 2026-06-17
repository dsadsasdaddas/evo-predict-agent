from __future__ import annotations

import hashlib
import json
from typing import Any


def _clean(obj: Any, exclude: set[str]) -> Any:
    if isinstance(obj, dict):
        return {k: _clean(v, exclude) for k, v in sorted(obj.items()) if k not in exclude}
    if isinstance(obj, list):
        return [_clean(v, exclude) for v in obj]
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    return str(obj)


def canonicalize(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def compute_asset_id(obj: dict, exclude_fields: list[str] | None = None) -> str:
    exclude = set(exclude_fields or ["asset_id"])
    clean = _clean(obj, exclude)
    return "sha256:" + hashlib.sha256(canonicalize(clean).encode("utf-8")).hexdigest()
