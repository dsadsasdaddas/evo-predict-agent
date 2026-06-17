import tempfile
import unittest
from pathlib import Path

from evo_predict_agent.assets import AssetStore
from evo_predict_agent.capability import CapabilityEvaluator, CapabilityTask
from evo_predict_agent.evomap_gep import validate_schema


class CapabilityTest(unittest.TestCase):
    def test_evolved_beats_baseline_on_default_benchmark(self):
        with tempfile.TemporaryDirectory() as d:
            evaluator = CapabilityEvaluator(AssetStore(Path(d) / "assets"))
            report = evaluator.run_benchmark()
            self.assertGreater(report["evolved_avg"], report["baseline_avg"])
            self.assertGreater(report["absolute_improvement"], 0)
            self.assertIn("asset_id", report)

    def test_wrong_capability_gene_cannot_score_by_reuse_only(self):
        with tempfile.TemporaryDirectory() as d:
            evaluator = CapabilityEvaluator(AssetStore(Path(d) / "assets"))
            task = CapabilityTask(
                id="perf_with_auth_word_noise",
                capability_id="agent_loop_optimization",
                prompt="Agent loop is slow and burns tokens; auth callback is unrelated background text.",
                expected_family="performance-issue",
                required_evidence=["baseline", "measure", "latency", "cost"],
                validation_assertions=["measure", "before", "after"],
            )
            answer = evaluator.evolved_answer(task)
            score = evaluator.score(task, answer)
            self.assertEqual(answer["family"], "performance-issue")
            self.assertTrue(score["gene_relevant"])

    def test_validation_failure_does_not_solidify(self):
        with tempfile.TemporaryDirectory() as d:
            evaluator = CapabilityEvaluator(AssetStore(Path(d) / "assets"))
            task = CapabilityTask(
                id="impossible_task",
                capability_id="auth_boundary_repair",
                prompt="Discuss CSS layout colors only.",
                expected_family="auth-bug",
                required_evidence=["cookie", "session"],
                validation_assertions=["401", "rerun"],
            )
            report = evaluator.run_benchmark([task])
            self.assertFalse(report["rows"][0]["solidify_allowed"])
            self.assertEqual(evaluator.solidify_improvements(report), [])

    def test_schema_validate_default_assets(self):
        with tempfile.TemporaryDirectory() as d:
            assets_dir = Path(d) / "assets"
            store = AssetStore(assets_dir)
            store.init_defaults()
            result = validate_schema(assets_dir)
            self.assertTrue(result["ok"], result)
            self.assertEqual(result["total"], 4)


if __name__ == "__main__":
    unittest.main()
