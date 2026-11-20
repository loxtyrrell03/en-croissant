"""Freeze game-, board- and event-disjoint alternatives before the reference searches."""
import argparse
from collections import defaultdict
from hashlib import sha256
import json
from pathlib import Path
import sys

import chess
import chess.pgn

SUITES = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SUITES / "neural-deep-witness"))
from frames import board_key, classical_sources, game_key, records, write

sys.path.insert(0, str(SUITES / "strategic-choice-contrast"))
from audit_split import normalized_family

SEED = "paired-choice-training-20261120-v1"


def ticket(*parts):
    return sha256("|".join(map(str, (SEED, *parts))).encode()).hexdigest()


def eligible(game, fingerprint):
    root = game.board()
    moves = list(game.mainline_moves())
    out = []
    for ply, move in enumerate(moves):
        if (
            32 <= ply < min(100, len(moves) - 6)
            and len(root.piece_map()) >= 12
            and not root.is_check()
            and root.halfmove_clock < 40
        ):
            out.append((ticket(fingerprint, ply), ply, root.fen(), board_key(root)))
        root.push(move)
    return moves, sorted(out)


def freeze(lab, prior, external_manifest, train_size, test_size):
    already = [r for path in prior for r in records(path) if "fen" in r]
    prior_roots = {board_key(chess.Board(r["fen"])) for r in already}
    prior_games = {game_key(r) for r in already if len((r.get("history") or {}).get("moves", [])) >= 24}
    prior_events = {normalized_family(r["event"]) for r in already if r.get("event")}
    seen = set(prior_games)
    selected_boards = set(prior_roots)
    pools = defaultdict(list)
    files = {}
    # Prefer paths from a matching full event identity when archives contain duplicate PGNs.
    retained = classical_sources(lab)
    external = json.loads(external_manifest.read_bytes())
    reserve_families = {normalized_family(metadata["event"]) for metadata in external.values()}
    for name, metadata in external.items():
        path = external_manifest.parent / name
        if sha256(path.read_bytes()).hexdigest() != metadata["sha256"]:
            raise ValueError(f"Transfer PGN changed after capture: {name}")
        retained[path] = metadata["event"], metadata["round"]
    sources = sorted(retained.items(), key=lambda kv: (kv[1], kv[0].as_posix()))
    for path, (event, fallback) in sources:
        family = normalized_family(event)
        local = path.relative_to(lab).as_posix()
        with path.open(encoding="utf-8-sig", errors="replace") as stream:
            while (game := chess.pgn.read_game(stream)) is not None:
                if (game.errors or game.board().chess960 or
                    game.headers.get("Result", "*") not in {"1-0", "1/2-1/2", "0-1"}):
                    continue
                fen = game.board().fen()
                trace = [move.uci() for move in game.mainline_moves()]
                if len(trace) < 45:
                    continue
                fingerprint = game_key({"history": {"fen": fen, "moves": trace}})
                if fingerprint in seen:
                    continue
                seen.add(fingerprint)
                moves, windows = eligible(game, fingerprint)
                if not windows or any(key in prior_roots for _, _, _, key in windows):
                    continue
                position = next((window for window in windows if window[3] not in selected_boards), None)
                if position is None:
                    continue
                sample_id, ply, at, normalized = position
                selected_boards.add(normalized)
                site = game.headers.get("Site", "")
                pools[family].append({
                    "id": sample_id[:20], "event": family, "game": fingerprint, "fen": at, "source": local,
                    "site": site if site.startswith("https://lichess.org/broadcast/") else fallback,
                    "history": {"fen": fen, "moves": [move.uci() for move in moves[:ply]]},
                })
        files[local] = sha256(path.read_bytes()).hexdigest()
    # The transfer is reserved before labels exist. It gets first choice of disjoint families.
    possible = sorted((event for event in reserve_families - prior_events if len(pools[event]) >= 8),
                      key=lambda event: ticket("test", event))
    test_events = set(possible[:16])
    train_events = set(pools) - reserve_families

    def select(event_ids, size):
        groups = [sorted(pools[event], key=lambda row: row["id"]) for event in sorted(event_ids)]
        return [rows[i] for i in range(max(map(len, groups), default=0))
                for rows in groups if i < len(rows)][:size]

    train = select(train_events, train_size)
    test = select(test_events, test_size)
    if len(train) < train_size or len(test) < test_size:
        raise ValueError(f"Only {len(train)} training and {len(test)} transfer games available in disjoint pools")
    manifest = {
        "seed": SEED,
        "existingGamesExcluded": len(prior_games),
        "existingRootBoardsExcluded": len(prior_roots),
        "priorEvents": sorted(prior_events),
        "trainEvents": sorted({r["event"] for r in train}),
        "testEvents": sorted({r["event"] for r in test}),
        "sources": {r["source"]: files[r["source"]] for r in train + test},
        "priorSha256": {path.parent.name + "/" + path.name: sha256(path.read_bytes()).hexdigest() for path in prior},
        "transferSha256": sha256(external_manifest.read_bytes()).hexdigest(),
    }
    return train, test, manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("lab", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("prior", nargs="+", type=Path)
    parser.add_argument("--transfer", required=True, type=Path)
    parser.add_argument("--train", type=int, default=280)
    parser.add_argument("--test", type=int, default=120)
    args = parser.parse_args()
    training, held_out, receipt = freeze(args.lab, args.prior, args.transfer, args.train, args.test)
    args.output.mkdir(parents=True, exist_ok=True)
    write(args.output / "train.json", training)
    write(args.output / "holdout.json", held_out)
    write(args.output / "freeze.json", receipt)
    print(f"Frozen {len(training)} training and {len(held_out)} holdout positions")
