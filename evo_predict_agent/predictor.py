from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from math import exp
from typing import Protocol

from .memory import families
from .signals import default_family_from_signals


@dataclass
class Prediction:
    family: str
    confidence: float
    model: str
    reasons: list[str]
    candidates: list[dict]


class Model(Protocol):
    name: str
    def predict(self, history: list[dict], signals: list[str], context: str) -> Prediction: ...


class RuleSignalModel:
    name = "rule_signal"

    def predict(self, history: list[dict], signals: list[str], context: str) -> Prediction:
        fam = default_family_from_signals(signals)
        return Prediction(fam, 0.55 if fam != "general-question" else 0.35, self.name,
                          [f"mapped leading signal(s) {signals[:3]} to {fam}"], [])


class RecencyFrequencyModel:
    name = "recency_frequency"

    def predict(self, history: list[dict], signals: list[str], context: str) -> Prediction:
        recent = history[-20:]
        weights = Counter()
        for i, rec in enumerate(recent):
            fam = rec.get("family") or rec.get("actual_family") or rec.get("predicted_family")
            if fam:
                weights[str(fam)] += 1.0 + i / max(len(recent), 1)
        if not weights:
            return RuleSignalModel().predict(history, signals, context)
        fam, score = weights.most_common(1)[0]
        total = sum(weights.values()) or 1.0
        return Prediction(fam, min(0.8, 0.35 + score / total), self.name,
                          ["recent history is dominated by this problem family"],
                          [{"family": k, "score": round(v / total, 3)} for k, v in weights.most_common(5)])


class TransitionModel:
    name = "transition"

    def predict(self, history: list[dict], signals: list[str], context: str) -> Prediction:
        seq = families(history)
        if len(seq) < 3:
            return RuleSignalModel().predict(history, signals, context)
        last = seq[-1]
        trans = Counter()
        for a, b in zip(seq, seq[1:]):
            if a == last:
                trans[b] += 1
        if not trans:
            return RecencyFrequencyModel().predict(history, signals, context)
        fam, cnt = trans.most_common(1)[0]
        conf = min(0.82, 0.4 + cnt / max(sum(trans.values()), 1))
        return Prediction(fam, conf, self.name,
                          [f"after {last}, history most often transitions to {fam}"],
                          [{"family": k, "count": v} for k, v in trans.most_common(5)])


class SignalOverlapModel:
    name = "signal_overlap"

    def predict(self, history: list[dict], signals: list[str], context: str) -> Prediction:
        sigset = set(signals)
        family_signals: dict[str, Counter] = defaultdict(Counter)
        family_count = Counter()
        for rec in history:
            fam = rec.get("family") or rec.get("actual_family") or rec.get("predicted_family")
            if not fam:
                continue
            family_count[str(fam)] += 1
            for sig in rec.get("signals", []):
                family_signals[str(fam)][sig] += 1
        if not family_count:
            return RuleSignalModel().predict(history, signals, context)
        scored = []
        for fam, cnt in family_count.items():
            overlap = sum(family_signals[fam][s] for s in sigset)
            prior = cnt / max(sum(family_count.values()), 1)
            score = overlap + 0.25 * prior
            scored.append((score, fam, overlap, prior))
        scored.sort(reverse=True)
        best_score, fam, overlap, prior = scored[0]
        conf = 1 / (1 + exp(-best_score / 2))
        return Prediction(fam, min(0.88, max(0.35, conf)), self.name,
                          [f"current signals overlap prior {fam} cases {overlap} time(s)"],
                          [{"family": f, "score": round(s, 3)} for s, f, _, _ in scored[:5]])


class AutoMLPredictor:
    """Tiny transparent AutoML: backtest several predictors on history and use
    the one with the best rolling hit rate. This is deliberately simple and
    auditable for hackathon demos.
    """

    def __init__(self):
        self.models: list[Model] = [
            RuleSignalModel(),
            RecencyFrequencyModel(),
            TransitionModel(),
            SignalOverlapModel(),
        ]

    def _backtest_score(self, model: Model, history: list[dict]) -> float:
        if len(history) < 5:
            return 0.0
        hits = 0
        total = 0
        for i in range(3, len(history)):
            target = history[i].get("family") or history[i].get("actual_family")
            if not target:
                continue
            pred = model.predict(history[:i], history[i].get("signals", []), history[i].get("question", ""))
            hits += int(pred.family == target)
            total += 1
        return hits / total if total else 0.0

    def predict(self, history: list[dict], signals: list[str], context: str) -> Prediction:
        scores = [(self._backtest_score(m, history), m) for m in self.models]
        scores.sort(key=lambda x: x[0], reverse=True)
        best_score, best_model = scores[0]
        pred = best_model.predict(history, signals, context)
        pred.reasons.insert(0, f"AutoML selected {best_model.name} by rolling hit-rate={best_score:.2f}")
        pred.candidates = [{"model": m.name, "backtest_hit_rate": round(s, 3)} for s, m in scores] + pred.candidates
        return pred
