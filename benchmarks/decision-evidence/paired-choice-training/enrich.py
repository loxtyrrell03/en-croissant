"""Select extra public training games with independently recorded evaluation drops."""
import argparse
from collections import defaultdict
from hashlib import sha256
from pathlib import Path

from freeze import normalized_family
from frames import board_key, game_key, initial, records, write


def selection(ordinary, sources, maximum):
    games = {game_key(row) for row in ordinary}
    boards = {board_key(initial(row)) for row in ordinary}
    pools = defaultdict(list)
    candidates = []
    for archive in sources:
        for row in archive:
            if not row.get("site", "").startswith("https://lichess.org/broadcast/"):
                continue
            deep = row.get("deep", {}).get("root", [])
            move = row.get("playedMoveUci")
            scores = {item["pvUci"][0]: item["cp"] for item in deep if item["pvUci"] and item["cp"] is not None}
            saved_loss = row.get("previousAnnotatedLossCp")
            if saved_loss is None and move in scores:
                saved_loss = max(scores.values()) - scores[move]
            if not move or saved_loss is None or not 90 <= saved_loss <= 650:
                continue
            candidates.append((sha256(("tactical-transfer-training-v1|" + row["id"]).encode()).hexdigest(), row))
    for ticket, row in sorted(candidates, key=lambda item: item[0]):
        board = initial(row)
        if (board.chess960 or board.is_game_over(claim_draw=True)
            or len(board.piece_map()) < 12 or board.is_check()):
            continue
        move = board.parse_uci(row["playedMoveUci"])
        game, pos = game_key(row), board_key(board)
        if game in games or pos in boards:
            continue
        games.add(game)
        boards.add(pos)
        event = normalized_family(row["event"])
        pools[event].append({
            "id": f"known-loss-{ticket[:16]}", "event": event, "game": game,
            "fen": row["fen"], "history": row["history"], "site": row["site"],
            "trainingMove": move.uci(),
        })
    groups = [pool for _, pool in sorted(pools.items())]
    return [group[i] for i in range(max(map(len, groups), default=0))
            for group in groups if i < len(group)][:maximum]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("training", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("archives", nargs="+", type=Path)
    parser.add_argument("--maximum", type=int, default=230)
    args = parser.parse_args()
    chosen = selection(records(args.training), [records(path) for path in args.archives], args.maximum)
    write(args.output, chosen)
    print(f"Selected {len(chosen)} training games")
