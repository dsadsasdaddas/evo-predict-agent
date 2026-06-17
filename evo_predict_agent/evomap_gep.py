from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from .hash_utils import compute_asset_id

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / "scripts" / "gep_bridge.mjs"


def _run_bridge(cmd: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    p = subprocess.run(
        ["node", str(BRIDGE), cmd],
        input=data,
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )
    return json.loads(p.stdout.decode("utf-8"))


def gep_info() -> dict[str, Any]:
    return _run_bridge("info")


def official_schema_version() -> str:
    try:
        return str(gep_info()["schema_version"])
    except Exception:
        return "1.0.0"


def stamp_asset(asset: dict[str, Any]) -> dict[str, Any]:
    """Stamp with official @evomap/gep-sdk when available.

    Fallback exists only so local Python tests do not crash before npm install;
    production/demo path should run `npm install` and use official SDK.
    """
    try:
        return _run_bridge("stamp", asset)
    except Exception:
        out = dict(asset)
        out.setdefault("schema_version", "1.0.0")
        out["asset_id"] = compute_asset_id(out)
        return out


def verify_asset(asset: dict[str, Any]) -> dict[str, Any]:
    try:
        return _run_bridge("verify", asset)
    except Exception:
        return {"ok": asset.get("asset_id") == compute_asset_id(asset), "fallback": True}


def validate_schema(assets_dir: str | Path = "assets") -> dict[str, Any]:
    return _run_bridge("validate-schema", {"assets_dir": str(assets_dir)})
