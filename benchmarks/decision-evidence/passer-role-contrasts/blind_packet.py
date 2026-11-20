"""Create a fixed reviewer packet from checked Stockfish lines alone."""

import argparse
from hashlib import sha256
from pathlib import Path

import chess

from pawn_plans import assets
from freeze import read, write
from trials import initial


def describe(board, frame, prefix=()):
    uci = [*prefix, *frame["pvUci"][:10]]
    notation = board.variation_san([chess.Move.from_uci(move) for move in uci])
    return f'{frame["cp"] if frame["mate"] is None else "mate " + str(frame["mate"])} {notation}'


def packet(current, deeper, destination, counts):
    exact = {row["id"]: row for row in current}
    groups = ("advanced", "ordinary")
    chosen = []
    for category, size in zip(groups, counts):
        group = [row for row in deeper if row["category"] == category]
        group.sort(key=lambda row: sha256(("blind-pawn-role|" + row["id"]).encode()).hexdigest())
        chosen += group[:size]
    write(destination / "review-roster.json", [dict(id=row["id"], category=row["category"]) for row in chosen])
    for start in range(0, len(chosen), 12):
        lines = []
        for ordinal, row in enumerate(chosen[start:start + 12], start=start + 1):
            board = initial(row)
            legal = assets(board)
            public = " ".join(chess.square_name(square) + ("w" if color else "b") for square,color in legal.items())
            normal_top = exact[row["id"]]["candidates"][0]
            lines += [f"{ordinal:02} {row['id']} {row['category']} {public or '-'}", row["fen"],
                      "Exact normal choice: " + describe(board,normal_top)]
            for variant in row["candidates"][:3]:
                lines.append("D " + describe(board, variant))
            for probe in row["replyProbes"]:
                lines += ["R " + describe(board, frame, [probe["moveUci"]]) for frame in probe["lines"][:2]]
        with (destination / f"review-{start + 1:02}.txt").open("x", encoding="utf8", newline="\n") as handle:
            handle.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("normal", "deep", "destination"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--advanced", type=int, default=24)
    parser.add_argument("--ordinary", type=int, default=12)
    args = parser.parse_args()
    packet(read(args.normal), read(args.deep), args.destination, (args.advanced, args.ordinary))
