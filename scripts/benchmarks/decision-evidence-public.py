"""Stream a compact, game-disjoint public puzzle sample without saving a corpus.

Source themes are silver labels, never ground-truth motif annotations. Existing
fixture games are excluded. The output is selected before classifier evaluation.
"""
import argparse
import csv
import hashlib
import io
import json
import re
from pathlib import Path
import urllib.request
from urllib.parse import urlparse

import chess
import zstandard

THEMES = ['fork', 'pin', 'skewer', 'discoveredAttack', 'deflection', 'attraction',
          'capturingDefender', 'intermezzo', 'interference', 'clearance', 'trappedPiece',
          'quietMove', 'defensiveMove', 'mateIn3', 'sacrifice', 'equality']
URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst'


def source_game_id(url):
    parsed = urlparse(url)
    parts = parsed.path.strip('/').split('/')
    parts = parts[1:] if parts[0] == 'game' else parts
    candidate = parts[0] if parts else ''
    if (parsed.hostname not in ['lichess.org', 'www.lichess.org'] or
            not re.fullmatch(r'[A-Za-z0-9]{8}', candidate) or len(parts) > 2 or
            len(parts) == 2 and parts[1] not in ['white', 'black']):
        raise ValueError('Unrecognized source game URL')
    return candidate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('prior_fixture', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Never replace a frozen sample')
    prior = [json.loads(line) for line in args.prior_fixture.read_text().splitlines() if line]
    excluded_games = {row['sourceGroup'].removeprefix('game:') for row in prior}
    seen_positions = {' '.join(row['startFen'].split()[:4]) for row in prior}
    buckets = {(theme, split): [] for theme in THEMES for split in ['development', 'validation']}
    selected_games = set()
    cases = []
    # 3 cases per theme per partition; first qualifying hash-gated rows. The
    # URL/headers and consumed row count describe the exact selection boundary.
    with urllib.request.urlopen(urllib.request.Request(URL, headers={'User-Agent': 'EnCroissant-local-research'}), timeout=60) as response:
        headers = dict(response.headers)
        with zstandard.ZstdDecompressor().stream_reader(response) as reader:
            text = io.TextIOWrapper(reader, encoding='utf-8')
            for scanned, row in enumerate(csv.DictReader(text), 1):
                if scanned > 1500000:
                    raise ValueError('Could not fill the predefined strata within the streaming limit')
                game = source_game_id(row['GameUrl'])
                digest = hashlib.sha256(('decision-rebuild-v1:' + game).encode()).hexdigest()
                if game in excluded_games or game in selected_games or int(digest[:2], 16) >= 8:
                    continue
                split = 'development' if int(digest[2:4], 16) < 128 else 'validation'
                themes = set(row['Themes'].split())
                available = [theme for theme in THEMES if theme in themes and len(buckets[(theme, split)]) < 3]
                if not available or int(row['Popularity']) < 80 or int(row['NbPlays']) < 100:
                    continue
                chosen = min(available, key=lambda theme: (len(buckets[(theme, split)]), THEMES.index(theme)))
                board = chess.Board(row['FEN'])
                moves = row['Moves'].split()
                if not board.is_valid() or len(moves) < 2:
                    continue
                try:
                    board.push_uci(moves[0])
                    start = board.fen()
                    position_key = ' '.join(start.split()[:4])
                    if position_key in seen_positions:
                        continue
                    san = []
                    for uci in moves[1:]:
                        move = chess.Move.from_uci(uci)
                        if move not in board.legal_moves:
                            raise ValueError('Illegal solution')
                        san.append(board.san(move)); board.push(move)
                except ValueError:
                    continue
                case = dict(id='lichess-' + row['PuzzleId'], split=split, category='independent-puzzle',
                            sourceGroup='game:' + game, sourceUrl=row['GameUrl'], fen=start,
                            sourceUci=moves[1:], sourceSan=san, selectionTheme=chosen,
                            weakSourceThemes=sorted(themes), rating=int(row['Rating']))
                cases.append(case)
                buckets[(chosen, split)].append(case['id'])
                selected_games.add(game)
                seen_positions.add(position_key)
                if len(cases) % 16 == 0:
                    print(f'Selected {len(cases)}/96 from {scanned} streamed rows', flush=True)
                if all(len(values) == 3 for values in buckets.values()):
                    break
    if len(cases) != 96:
        raise ValueError(f'Incomplete sample: {len(cases)} selected from {scanned} rows')
    manifest = dict(protocol=1, source=URL, license='CC0-1.0', rowsScanned=scanned,
                    sourceHeaders={key: value for key, value in headers.items() if key.lower() in ['etag', 'last-modified', 'content-length']},
                    excludedGameCount=len(excluded_games), priorFixtureSha256=hashlib.sha256(args.prior_fixture.read_bytes()).hexdigest(),
                    selection='Game-hash gate 8/256, game-hash split, 3 per theme/split, popularity >=80 and plays >=100; one puzzle per source game',
                    limitation='Stratified convenience sample; source themes require review and are not prevalence estimates', cases=cases)
    with args.output.open('x', encoding='utf-8') as output:
        json.dump(manifest, output, indent=2)
    print(json.dumps(dict(cases=len(cases), development=48, validation=48, rowsScanned=scanned)))


if __name__ == '__main__':
    main()
