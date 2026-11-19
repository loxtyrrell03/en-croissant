"""Freeze classical played decisions where a shallow search changes rook pressure."""
import argparse
import importlib.util
import json
from pathlib import Path

import chess
import chess.engine

NODES = 60_000

def pressures(board, side):
    result = set()
    for rook in board.pieces(chess.ROOK, side):
        attacked = board.attacks(rook)
        rank = chess.square_rank(rook) if side else 7 - chess.square_rank(rook)
        target_file = chess.square_file(rook)
        doubled = any(chess.square_file(partner) == target_file
                      for partner in attacked & board.pieces(chess.ROOK, side))
        for pawn in attacked & board.pieces(chess.PAWN, not side):
            if rank >= 3 or (doubled and chess.square_file(pawn) == target_file):
                result.add((rook, pawn))
    return result

def sustained(board, moves, side):
    start = pressures(board, side)
    trial = board.copy(stack=False)
    states = []
    for move in moves[:9]:
        trial.push(move)
        states.append(pressures(trial, side))
    durable = set().union(*(a & b for a, b in zip(states, states[1:])))
    return {pawn for _, pawn in durable - start}

def preview(engine, row):
    board = chess.Board(row['fen'])
    if not board.pieces(chess.ROOK, board.turn) or not board.pieces(chess.PAWN, not board.turn):
        return None
    chosen = board.parse_uci(row['playedMoveUci'])
    better = engine.analyse(board, chess.engine.Limit(nodes=NODES), game=object()).get('pv', [])
    if not better or better[0] == chosen:
        return None
    played = engine.analyse(board, chess.engine.Limit(nodes=NODES), root_moves=[chosen], game=object()).get('pv', [])
    limit = min(len(better), len(played), 9)
    if limit < 4:
        return None
    good = sustained(board, better[:limit], board.turn)
    actual = sustained(board, played[:limit], board.turn)
    return 'preview-rook-pressure' if good - actual else 'preview-control'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('out', type=Path)
    parser.add_argument('engine', type=Path)
    parser.add_argument('--event', action='append', nargs=3, metavar=('ID', 'PGN', 'PER_STRATUM'), required=True)
    parser.add_argument('--exclude', type=Path, action='append', default=[])
    args = parser.parse_args()
    sampler = Path(__file__).with_name('decision-evidence-tournament.py')
    spec = importlib.util.spec_from_file_location('tournament', sampler)
    tournament = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tournament)
    if args.out.resolve().is_relative_to(sampler.resolve().parents[2]):
        raise ValueError('Keep generated samples outside the checkout')
    seen, games_seen, exclusions = set(), set(), []
    for path in args.exclude:
        data = path.read_bytes()
        exclusions.append(tournament.digest(data))
        for case in json.loads(data)['cases']:
            seen.add(tournament.board_key(case['fen']))
            if case.get('sourceGroup'):
                games_seen.add(case['sourceGroup'])
    cases, events = [], {}
    with chess.engine.SimpleEngine.popen_uci(str(args.engine)) as engine:
        engine.configure({'Threads': 1, 'Hash': 16})
        for event, pgn, quota in args.event:
            quota = int(quota)
            if quota < 1:
                raise ValueError('Require a positive quota')
            path = Path(pgn)
            groups = tournament.read_games(path, seen, broadcast_loss=True)
            counts = {'preview-rook-pressure': 0, 'preview-control': 0}
            previews = 0
            for game in sorted(groups, key=tournament.order):
                if game in games_seen:
                    continue
                for row in sorted(groups[game], key=lambda row: tournament.order(f'{game}:{row["ply"]}')):
                    key = tournament.board_key(row['fen'])
                    if row.get('broadcastLossCp', 0) < 60 or key in seen:
                        continue
                    stratum = preview(engine, row)
                    previews += 1
                    if stratum and counts[stratum] < quota:
                        case = {key: value for key, value in row.items() if key != 'pinChallenge'}
                        case.update(id=f'rook-pressure-{event}-{game[:16]}-{row["ply"]}',
                                    event=event, stratum=stratum, sourceGroup=game,
                                    split='validation', category='public-classical-broadcast')
                        cases.append(case)
                        counts[stratum] += 1
                        seen.add(key)
                        games_seen.add(game)
                        break
                if min(counts.values()) >= quota:
                    break
            events[event] = dict(pgnSha256=tournament.digest(path.read_bytes()), counts=counts, previews=previews)
    if not cases or any(min(event['counts'].values()) == 0 for event in events.values()):
        raise ValueError(f'No comparison cohort: {events}')
    with args.out.open('x', encoding='utf-8') as out:
        json.dump(dict(protocol=1, cases=cases, events=events, exclusions=sorted(exclusions),
                       engineSha256=tournament.digest(args.engine.read_bytes()), nodesPerPreview=NODES,
                       scope='Shallow single-PV rook pressure lasting at least two board positions nominates cases. '
                             'Full search outcomes and classifier decisions are blind during sampling.'), out, indent=2)
        out.write('\n')
    print(events)

if __name__ == '__main__':
    main()
