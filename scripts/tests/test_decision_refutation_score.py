import importlib.util
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location(
    "refutation_score",
    Path(__file__).resolve().parents[1] / "benchmarks" / "decision-evidence-refutation-score.py",
)
score = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(score)


def ranking(identifier):
    return dict(id=identifier, event="event", rankings={
        arm: ["a2a3", "a2a4"] if arm == "stockfish" else ["a2a4", "a2a3"]
        for arm in score.ARMS
    })


def verifier(first=False, second=False):
    return dict(eligible=True, baseline="a2a3", outcomes={
        "a2a3": dict(proof=first, requestedNodes=1_200_000),
        "a2a4": dict(proof=second, requestedNodes=2_200_000),
    })


class RefutationScoreTest(unittest.TestCase):
    def test_keeps_base_evidence_and_excludes_uncertain_manual_labels(self):
        reviewed = {
            "supported": dict(tactical=True, positional=True),
            "unresolved": dict(tactical=True, positional=False),
            "unknown": dict(tactical=None, positional=True),
        }
        baseline = {name: {"assessment": {"position": {
            "tactical": {"support": "supported" if name == "supported" else "unestablished"},
            "positional": {"support": "supported"},
        }}} for name in reviewed}
        labels = {
            "supported": verifier(first=True),
            "unresolved": verifier(second=True),
            "unknown": verifier(second=True),
        }
        report = score.report([ranking(name) for name in reviewed], labels, baseline, reviewed)
        self.assertEqual(report["reviewedBaselineTactical"], 1)
        self.assertEqual(report["reviewedTacticalWithAnyExtraChoice"], 2)
        self.assertEqual(report["availableProofPositions"], 3)
        self.assertEqual(report["arms"]["stockfish"]["app"]["verifiedExtraChoices"], 0)
        learned = report["arms"]["neural_ordered"]["app"]
        self.assertEqual(learned["verifiedExtraChoices"], 2)
        self.assertEqual(learned["axes"]["tactical"], dict(tp=2, fp=0, fn=0, tn=0, unknown=1))
        self.assertEqual(learned["axes"]["mixed"], dict(tp=1, fp=1, fn=0, tn=0, unknown=1))
        self.assertEqual(learned["additionalNodes"], 4_580_000)

    def test_rejects_ranking_missing_a_shortlisted_move(self):
        row = ranking("one")
        row["rankings"]["neural_ordered"] = ["a2a4"]
        with self.assertRaisesRegex(ValueError, "Ranked candidate set differs"):
            score.nominal(row, "neural_ordered", verifier())


if __name__ == "__main__":
    unittest.main()
