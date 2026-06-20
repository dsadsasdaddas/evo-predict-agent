"""EvoMate training package.

This package is intentionally dependency-light: the first real training path
uses pure-Python linear models so the hackathon prototype can train locally or
on the remote V100 box without a fragile CUDA/PyTorch setup. The artifact
contracts are designed so a Transformer/LoRA reward model can replace these
models later without changing the EvoMate runtime.
"""

from .pipeline import run_training_pipeline

__all__ = ["run_training_pipeline"]
