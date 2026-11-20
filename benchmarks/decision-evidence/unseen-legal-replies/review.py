"""Adjudicate frozen exact questions and every provisionally accepted nomination."""

import argparse
from collections import Counter
from pathlib import Path

from legal_pool import order_questions
from freeze import read, write
from summary import key, san


def make_questions(frames, attempted):
    rows = {row["id"]: row for row in frames}
    questions = []
    recorded = set()
    seen = set()
    for result in attempted:
        row = rows[result["id"]]
        options = {key(option["proposal"]): option for option in order_questions(row) if option["unseen"]}
        if row["candidate"] and key(row["candidate"]) in options:
            recorded.add((row["id"], key(row["candidate"])))
            proposals = [row["candidate"]]
        else:
            proposals = []
        proposals.extend(line["proposal"] for line in result["attempts"].values()
                         if line["label"] == "guard-causal")
        for proposal in proposals:
            identity = row["id"], key(proposal)
            if identity not in seen:
                seen.add(identity)
                questions.append({name: result[name] for name in
                    ("id", "fen", "history", "site", "group", "category", "recorded")}
                    | {"candidate": proposal, "referenceExact": identity in recorded})
    return questions


def summarize(rows, adjudicated):
    archives = {(row["id"], key(row["candidate"])): row for row in adjudicated}
    recorded = {row["id"]: row for row in adjudicated if row["referenceExact"]}
    metrics = {arm: Counter() for arm in ("material", "linear", "neural", "preview")}
    per_game = []
    for row in rows:
        known = recorded.get(row["id"])
        arms = {}
        for arm, stats in metrics.items():
            attempt = row["attempts"].get(arm)
            accepted = attempt and attempt["label"] == "guard-causal"
            exact = bool(accepted and known and attempt["proposal"] == known["candidate"])
            if known and known["label"] == "positive":
                stats["confirmedExact" if exact else "missedExact"] += 1
            if not attempt:
                continue
            stats["checked"] += 1
            if row["category"] == "ordinary":
                stats["checkedOrdinary"] += 1
            if accepted:
                reference = archives[row["id"], key(attempt["proposal"])]
                verdict = reference["label"]
                stats["confirmed" if verdict == "positive" else "false" if verdict == "order-harmless" else "indeterminate"] += 1
                arms[arm] = dict(proposal=key(attempt["proposal"]), review=verdict, line=san(row, reference))
            else:
                arms[arm] = dict(proposal=key(attempt["proposal"]), review=attempt["label"])
        per_game.append(dict(id=row["id"], group=row["group"], site=row["site"], category=row["category"],
            pool=row["pool"], hiddenReference=known["label"] if known else None, attempts=arms))
    return dict(sample=dict(Counter(row["category"] for row in rows)),
        available=sum(row["pool"] > 0 for row in rows), hypotheses=sum(row["pool"] for row in rows),
        recorded=dict(Counter(row["label"] for row in recorded.values())), adjudicated=len(adjudicated),
        outcomes={arm: dict(stats) for arm, stats in metrics.items()}, cases=per_game)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    question = modes.add_parser("questions")
    for name in ("frames", "attempts", "output"):
        question.add_argument(name, type=Path)
    report = modes.add_parser("report")
    for name in ("attempts", "reference", "output"):
        report.add_argument(name, type=Path)
    args = parser.parse_args()
    attempts = read(args.attempts)
    if args.mode == "questions":
        result = make_questions(read(args.frames), attempts)
        text = Counter(case["referenceExact"] for case in result)
    else:
        result = summarize(attempts, read(args.reference))
        text = {key: value for key, value in result.items() if key != "cases"}
    write(args.output, result)
    print(text)
