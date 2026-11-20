"""Review the exact target of each reported attack in the saved continuation."""
from pathlib import Path
import argparse
import json

import chess


def describe(witness):
    position = chess.Board(witness["fen"])
    played = []
    original = None
    squares = [chess.parse_square(sq) for sq in witness["squares"]]
    source = squares[-2]
    target = squares[-1]
    stayed = None
    is_legal = False
    capture_ply = None
    current = None
    for ply, uci in enumerate(witness["lineUci"], 1):
        move = position.parse_uci(uci)
        played.append(position.san(move))
        if ply > witness["mechanismPly"] and capture_ply is None and (
                move.from_square == source and move.to_square == target):
            capture_ply = ply
            current = position.piece_at(target)
        position.push(move)
        if ply == witness["mechanismPly"]:
            original = position.piece_at(target)
            stayed = bool(original and original.color == position.turn)
            latent = position.copy(stack=False)
            latent.turn = not latent.turn
            is_legal = latent.is_legal(chess.Move(squares[-2], target))
        if witness["mechanismPly"] < ply and capture_ply is None and (
                target == move.from_square or target == move.to_square):
            stayed = False
    issue = "intact"
    if not stayed or current != original:
        issue = "replacement-or-empty"
    elif not is_legal:
        issue = "initial-capture-illegal"
    return dict(issue=issue, original=original.symbol() if original else None,
                actual=current.symbol() if current else None,
                source=chess.square_name(squares[-2]), target=chess.square_name(target),
                at=witness["mechanismPly"], payoff=witness["payoffPly"], capture=capture_ply, sans=played,
                fen=witness["fen"], line=witness["lineUci"], text=witness["description"])


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("score", "output"):
        p.add_argument(name,type=Path)
    a = p.parse_args()
    found = {}
    for row in json.loads(a.score.read_bytes()):
        for witness in row["discoveries"]:
            identity = (witness["fen"], witness["mechanismPly"], tuple(witness["lineUci"]))
            found.setdefault(identity, dict(id=row["id"], **describe(witness)))
    a.output.write_text(json.dumps(list(found.values()),indent=2),encoding="utf-8")
    from collections import Counter
    print(Counter(r["issue"] for r in found.values()))
    for row in (r for r in found.values() if r["issue"] != "intact"):
        print(row["id"], row["at"], row["original"], row["actual"], row["issue"], row["sans"])


if __name__ == "__main__":
    main()
