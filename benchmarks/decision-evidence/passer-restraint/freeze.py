"""Freeze one decision per independent broadcast with an existing advanced enemy passer."""
import argparse
from collections import Counter
import hashlib
from pathlib import Path
import sys

import chess

import importlib.util

def passed(board, square, color):
    return all(abs(chess.square_file(square) - chess.square_file(other)) > 1 or
               rank(other, color) <= rank(square, color)
               for other in board.pieces(chess.PAWN, not color))

def rank(square, color):
    return chess.square_rank(square) if color else 7 - chess.square_rank(square)

def module_at(path):
    sys.path.append(str(path.parent))
    spec = importlib.util.spec_from_file_location("broadcast_sampler", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sampler", type=Path)
    parser.add_argument("research", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("exclude", nargs="+", type=Path)
    args = parser.parse_args()
    sampler = module_at(args.sampler)
    barred = [row for path in args.exclude for row in sampler.read(path)]
    seen_sites = {row.get("site") for row in barred}
    seen_events = {sampler.family(row.get("site") or "") for row in barred}
    seen_events.update(row.get("event") for row in barred)
    def filtered(game, signature, site, used_boards):
        if site in seen_sites:
            return
        board = game.board()
        start, history = board.fen(), []
        nodes = list(game.mainline())
        for ply, node in enumerate(nodes):
            piece = board.turn
            opponent = not piece
            if 50 <= ply < min(200, len(nodes) - 5) and any(
                rank(square, opponent) == 5 and passed(board, square, opponent)
                for square in board.pieces(chess.PAWN, opponent)
            ):
                before, after = node.parent.eval(), node.eval()
                if before is not None and after is not None:
                    a, z = before.pov(piece).score(), after.pov(piece).score()
                    if a is not None and z is not None and abs(a) <= 650 and abs(z) <= 850 and a - z >= 65:
                        code = hashlib.sha256(f"checked-restraint-v1:{signature}:{ply}".encode()).hexdigest()[:16]
                        row = dict(id=f"passer-restraint-{code}", cohort="fresh-passer",
                                   fen=board.fen(), playedMoveUci=node.move.uci(), game=signature,
                                   site=site, event=sampler.family(site), ply=ply,
                                   previousAnnotatedLossCp=a-z, history=dict(fen=start,moves=history[:]))
                        if sampler.board_key(row) not in used_boards and not board.can_claim_draw():
                            yield row
            history.append(node.move.uci())
            board.push(node.move)
    sampler.choices = filtered
    rows, sources = sampler.select(args.research, [{k:v for k,v in row.items() if k not in ("site","event")}
                                                   for row in barred], 72)
    sampler.write(args.output, rows)
    events = Counter(row["event"] for row in rows)
    sampler.write(args.manifest, dict(events=events, sources=sources,
                                      eventsInEarlierBenchmarks=sorted(set(events) & seen_events)))
    print(len(rows), "frozen games", len(sources), "source files")
if __name__ == "__main__":
    main()
