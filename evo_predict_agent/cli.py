from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from uuid import uuid4

from .assets import AssetStore, SCHEMA_VERSION
from .hash_utils import compute_asset_id
from .memory import JsonlMemory
from .predictor import AutoMLPredictor
from .pre_evolver import build_pre_evolution_card
from .signals import extract_signals, default_family_from_signals
from .evomap_gep import gep_info, verify_asset
from .capability import CapabilityEvaluator

ROOT = Path.cwd()
MEMORY_DIR = ROOT / "memory"
ASSETS_DIR = ROOT / "assets"


def _mem(name: str) -> JsonlMemory:
    return JsonlMemory(MEMORY_DIR / name)


def cmd_init(_args):
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    AssetStore(ASSETS_DIR).init_defaults()
    for name in ["interactions.jsonl", "predictions.jsonl", "outcomes.jsonl"]:
        (MEMORY_DIR / name).touch(exist_ok=True)
    print(json.dumps({"ok": True, "repo": str(ROOT), "assets": str(ASSETS_DIR), "memory": str(MEMORY_DIR)}, ensure_ascii=False, indent=2))


def cmd_ingest(args):
    cmd_init(args) if not ASSETS_DIR.exists() else None
    signals = extract_signals("\n".join([args.question or "", args.context or "", args.summary or ""]))
    family = args.family or default_family_from_signals(signals)
    rec = {
        "id": "int_" + uuid4().hex[:12],
        "ts": time.time(),
        "question": args.question,
        "context": args.context,
        "signals": signals,
        "family": family,
        "outcome": args.outcome,
        "summary": args.summary,
    }
    _mem("interactions.jsonl").append(rec)
    if args.outcome == "success" and args.summary:
        store = AssetStore(ASSETS_DIR)
        gene = store.select_gene(signals, family)
        cap = {
            "type": "Capsule",
            "schema_version": SCHEMA_VERSION,
            "id": "capsule_" + uuid4().hex[:12],
            "trigger": signals,
            "problem_family": family,
            "gene": gene["id"],
            "summary": args.summary,
            "confidence": 0.75,
            "blast_radius": {"files": 0, "lines": 0},
            "outcome": {"status": "success", "score": 0.75},
            "strategy": gene.get("strategy", []),
        }
        cap = store.save_capsule(cap)
        rec["generated_capsule_asset_id"] = cap["asset_id"]
    print(json.dumps(rec, ensure_ascii=False, indent=2))


def _predict(context: str) -> tuple[list[str], object]:
    history = _mem("interactions.jsonl").all()
    signals = extract_signals(context)
    pred = AutoMLPredictor().predict(history, signals, context)
    return signals, pred


def cmd_predict(args):
    cmd_init(args) if not ASSETS_DIR.exists() else None
    signals, pred = _predict(args.context)
    rec = {
        "id": "pred_" + uuid4().hex[:12],
        "ts": time.time(),
        "context": args.context,
        "signals": signals,
        "predicted_family": pred.family,
        "confidence": round(pred.confidence, 3),
        "model": pred.model,
        "reasons": pred.reasons,
        "candidates": pred.candidates,
    }
    _mem("predictions.jsonl").append(rec)
    print(json.dumps(rec, ensure_ascii=False, indent=2))


def cmd_pre_evolve(args):
    cmd_init(args) if not ASSETS_DIR.exists() else None
    signals, pred = _predict(args.context)
    card = build_pre_evolution_card(context=args.context, signals=signals, prediction=pred, store=AssetStore(ASSETS_DIR))
    pred_rec = {
        "id": "pred_" + uuid4().hex[:12],
        "ts": time.time(),
        "context": args.context,
        "signals": signals,
        "predicted_family": pred.family,
        "confidence": round(pred.confidence, 3),
        "model": pred.model,
        "card_asset_id": card["asset_id"],
    }
    _mem("predictions.jsonl").append(pred_rec)
    out_path = MEMORY_DIR / f"pre_evolution_{pred_rec['id']}.json"
    out_path.write_text(json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"prediction": pred_rec, "card_path": str(out_path), "card": card}, ensure_ascii=False, indent=2))


def cmd_record_outcome(args):
    resolved = str(args.resolved).lower() in {"1", "true", "yes", "y"}
    rec = {
        "id": "out_" + uuid4().hex[:12],
        "prediction_id": args.prediction_id,
        "ts": time.time(),
        "actual_family": args.actual_family,
        "resolved": resolved,
        "score": 1.0 if resolved else 0.0,
        "summary": args.summary,
    }
    rec["asset_id"] = compute_asset_id(rec)
    _mem("outcomes.jsonl").append(rec)
    print(json.dumps(rec, ensure_ascii=False, indent=2))


def cmd_status(_args):
    store = AssetStore(ASSETS_DIR)
    store.init_defaults()
    status = {
        "interactions": len(_mem("interactions.jsonl")),
        "predictions": len(_mem("predictions.jsonl")),
        "outcomes": len(_mem("outcomes.jsonl")),
        "genes": len(store.load_genes()),
        "capsules": len(store.load_capsules()),
        "repo": str(ROOT),
    }
    print(json.dumps(status, ensure_ascii=False, indent=2))


