"""Assemble score-only chess examples from reviewed references and exact engine frames."""

import argparse
import json
from pathlib import Path

import chess


def read(path):
    return json.loads(Path(path).read_bytes())


def exercise_inputs(sample, reference, cache):
    source, engine = [], []
    rows = {row["id"]: row for row in read(sample)["cases"]}
    for label in read(reference)["cases"]:
        if label["scope"] != "move-justification" or not label.get("motifs"):
            continue
        row = rows[label["id"]]
        fen, move = row["fen"], label["moveUci"]
        meta = dict(id=row["id"], fen=fen, game=row.get("sourceGroup", "").removeprefix("game:"),
                    labels=label["motifs"])
        if row["sourceUci"] and row["sourceUci"][0] == move:
            source.append(dict(meta, line=row["sourceUci"]))
        raw = read(Path(cache) / f'{row["id"]}.json')
        exact = next((frame for frame in raw["deep"] if frame["pvUci"][0] == move), None)
        if exact:
            if exact["fen"] != fen:
                raise ValueError("Root continuation has the wrong position")
            engine.append(dict(meta, line=exact["pvUci"], depth=exact["depth"], cp=exact["cp"], mate=exact["mate"]))
    return source, engine


def checked_branch(board, decision, root, after):
    exact_board = board.copy(stack=False)
    exact_board.push_uci(decision)
    if root["fen"] != board.fen() or root["pvUci"][0] != decision or after["fen"] != exact_board.fen():
        raise ValueError("Replies refer to different exact moves")
    return exact_board


def mistake_inputs(path):
    result = {"missed": [], "played": [], "control": []}
    for entry in read(path)["results"]:
        row, label, frame = entry["row"], entry["label"], entry["frame"]
        played, best = row["playedMoveUci"], frame["best"]["pvUci"][0]
        if label["scope"] != "mistake-mechanism" or label["moveUci"] != played:
            raise ValueError("A mistake reference must match the recorded move")
        if played == best or not frame["legalPair"] or not frame["legalPlayed"] or not frame["legalPlayedReply"]:
            continue
        opponent, control = frame["playedReply"], frame["bestReply"]
        if not opponent or not control:
            continue
        board = chess.Board(row["fen"])
        played_board = checked_branch(board, played, frame["played"], opponent[0])
        better_board = checked_branch(board, best, frame["best"], control[0])
        best_root, actual_root = frame["best"], frame["played"]
        def score(line):
            if line["mate"] is not None:
                return 10000 if line["mate"] > 0 else -10000
            return line["cp"]
        loss = score(best_root) - score(actual_root)
        current = entry["report"]["mistake"] or {}
        meta = dict(id=row["id"], game=row["sourceGroup"], event=row["event"],
                    labels={axis: label.get(axis) for axis in ("tactical", "positional")},
                    verified={axis: current.get(axis, {}).get("support") == "supported"
                              for axis in ("tactical", "positional")}, loss=loss)
        branches = {"missed": (board, best_root), "played": (played_board, opponent[0]),
                    "control": (better_board, control[0])}
        for kind, (position, line) in branches.items():
            result[kind].append(dict(meta, fen=position.fen(), line=line["pvUci"],
                                     depth=line["depth"], cp=line["cp"], mate=line["mate"]))
    return result


def fork_audit_inputs(sample, reference, cache):
    labels = {row["id"]: row for row in read(reference)["cases"]}
    result = []
    for row in read(sample)["cases"]:
        label = labels[row["id"]]
        raw = read(Path(cache) / f'{row["id"]}.json')
        move = row["line"][0]
        actual = next(line for line in raw["comparison"] if line["pvUci"][0] == move)
        if label["moveUci"] != move or actual["fen"] != row["fen"]:
            raise ValueError("Audit reference or search describes a different move")
        result.append(dict(row, labels={"fork": label["fork"]}, line=actual["pvUci"],
                           depth=actual["depth"], cp=actual["cp"], mate=actual["mate"]))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--exercise", nargs=4, action="append", metavar=("NAME", "SAMPLE", "REFERENCE", "CACHE"),
                        default=[])
    parser.add_argument("--mistake", nargs=2, action="append", metavar=("NAME", "REPORT"), default=[])
    parser.add_argument("--fork-audit", nargs=3, metavar=("SAMPLE", "REFERENCE", "CACHE"))
    parser.add_argument("--motif-amendments", type=Path)
    args = parser.parse_args()
    payload = {}
    for name, sample, reference, cache in args.exercise:
        source, engine = exercise_inputs(sample, reference, cache)
        payload[f"{name}-source"], payload[f"{name}-engine"] = source, engine
    for name, report in args.mistake:
        payload.update({f"{name}-{kind}": cases for kind, cases in mistake_inputs(report).items()})
    if args.motif_amendments:
        for amendment in read(args.motif_amendments):
            for group in amendment["groups"]:
                row = next(row for row in payload[group] if row["id"] == amendment["id"])
                motif = amendment["motif"]
                if row["line"][0] != amendment["moveUci"] or row["labels"][motif] != amendment["previous"]:
                    raise ValueError("Motif amendment does not match the existing reference")
                row["labels"] = dict(row["labels"], **{motif: amendment["revised"]})
    if args.fork_audit:
        payload["fork-audit-engine"] = fork_audit_inputs(*args.fork_audit)
    payload = {name: rows for name, rows in payload.items() if rows}
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(payload, output, separators=(",", ":"))
    print(json.dumps({name: len(rows) for name, rows in payload.items()}))


if __name__ == "__main__":
    main()
