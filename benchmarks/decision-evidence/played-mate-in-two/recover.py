"""Recover the actual move before a cached puzzle's quiet mating start."""
import argparse
import hashlib
import io
import json
from pathlib import Path
from urllib.request import Request, urlopen

import chess
import chess.pgn

from sample import root_offer, write


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("choices", "output", "manifest", "pgn_dir"):
        parser.add_argument(key, type=Path)
    args = parser.parse_args()
    raw = json.loads(args.choices.read_bytes())
    args.pgn_dir.mkdir(exist_ok=True)
    picked, sources = [], {}
    for row in raw:
        game_id = row["game"]
        url = f"https://lichess.org/game/export/{game_id}?clocks=false&evals=false"
        path = args.pgn_dir / f"{game_id}.pgn"
        if not path.exists():
            request = Request(url, headers={"User-Agent": "En Croissant classifier research"})
            with urlopen(request, timeout=15) as response:
                payload = response.read(100_000)
            with path.open("xb") as stream:
                stream.write(payload)
        payload = path.read_bytes()
        sources[game_id] = dict(url=url, sha256=hashlib.sha256(payload).hexdigest())
        game = chess.pgn.read_game(io.StringIO(payload.decode("utf-8-sig")))
        if not game or game.errors:
            continue
        board = game.board()
        target = chess.Board(row["fen"]).fen()
        for move in game.mainline_moves():
            before = board.copy()
            board.push(move)
            if board.fen() != target:
                continue
            reference = root_offer(before, move, True)
            if reference and reference["kind"] == "allowed-two" and not reference["checking"]:
                picked.append(dict(id=f"puzzle-played-two-{row['id']}", fen=before.fen(),
                                   playedMoveUci=move.uci(), gameMoveUci=move.uci(), game=game_id,
                                   event="lichess-quiet-start", reference=reference,
                                   history=dict(fen=game.board().fen(),
                                                moves=[item.uci() for item in before.move_stack])))
            break
    write(args.output, picked)
    write(args.manifest, dict(sources=sources, selected=len(picked)))
    print("Recovered quiet starts",len(picked))


if __name__ == "__main__":
    main()
