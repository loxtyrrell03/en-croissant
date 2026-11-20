"""Check complementary nominations in saved mixed-position queues.

This is a retrospective test on previously reported references. Both arms
use the same total and event-by-event review budgets as the recorded tree.
"""
from collections import Counter
from itertools import zip_longest
import json
from pathlib import Path


COHORTS = (
    (
        "maia-branch-probe/position-results.json", "transfer",
        "maia-nomination-v32/tournament-position-reference-v32.json",
    ),
    (
        "strategic-continuation-contrast/holdout-neural-results.json", "results",
        "strategic-continuation-contrast/holdout.json",
    ),
    (
        "strategic-continuation-contrast/reserve-neural-results.json", "results",
        "strategic-continuation-contrast/reserve.json",
    ),
)


def load(path):
    return json.loads(path.read_bytes())


def labels(raw):
    data = raw["cases"] if isinstance(raw, dict) else raw
    outcomes = {}
    for item in data:
        item = item.get("label", item)
        axes = [item["tactical"], item["positional"]]
        outcomes[item["id"]] = (
            "positive" if all(value is True for value in axes)
            else "negative" if any(value is False for value in axes)
            else "uncertain"
        )
    return outcomes


def tournament(case_id):
    return case_id.removeprefix("tournament-").rsplit("-", 2)[0]


def interleave(incumbent, other):
    sources = Counter(tournament(case_id) for case_id in incumbent)
    selected = []
    for event, slots in sources.items():
        queues = (
            [case_id for case_id in order if tournament(case_id) == event]
            for order in (incumbent, other)
        )
        pool = list(dict.fromkeys(
            case_id for pair in zip_longest(*queues) for case_id in pair if case_id is not None
        ))
        selected.extend(pool[:slots])
    assert Counter(map(tournament, selected)) == sources
    return selected


def evaluate(root):
    all_results = {}
    seen_sources = set()
    for file, key, reference in COHORTS:
        rankings = load(root / file)[key]["mixed"]["rankings"]
        truth = labels(load(root / reference))
        sources = {tournament(case_id) for case_id in truth}
        assert seen_sources.isdisjoint(sources)
        seen_sources.update(sources)
        tree = rankings["line-tree"]["selected"]
        tree_counts = Counter(truth[case_id] for case_id in tree)
        for word in ("positive", "negative", "uncertain"):
            assert tree_counts[word] == rankings["line-tree"][word + ("s" if word != "uncertain" else "")]
        options = {
            "tree": tree,
            "maiaRoot": rankings["line-maia-root"]["selected"],
            "treeWithMaiaRoot": interleave(tree, rankings["line-maia-root"]["selected"]),
            "treeWithLineLogistic": interleave(tree, rankings["line-logistic"]["selected"]),
        }
        known_positive_pool = {
            case_id for order in (options["tree"], options["maiaRoot"])
            for case_id in order if truth[case_id] == "positive"
        }
        all_results[file] = {
            "reviewed": len(truth),
            "reviewSlots": len(tree),
            "positiveOverlap": sum(
                truth[case_id] == "positive" for case_id in set(tree).intersection(options["maiaRoot"])
            ),
            "positiveUnion": len(known_positive_pool),
            "replays": {
                name: {word: sum(truth[case_id] == word for case_id in order) for word in (
                    "positive", "negative", "uncertain",
                )}
                for name, order in options.items()
            },
        }
    return all_results


if __name__ == "__main__":
    print(json.dumps(evaluate(Path("benchmarks/decision-evidence")), indent=2))
