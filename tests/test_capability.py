import tempfile
import unittest
from pathlib import Path

from evo_predict_agent.assets import AssetStore
from evo_predict_agent.capability import CapabilityEvaluator


class CapabilityTest(unittest.TestCase):
    def test_evolved_beats_baseline_on_default_benchmark(self):
        with tempfile.TemporaryDirectory() as d:
            evaluator = CapabilityEvaluator(AssetStore(Path(d) / "assets"))
            report = evaluator.run_benchmark()
            self.assertGreater(report["evolved_avg"], report["baseline_avg"])
            self.assertGreater(report["absolute_improvement"], 0)
            self.assertIn("asset_id", report)


if __name__ == "__main__":
    unittest.main()
