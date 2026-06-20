import tempfile
import unittest
from pathlib import Path

from evo_predict_agent.training import run_training_pipeline


class TrainingPipelineTest(unittest.TestCase):
    def test_full_training_pipeline_writes_runtime_models(self):
        job = {"jobId": "job_unit_training", "type": "preference_train"}
        dataset = {
            "samples": [
                {
                    "id": "safe",
                    "user_input": "先看项目结构，不要直接改文件。",
                    "expected_gene": "gene_ask_before_execution",
                    "signals": ["coding_task", "permission_sensitive"],
                    "reward_if_matched": 0.92,
                },
                {
                    "id": "ml",
                    "user_input": "把真实机器学习训练闭环做完整。",
                    "expected_gene": "gene_yes_engineer_policy",
                    "signals": ["ml_policy", "evomap_integration"],
                    "reward_if_matched": 0.88,
                },
            ]
        }
        with tempfile.TemporaryDirectory() as directory:
            artifacts = Path(directory) / "artifacts"
            result = run_training_pipeline(job, dataset, artifacts)
            self.assertGreater(result["policy_eval"]["evolved_avg"], result["policy_eval"]["baseline_avg"])
            self.assertTrue((artifacts / "preference_model.json").exists())
            self.assertTrue((artifacts / "policy_model.json").exists())
            self.assertTrue((artifacts / "embedding_index.json").exists())
            self.assertIn("pairwise_accuracy", result["preference_model"]["metrics"])


if __name__ == "__main__":
    unittest.main()
