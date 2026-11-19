"""Nominate independent played-move exchange challenges from shallow analysis."""
import argparse
import importlib.util
import json
from pathlib import Path

import chess
import chess.engine

def tournament_tools():
    path = Path(__file__).with_name('decision-evidence-tournament.py')
    spec = importlib.util.spec_from_file_location('tournament', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

POINTS = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}
NODES = 60_000

def balance(board, side):
    return sum(POINTS[p.piece_type] * (1 if p.color == side else -1) for p in board.piece_map().values())

def preview(engine, row):
    root = chess.Board(row['fen'])
    played = root.parse_uci(row['playedMoveUci'])
    advice = engine.analyse(root, chess.engine.Limit(nodes=NODES), game=object())
    good = advice.get('pv', [])
    if not good or good[0] == played:
        return None
    chosen = engine.analyse(root, chess.engine.Limit(nodes=NODES), root_moves=[played], game=object())
    bad = chosen.get('pv', [])
    limit = min(len(good), len(bad), 9)
    if limit < 5:
        return None
    control, actual, side = root.copy(stack=False), root.copy(stack=False), root.turn
    actual.push(played)
    reply = bad[1]
    capture, check = actual.is_capture(reply), actual.gives_check(reply)
    actual.push(reply)
    attacks_moved_piece = (
        actual.piece_type_at(played.to_square) not in (None, chess.PAWN, chess.KING)
        and played.to_square in actual.attacks(reply.to_square)
    )
    if not (capture or check or attacks_moved_piece):
        return None
    for move in good[:limit]:
        control.push(move)
    for move in bad[2:limit]:
        actual.push(move)
    difference = balance(control, side) - balance(actual, side)
    loss = balance(root, side) - balance(actual, side)
    return 'short-material-loss' if difference >= 1 and loss >= 1 else 'forcing-control'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('out', type=Path)
    parser.add_argument('engine', type=Path)
    parser.add_argument('pgn', type=Path)
    parser.add_argument('exclude', nargs='+', type=Path)
    parser.add_argument('--event', required=True)
    parser.add_argument('--per-stratum', type=int, default=8)
    parser.add_argument('--max-previews', type=int, default=500)
    args = parser.parse_args()
    if args.out.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError('Keep generated samples outside the checkout')
    if args.per_stratum < 1 or args.max_previews < 1:
        raise ValueError('Use positive sample and preview budgets')
    t = tournament_tools()
    seen_boards, seen_games, exclusions = set(), set(), []
    for path in args.exclude:
        raw = path.read_bytes()
        exclusions.append(t.digest(raw))
        for row in json.loads(raw)['cases']:
            seen_boards.add(t.board_key(row['fen']))
            if row.get('sourceGroup'):
                seen_games.add(row['sourceGroup'])
    games = t.read_games(args.pgn, seen_boards, broadcast_loss=True)
    counts = dict.fromkeys(('short-material-loss', 'forcing-control'), 0)
    rows, previews = [], 0
    with chess.engine.SimpleEngine.popen_uci(str(args.engine)) as engine:
        engine.configure({'Threads': 1, 'Hash': 16})
        for game_id in sorted(games, key=t.order):
            if game_id in seen_games:
                continue
            group = sorted(games[game_id], key=lambda row: t.order(f'{game_id}:{row["ply"]}'))
            for row in group:
                if row.get('broadcastLossCp', 0) < 80 or t.board_key(row['fen']) in seen_boards:
                    continue
                stratum = preview(engine, row)
                previews += 1
                if stratum and counts[stratum] < args.per_stratum:
                    row = {key: value for key, value in row.items() if key != 'pinChallenge'}
                    row.update(id=f'short-exchange-{args.event}-{game_id[:16]}-{row["ply"]}',
                               sourceGroup=game_id, event=args.event, stratum=stratum,
                               category='public-classical-broadcast', split='validation')
                    rows.append(row)
                    counts[stratum] += 1
                    seen_boards.add(t.board_key(row['fen']))
                    break
                if previews >= args.max_previews:
                    break
            if previews >= args.max_previews or all(n == args.per_stratum for n in counts.values()):
                break
    if min(counts.values()) < args.per_stratum:
        raise ValueError(f'Quota not met after {previews} previews: {counts}')
    with args.out.open('x', encoding='utf-8') as stream:
        json.dump(dict(protocol=1, scope='Classical played moves stratified by a shallow forcing or '
                       'attacking reply and short-horizon material difference; labels are reviewed separately.',
                       cases=rows, event=args.event, pgnSha256=t.digest(args.pgn.read_bytes()),
                       exclusions=exclusions, previewedPositions=previews, previewNodesPerSearch=NODES,
                       previewEngineSha256=t.digest(args.engine.read_bytes())), stream, indent=2)
        stream.write('\n')
    print(f'Selected {counts} from {previews} previewed positions')

if __name__ == '__main__':
    main()
