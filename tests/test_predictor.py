from evo_predict_agent.predictor import AutoMLPredictor


def test_predictor_returns_family():
    history = [
        {"family": "auth-bug", "signals": ["auth"]},
        {"family": "auth-bug", "signals": ["auth", "api-contract"]},
        {"family": "typescript-bug", "signals": ["typescript-error"]},
        {"family": "auth-bug", "signals": ["auth"]},
        {"family": "runtime-timeout", "signals": ["timeout"]},
    ]
    pred = AutoMLPredictor().predict(history, ["auth"], "401 after login")
    assert pred.family
    assert 0 <= pred.confidence <= 1