def cmd_demo(args):
    cmd_init(args)
    samples = [
        ("登录后 callback 为什么 401", "changed auth callback route; session cookie missing", "auth-bug", "success", "Fixed auth callback by aligning cookie domain and server-side session read."),
        ("Next build TS2345 怎么修", "next build failed with TS2345 payload type mismatch", "typescript-bug", "success", "Fixed TypeScript payload mismatch at API boundary and reran typecheck."),
        ("接口 schema 变了测试失败", "API response JSON changed and unit test AssertionError", "api-bug", "success", "Updated API contract adapter and regression test for response shape."),
        ("登录态刷新后还是 unauthorized", "token refresh path returns 401 after login", "auth-bug", "success", "Fixed token refresh order before session read."),
        ("vitest 卡住超时", "test timed out due to missing AbortController cleanup", "runtime-timeout", "success", "Added cancellation cleanup and regression coverage for timeout branch."),
        ("middleware 403", "permission role policy blocks admin route", "permission-bug", "success", "Adjusted role policy check and added forbidden/allowed route tests."),
    ]
    for q, ctx, fam, outcome, summary in samples:
        ns = argparse.Namespace(question=q, context=ctx, family=fam, outcome=outcome, summary=summary)
        cmd_ingest(ns)
    print("\n--- demo prediction ---")
    cmd_pre_evolve(argparse.Namespace(context="I changed app/api/auth/callback and now login returns 401 unauthorized after token refresh"))




def cmd_capability_eval(args):
    cmd_init(args) if not ASSETS_DIR.exists() else None
    evaluator = CapabilityEvaluator(AssetStore(ASSETS_DIR))
    report = evaluator.run_benchmark()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "out": str(out),
        "baseline_avg": report["baseline_avg"],
        "evolved_avg": report["evolved_avg"],
        "absolute_improvement": report["absolute_improvement"],
        "relative_improvement_pct": report["relative_improvement_pct"],
        "asset_id": report["asset_id"],
    }, ensure_ascii=False, indent=2))


def cmd_capability_solidify(args):
    evaluator = CapabilityEvaluator(AssetStore(ASSETS_DIR))
    report_path = Path(args.report)
    if report_path.exists():
        report = json.loads(report_path.read_text(encoding="utf-8"))
    else:
        report = evaluator.run_benchmark()
    capsules = evaluator.solidify_improvements(report)
    print(json.dumps({"ok": True, "capsules_created": len(capsules), "asset_ids": [c.get("asset_id") for c in capsules]}, ensure_ascii=False, indent=2))


def cmd_gep_info(_args):
    print(json.dumps(gep_info(), ensure_ascii=False, indent=2))


def cmd_export_gep(args):
    store = AssetStore(ASSETS_DIR)
    store.init_defaults()
    genes = store.load_genes()
    capsules = store.load_capsules()
    bundle = {
        "protocol": "gep-a2a",
        "protocol_version": "1.0.0",
        "message_type": "local_export",
        "payload": {
            "assets": genes + capsules,
            "source": "evo-predict-agent",
            "note": "Local-only export. Not published to EvoMap Hub."
        }
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "out": str(out), "genes": len(genes), "capsules": len(capsules)}, ensure_ascii=False, indent=2))


def cmd_verify_assets(_args):
    store = AssetStore(ASSETS_DIR)
    store.init_defaults()
    assets = store.load_genes() + store.load_capsules()
    results = [{"id": a.get("id"), "type": a.get("type"), **verify_asset(a)} for a in assets]
    print(json.dumps({"ok": all(r.get("ok") for r in results), "results": results}, ensure_ascii=False, indent=2))


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="evo-predict")
    sub = p.add_subparsers(dest="cmd", required=True)
    sp = sub.add_parser("init"); sp.set_defaults(func=cmd_init)
    sp = sub.add_parser("ingest")
    sp.add_argument("--question", required=True)
    sp.add_argument("--context", default="")
    sp.add_argument("--family", default=None)
    sp.add_argument("--outcome", choices=["success", "failed", "unknown"], default="unknown")
    sp.add_argument("--summary", default="")
    sp.set_defaults(func=cmd_ingest)
    sp = sub.add_parser("predict")
    sp.add_argument("--context", required=True)
    sp.set_defaults(func=cmd_predict)
    sp = sub.add_parser("pre-evolve")
    sp.add_argument("--context", required=True)
    sp.set_defaults(func=cmd_pre_evolve)
    sp = sub.add_parser("record-outcome")
    sp.add_argument("--prediction-id", required=True)
    sp.add_argument("--actual-family", required=True)
    sp.add_argument("--resolved", required=True)
    sp.add_argument("--summary", default="")
    sp.set_defaults(func=cmd_record_outcome)
    sp = sub.add_parser("status"); sp.set_defaults(func=cmd_status)
    sp = sub.add_parser("capability-eval"); sp.add_argument("--out", default="memory/capability_report.json"); sp.set_defaults(func=cmd_capability_eval)
    sp = sub.add_parser("capability-solidify"); sp.add_argument("--report", default="memory/capability_report.json"); sp.set_defaults(func=cmd_capability_solidify)
    sp = sub.add_parser("gep-info"); sp.set_defaults(func=cmd_gep_info)
    sp = sub.add_parser("export-gep"); sp.add_argument("--out", default="memory/gep_bundle.local.json"); sp.set_defaults(func=cmd_export_gep)
    sp = sub.add_parser("verify-assets"); sp.set_defaults(func=cmd_verify_assets)
    sp = sub.add_parser("demo"); sp.set_defaults(func=cmd_demo)
    return p


def main(argv: list[str] | None = None):
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
