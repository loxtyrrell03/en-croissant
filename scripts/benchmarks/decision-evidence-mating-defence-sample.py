"""Sample checking moves from completed broadcasts by the next reply's annotation.

A finite-to-short-mate annotation selects a challenge, not a reference label.
Controls have the same number of legal evasions and little annotated change.
"""

import argparse
import importlib.util
import json
from pathlib import Path

import chess
import chess.pgn


SPEC = importlib.util.spec_from_file_location(
    "tournament", Path(__file__).with_name("decision-evidence-tournament.py"),
)
tournament = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tournament)


def checked_mate_in_one(board):
    for move in list(board.legal_moves):
        if not board.gives_check(move):
            continue
        board.push(move)
        mates = board.is_checkmate()
        board.pop()
        if mates:
            return True
    return False


def short_check_mate(board):
    """Independent, check-only selector. Quiet attacks are outside its scope."""
    if checked_mate_in_one(board):
        return 1
    for move in list(board.legal_moves):
        if not board.gives_check(move):
            continue
        board.push(move)
        replies = list(board.legal_moves)
        solved = bool(replies) and board.halfmove_clock < 99
        for reply in replies:
            if not solved:
                break
            board.push(reply)
            solved = checked_mate_in_one(board)
            board.pop()
        board.pop()
        if solved:
            return 2
    return None


def check_cases(board, nodes, legal_witness=False):
    for node in nodes:
        move = node.move
        fen, ply, side = board.fen(), board.ply(), board.turn
        options = board.legal_moves.count()
        board.push(move)
        if not (26 <= ply <= 119 and options >= 5 and board.is_check()
                and 2 <= board.legal_moves.count() <= 3):
            continue
        evasion = node.next()
        before = node.eval()
        after = evasion.eval() if evasion else None
        if not before or not after:
            continue
        cp = before.pov(side).score()
        if cp is None or abs(cp) > 800:
            continue
        mate, after_cp = after.pov(side).mate(), after.pov(side).score()
        if legal_witness:
            results = {}
            for reply in list(board.legal_moves):
                board.push(reply)
                results[reply.uci()] = short_check_mate(board)
                board.pop()
            weak = next((move for move, result in results.items() if result), None)
            if all(results.values()):
                continue
            stratum = "legal-check-mate-branch" if weak else "no-short-check-mate-branch"
        elif mate in (1, 2):
            weak = None
            stratum = "broadcast-short-mate-after-evasion"
        elif after_cp is not None and abs(cp - after_cp) <= 25:
            weak = None
            stratum = "broadcast-stable-evasion"
        else:
            continue
        yield dict(fen=fen, ply=ply, playedMoveUci=move.uci(),
                   playedEvasionUci=evasion.move.uci(), selectorEvasionUci=weak, stratum=stratum)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--event", nargs=2, action="append", required=True, metavar=("EVENT", "PGN"))
    parser.add_argument("--exclude-sample", type=Path, action="append", default=[])
    parser.add_argument("--per-stratum", type=int, default=10)
    parser.add_argument("--legal-witness", action="store_true")
    args = parser.parse_args()
    if args.output.exists() or args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError("Use a new sample outside the checkout")
    if args.per_stratum < 1:
        raise ValueError("The sample limit must be positive")
    excluded_keys, excluded_games, exclusions = set(), set(), []
    for sample in args.exclude_sample:
        raw = sample.read_bytes()
        exclusions.append(tournament.digest(raw))
        for case in json.loads(raw)["cases"]:
            excluded_keys.add(tournament.board_key(case["fen"]))
            if case.get("sourceGroup"):
                excluded_games.add(case["sourceGroup"])
    eligible, events = {}, {}
    for event, source in args.event:
        if event in events:
            raise ValueError("Provide distinct source names")
        path = Path(source)
        events[event] = {"sha256": tournament.digest(path.read_bytes()), "eligibleGames": 0}
        with path.open(encoding="utf-8-sig") as stream:
            while game := chess.pgn.read_game(stream):
                board = game.board()
                if game.errors or type(board) is not chess.Board or not board.is_valid():
                    continue
                if game.headers.get("Result") not in ("1-0", "0-1", "1/2-1/2"):
                    continue
                nodes = list(game.mainline())
                key = tournament.digest(
                    (tournament.board_key(board.fen()) + " " +
                     " ".join(node.move.uci() for node in nodes)).encode(),
                )
                if key in excluded_games or key in eligible:
                    continue
                rows = list(check_cases(board, nodes, args.legal_witness))
                if rows:
                    events[event]["eligibleGames"] += 1
                    eligible[key] = [dict(case, id=f"mating-defence-{event}-{key[:16]}-{case['ply']}",
                                          sourceGroup=key, event=event, split="validation",
                                          category="public-classical-broadcast") for case in rows]
    selection, counts = [], {}
    strata = (("legal-check-mate-branch", "no-short-check-mate-branch") if args.legal_witness else
              ("broadcast-short-mate-after-evasion", "broadcast-stable-evasion"))
    for stratum in strata:
        count = 0
        for group in sorted(eligible, key=tournament.order):
            if group in excluded_games:
                continue
            rows = [row for row in eligible[group] if row["stratum"] == stratum
                    and tournament.board_key(row["fen"]) not in excluded_keys]
            if not rows:
                continue
            chosen = min(rows, key=lambda row: tournament.order(row["id"]))
            selection.append(chosen)
            excluded_games.add(group)
            excluded_keys.add(tournament.board_key(chosen["fen"]))
            count += 1
            if count == args.per_stratum:
                break
        counts[stratum] = count
    if not all(counts.values()):
        raise ValueError(f"Both strata need positions. Found {counts}")
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(dict(protocol=1, events=events, exclusions=exclusions, cases=selection, strata=counts,
                       scope="Completed classical games. A recorded check has two or three legal evasions. "
                             "Selection uses annotations for a finite evaluation and "
                             + ("legal checking mates." if args.legal_witness else "the recorded reply score.")),
                  stream, indent=2)
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
