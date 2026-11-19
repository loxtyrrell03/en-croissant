"""Stream pre-mistake positions for a targeted test of piece traps."""
import argparse
import csv
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import urllib.request

import chess
import zstandard

spec = importlib.util.spec_from_file_location(
    'public_sample', Path(__file__).with_name('decision-evidence-public.py'),
)
public_sample = importlib.util.module_from_spec(spec)
spec.loader.exec_module(public_sample)


def position_key(fen):
    return ' '.join(fen.split()[:4])


def sample_shape(row):
    moves = row['Moves'].split()
    if len(moves) < 4:
        return None
    start = chess.Board(row['FEN'])
    board = start.copy()
    mistake, reply, defence, answer = map(chess.Move.from_uci, moves[:4])
    victim = board.piece_at(mistake.from_square)
    if not start.is_valid() or not victim or victim.piece_type in (chess.PAWN, chess.KING):
        return None
    if mistake not in board.legal_moves or board.is_castling(mistake):
        return None
    board.push(mistake)
    reached = board.fen()
    if reply not in board.legal_moves or board.is_capture(reply) or board.gives_check(reply):
        return None
    board.push(reply)
    if mistake.to_square not in board.attacks(reply.to_square) or defence not in board.legal_moves:
        return None
    target = defence.to_square if defence.from_square == mistake.to_square else mistake.to_square
    board.push(defence)
    if answer not in board.legal_moves or answer.to_square != target or board.piece_at(target) != victim:
        return None
    return start.fen(), reached, moves[:4]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('exclusions', nargs='+', type=Path)
    args = parser.parse_args()
    if args.output.exists() or args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError('Use a new sample file outside the source checkout')
    games, boards, cases, exclusions = set(), set(), [], []
    for path in args.exclusions:
        data = path.read_bytes()
        exclusions.append(dict(name=path.name, sha256=hashlib.sha256(data).hexdigest()))
        manifest = json.loads(data)
        for row in manifest if isinstance(manifest, list) else manifest['cases']:
            url = row.get('sourceUrl') or row.get('sourceGameUrl')
            if url:
                games.add(public_sample.source_game_id(url))
            for key in ('fen', 'sourceFen', 'startFen'):
                if row.get(key):
                    boards.add(position_key(row[key]))
    counts = {'trap-tag': 0, 'similar-capture': 0}
    limit = 10
    request = urllib.request.Request(public_sample.URL, headers={'User-Agent': 'EnCroissant-local-research'})
    with urllib.request.urlopen(request, timeout=60) as response:
        headers = {key: value for key, value in response.headers.items()
                   if key.lower() in ('etag', 'last-modified', 'content-length')}
        with zstandard.ZstdDecompressor().stream_reader(response) as reader:
            for scanned, row in enumerate(csv.DictReader(io.TextIOWrapper(reader, encoding='utf-8')), 1):
                if scanned > 1_000_000:
                    raise ValueError('Could not fill the strata within the streaming limit')
                themes = row['Themes'].split()
                stratum = 'trap-tag' if 'trappedPiece' in themes else 'similar-capture'
                if counts[stratum] == limit or int(row['Popularity']) < 80 or int(row['NbPlays']) < 100:
                    continue
                game = public_sample.source_game_id(row['GameUrl'])
                if game in games or hashlib.sha256(('trap-mistake-v1:' + game).encode()).digest()[0] >= 64:
                    continue
                selection = sample_shape(row)
                if not selection:
                    continue
                fen, after, moves = selection
                keys = {position_key(fen), position_key(after)}
                if boards.intersection(keys):
                    continue
                cases.append(dict(id='trap-' + row['PuzzleId'], split='validation',
                                  sourceGroup='game:' + game, sourceUrl=row['GameUrl'],
                                  event='Lichess puzzles', stratum=stratum,
                                  category='independent-puzzle', fen=fen, playedMoveUci=moves[0],
                                  sourceUci=moves[1:], weakSourceThemes=themes))
                games.add(game)
                boards.update(keys)
                counts[stratum] += 1
                if all(count == limit for count in counts.values()):
                    break
    if len(cases) != 2 * limit:
        raise ValueError('Incomplete trap sample')
    manifest = dict(protocol=1, source=public_sample.URL, license='CC0-1.0', sourceHeaders=headers,
                    rowsScanned=scanned, excludedSampleHashes=exclusions, stratumCounts=counts,
                    selection='First 10 game-hash-gated legal candidates per stratum. A quiet reply attacks the just-moved piece and the source line captures it.',
                    limitation='Targeted diagnostic; puzzle tags are retrieval cues and the sample cannot estimate game-wide prevalence.',
                    cases=cases)
    with args.output.open('x', encoding='utf-8') as output:
        json.dump(manifest, output, indent=2)
    print(f'{len(cases)} distinct cases selected from {scanned} streamed rows', flush=True)


if __name__ == '__main__':
    main()
