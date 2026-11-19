"""Sample early pawn-outcome contrasts without reading either classifier."""
import argparse
import importlib.util
import json
from pathlib import Path

import chess
import chess.engine


def local_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tournament = local_module('tournament', 'decision-evidence-tournament.py')
passers = local_module('passers', 'decision-evidence-passer-sample.py')
PREVIEW_PLIES = 10


def pawn_fate(initial, moves, origin, plies=PREVIEW_PLIES):
    board = initial.copy(stack=False)
    owner = board.color_at(origin)
    square = origin
    for move in moves[:plies]:
        advances = board.turn == owner and move.from_square == square
        if advances and move.promotion:
            return ('promotes', 8)
        if advances:
            square = move.to_square
        board.push(move)
        rank = (chess.square_rank(square) + 1) if owner else (8 - chess.square_rank(square))
        if board.piece_at(square) != chess.Piece(chess.PAWN, owner):
            return ('taken', rank)
    if len(moves) < plies:
        return ('unknown', 0)
    return ('present', rank)


def preview(engine, board, played, pawns, nodes):
    best = engine.analyse(board, chess.engine.Limit(nodes=nodes), game=object()).get('pv')
    if not best:
        return None
    if best[0] == played:
        return 'same-outcome'
    actual = engine.analyse(
        board, chess.engine.Limit(nodes=nodes), root_moves=[played], game=object(),
    ).get('pv')
    if not actual:
        return None
    horizon = min(len(best), len(actual), PREVIEW_PLIES)
    if horizon < 4:
        return None
    fates = [(pawn_fate(board, best, pawn, horizon), pawn_fate(board, actual, pawn, horizon))
             for pawn in pawns]
    if any(left[0] != 'unknown' and right[0] != 'unknown'
           and (right[1] > left[1] or (left[0] == 'taken' and right[0] == 'present'))
           for left, right in fates):
        return 'different-outcome'
    if all(left == right and left[0] != 'unknown' for left, right in fates):
        return 'same-outcome'
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('engine', type=Path)
    parser.add_argument('exclude', nargs='+', type=Path)
    parser.add_argument('--event', action='append', nargs=2, required=True)
    parser.add_argument('--per-stratum', type=int, default=8)
    parser.add_argument('--nodes', type=int, default=30000)
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError('Keep the generated sample outside the checkout')
    if args.per_stratum < 1 or args.nodes < 1:
        raise ValueError('Use positive sample and search budgets')

    excluded_games, excluded_boards, exclusion_hashes = set(), set(), []
    for filename in args.exclude:
        source = filename.read_bytes()
        exclusion_hashes.append(tournament.digest(source))
        for row in json.loads(source)['cases']:
            excluded_boards.add(tournament.board_key(row['fen']))
            if row.get('sourceGroup'):
                excluded_games.add(row['sourceGroup'])

    counts = {'different-outcome': 0, 'same-outcome': 0}
    cases, events = [], {}
    requests = 0
    with chess.engine.SimpleEngine.popen_uci(str(args.engine)) as engine:
        engine.configure({'Threads': 1, 'Hash': 16})
        for event, filename in args.event:
            path = Path(filename)
            events[event] = tournament.digest(path.read_bytes())
            games = tournament.read_games(path, excluded_boards, broadcast_loss=True)
            for game in sorted(games, key=tournament.order):
                if game in excluded_games:
                    continue
                rated = [row for row in games[game] if row.get('broadcastLossCp', 0) >= 60]
                for row in sorted(rated, key=lambda item: tournament.order(f'{game}:{item["ply"]}')):
                    board = chess.Board(row['fen'])
                    owner = not board.turn
                    pawns = [pawn for pawn in board.pieces(chess.PAWN, owner)
                             if passers.advanced_passed_pawn(board, pawn, owner)]
                    if not pawns or tournament.board_key(row['fen']) in excluded_boards:
                        continue
                    stratum = preview(engine, board, board.parse_uci(row['playedMoveUci']),
                                      pawns, args.nodes)
                    requests += 1
                    if not stratum or counts[stratum] >= args.per_stratum:
                        continue
                    case = {key: value for key, value in row.items() if key != 'pinChallenge'}
                    case.update(id=f'pawn-contrast-{event}-{game[:16]}-{row["ply"]}',
                                event=event, stratum=stratum, sourceGroup=game,
                                category='public-classical-broadcast', split='validation')
                    cases.append(case)
                    counts[stratum] += 1
                    excluded_games.add(game)
                    excluded_boards.add(tournament.board_key(row['fen']))
                    break
                if all(count == args.per_stratum for count in counts.values()):
                    break
    if any(count != args.per_stratum for count in counts.values()):
        raise ValueError(f'Sample quota not met after {requests} previews: {counts}')
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(dict(protocol=1, cases=cases, events=events, exclusions=exclusion_hashes,
                       previewEngineSha256=tournament.digest(args.engine.read_bytes()),
                       nodesPerPreviewLine=args.nodes, previewedPositions=requests,
                       scope='Advanced enemy passer and recorded evaluation loss of at least '
                       '60 centipawns. A shallow Stockfish preview stratifies by observed '
                       'progress or survival of the pawn. Full search and '
                       'classification outputs are excluded during sampling.'),
                  stream, indent=2)
    print(f'Selected {counts} from {requests} preview searches')


if __name__ == '__main__':
    main()
