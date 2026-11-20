"""Join exact-board Stockfish checks to the original En Croissant inputs."""

import argparse
import json
from pathlib import Path

from gather import digest, read


ARCHIVE = [
    "reply-coverage-audit/full-pair-input.json",
    "evidence-ceiling-v38/depth-input.json",
]
RESERVE = [
    "compared-motif-identity/reserve.json",
    "discovered-target-identity/classical.json",
    "blocked-defensive-resource/reserve-frames.jsonl",
]


def frame(lines, fen):
    return dict(lines[0], fen=fen)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("research", "checkpoints", "output"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--include-unselected", action="store_true")
    args = parser.parse_args()
    rows = {}
    searches = {}
    pawn_checks = {}
    sources = {}
    for cohort, files in (("archive", ARCHIVE), ("reserve", RESERVE)):
        for name in files:
            source = args.research / name
            sources[name] = digest(source)
            rows.update((row["id"], row) for row in read(source))
        source = args.checkpoints / f"strict-{cohort}-search.json"
        sources[source.name] = digest(source)
        for case in json.loads(source.read_bytes())["cases"]:
            searches[case["id"]] = (cohort, case)
        passed = args.checkpoints / f"{cohort}-passers.json"
        sources[passed.name] = digest(passed)
        for case in json.loads(passed.read_bytes())["cases"]:
            if case["confirmed"]:
                pawn_checks[case["id"]] = [
                    frame(reply["analysis"], reply["reachedFen"]) for reply in case["replies"]
                ]
    replay = []
    for case_id in rows if args.include_unselected else searches:
        original = rows[case_id]
        item = dict(id=case_id, input=original)
        if case_id in searches:
            cohort, verified = searches[case_id]
            item.update(cohort=cohort, captures=verified["captures"], expectedBoards=[verified["good"], verified["bad"]])
            if verified["captureSearch"] and verified["playedSearch"]:
                item["checkingDefence"] = {
                    "capture": frame(verified["captureSearch"], verified["good"]),
                    "played": frame(verified["playedSearch"], verified["bad"]),
                }
        if case_id in pawn_checks:
            item["passedAdvance"] = pawn_checks[case_id]
        replay.append(item)
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(dict(sources=sources, rows=replay), stream, separators=(",", ":"))
    print(f"Joined {len(searches)} searched decisions and {len(pawn_checks)} pawn tests into {len(replay)} worker inputs")


if __name__ == "__main__":
    main()
