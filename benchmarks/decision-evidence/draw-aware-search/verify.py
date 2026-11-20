"""Check the recovered search frames against an independent legal replay."""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
from statistics import median

import chess


def read(path):
    return json.loads(path.read_bytes())


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def game_position(fen, history):
    if not history:
        return chess.Board(fen)
    board = chess.Board(history["fen"])
    for uci in history["moves"]:
        board.push_uci(uci)
    assert board.fen() == chess.Board(fen).fen()
    return board


def verify(frame, board, edits, history_available):
    by_rank = {edit["rank"]: edit for edit in edits}
    for rank, line in enumerate(frame):
        position = board.copy()
        edit = by_rank.get(rank)
        moves = line["pvUci"][:edit["plies"]] if edit else line["pvUci"]
        assert moves and chess.Board(line["fen"]).fen() == position.fen()
        for ply, uci in enumerate(moves):
            if history_available and position.can_claim_threefold_repetition():
                if edit and edit["claim"] and ply == 0 and len(moves) == 1:
                    # A claim can be made by proposing the exact first move.
                    position.push_uci(uci)
                    assert position.is_repetition(3)
                    break
                value = line.get("mate")
                if value is None:
                    value = line["cp"]
                    assert abs(value) > 50
                assert (value > 0) == (ply % 2 == 0)
            assert not position.is_game_over()
            position.push_uci(uci)
        if edit:
            if edit["claim"]:
                assert history_available and position.can_claim_threefold_repetition()
                assert abs(line["cp"]) <= 10 and line.get("mate") is None
            else:
                assert position.is_insufficient_material()
                assert abs(line["cp"]) <= 50 and line.get("mate") is None
        elif history_available and position.can_claim_threefold_repetition():
            value = line.get("mate")
            if value is None:
                value = line["cp"]
                assert abs(value) > 50
            assert (value > 0) == (len(moves) % 2 == 0)


def compare(raw_path, replay_path):
    input_rows = {row["id"]: row for row in read(raw_path)}
    replay = read(replay_path)
    assert set(input_rows) == {row["id"] for row in replay}
    scopes = ("root", "paired", "reply")
    changed, accepted = [], {arm: Counter() for arm in ("original", "revised")}
    totals, boundaries = Counter(), Counter()
    for row in replay:
        raw = input_rows[row["id"]]
        candidate = raw["candidates"]
        paired = raw.get("comparisonCandidates")
        probes = raw.get("replyProbes", [])
        frames = [candidate, paired, *[probe["lines"] for probe in probes]]
        assert len(row["original"]["accepted"]) == len(frames) == len(row["revised"]["accepted"])
        edits = row["revised"]["shortened"]
        boundaries.update("claim" if edit["claim"] else "insufficient material" for edit in edits)
        for scope, frame in enumerate(frames):
            name = scopes[min(scope, 2)]
            old = row["original"]["accepted"][scope]
            revised = row["revised"]["accepted"][scope]
            if frame:
                totals[name] += 1
            assert not old or revised, (row["id"], scope, "lost frame")
            accepted["original"][name] += old
            accepted["revised"][name] += revised
            edit_list = [edit for edit in edits if edit["scope"] == scope]
            if revised and (not old or edit_list):
                b = game_position(raw["fen"], raw.get("history"))
                if scope > 1:
                    b.push_uci(probes[scope-2]["moveUci"])
                verify(frame,b,edit_list,bool(raw.get("history")))
        if row["same"]:
            continue
        before, after = row.get("beforeReport"), row.get("afterReport")
        def describe(report):
            if not report:
                return None
            return {
                "position": report["position"]["category"],
                "positionTactical": report["position"]["tactical"]["reasons"],
                "positionPositional": report["position"]["positional"]["reasons"],
                "mistakeStatus": report["mistakeStatus"],
                "mistakeCategory": report["mistake"]["category"] if report["mistake"] else None,
                "mistakeTactical": report["mistake"]["tactical"]["reasons"] if report["mistake"] else [],
                "lossCp": report["mistake"]["evaluationLossCp"] if report["mistake"] else None,
            }
        changed.append(dict(id=row["id"], before=describe(before), after=describe(after),
                            recovered=[i for i, x in enumerate(row["revised"]["accepted"])
                                       if x and not row["original"]["accepted"][i]]))
    return dict(cases=len(replay), scoredInputSha256=digest(raw_path), suppliedFrames=dict(totals),
                accepted=accepted, boundedLines=boundaries, independentlyChecked=True,
                validationMs={arm: round(median(row[arm]["validationMs"] for row in replay), 3)
                              for arm in accepted}, changed=changed)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("local", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    d=args.local
    results = dict(
        archive=compare(args.archive, d/"archive-replay.json"),
        heldout=compare(d/"heldout-scored.json", d/"heldout-replay.json"),
        deeper=compare(d/"deeper-scored.json", d/"deeper-replay.json"),
        samples=read(d/"manifest.json"),
        frozenHeldoutSha256=digest(d/"heldout.json"),
    )
    with args.output.open("x",encoding="utf-8") as stream:
        json.dump(results,stream,ensure_ascii=False,indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main()
