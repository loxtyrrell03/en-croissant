"""Bind the blind review notes to exact legal moves and the engine frames used."""
import argparse
from hashlib import sha256
import json
from pathlib import Path

import chess


def read(path):
    return json.loads(path.read_bytes())


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def index(rows):
    by_id = {row["id"]: row for row in rows}
    if len(by_id) != len(rows):
        raise ValueError("Repeated board ID.")
    return by_id


def branches(board, common, deep):
    for frame in (common, deep):
        for row in (*frame["candidates"], *frame.get("comparisonCandidates", ())):
            yield row["pvUci"]
        for probe in frame["replyProbes"]:
            first = board.parse_uci(probe["moveUci"])
            for row in probe["lines"]:
                yield [first.uci(), *row["pvUci"]]


def replay(board, phrase):
    position = board.copy(stack=False)
    line = []
    for san in phrase.split():
        move = position.parse_san(san)
        line.append(move.uci())
        position.push(move)
    return line


def bind(case, common, deep, notes):
    for field in ("fen", "playedMoveUci", "history"):
        if not case[field] == common[field] == deep[field]:
            raise ValueError(f"Board mismatch for {case['id']} in {field}")
    board = chess.Board(case["fen"])
    moves = dict(move=common["candidates"][0]["pvUci"][0], mistake=case["playedMoveUci"])
    available = list(branches(board, common, deep))
    labels = dict(id=case["id"])
    for scope in ("position", "move", "mistake"):
        tactical, positional, note, phrases = notes[scope]
        if any(type(label) not in (type(None), bool) for label in (tactical, positional)):
            raise ValueError(f"Invalid axis label for {case['id']} in {scope}")
        witnesses = [replay(board, phrase) for phrase in phrases]
        if not note or (any((tactical, positional)) and not witnesses):
            raise ValueError(f"No witness for {case['id']} in {scope}")
        if any(not path or not any(path == option[:len(path)] for option in available) for path in witnesses):
            raise ValueError(f"Unavailable engine witness for {case['id']} in {scope}: {phrases}")
        result = dict(tactical=tactical, positional=positional, note=note, linesUci=witnesses)
        if scope in moves:
            result["uci"] = moves[scope]
            if any((tactical, positional)) and not any(path[0] == result["uci"] for path in witnesses):
                raise ValueError(f"Wrong move witness for {case['id']} in {scope}")
        if scope == "move" and notes.get("motifs"):
            result["motifs"] = notes["motifs"]
        labels[scope] = result
    return labels


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("selection", "app", "deep", "notes", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    selection, app, deep, notes = (index(read(arg)) for arg in (args.selection, args.app, args.deep, args.notes))
    if not selection.keys() == app.keys() == deep.keys() == notes.keys():
        raise ValueError("The review inputs do not cover the same boards.")
    labels = dict(
        sampleSha256=digest(args.selection),
        engineFrameSha256=dict(app=digest(args.app), deep=digest(args.deep)),
        review=dict(date="2026-11-20", reviewer="One engine-assisted reviewer",
                    independentlySecondReviewed=False, classifiersHiddenBeforeSealing=True),
        cases=[bind(selection[key], app[key], deep[key], notes[key]) for key in selection],
    )
    with args.output.open("x", encoding="utf8", newline="\n") as result:
        json.dump(labels, result, ensure_ascii=False, indent=2)
        result.write("\n")


if __name__ == "__main__":
    main()
