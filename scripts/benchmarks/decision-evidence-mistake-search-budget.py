"""Allocate the same extra reply-search budget to several played-move rankings."""
import argparse
from concurrent.futures import ProcessPoolExecutor
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sys

import chess
import chess.engine


SCRIPTS = Path(__file__).resolve().parent


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def read(path):
    return json.loads(path.read_bytes())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as out:
        json.dump(value, out, indent=2)
        out.write('\n')


def index(path):
    rows = read(path)['results']
    by_id = {case['row']['id']: case for case in rows}
    if len(by_id) != len(rows):
        raise ValueError('Duplicate replay case')
    return by_id


def nominate(args):
    pilot = load_module('decision-evidence-mistake-model')
    model = pilot.load_module(SCRIPTS / 'decision-evidence-line-model.py')
    historical = pilot.read_reports(model, args.train, set(args.uncertain_positional))
    testing = pilot.read_reports(model, [args.replay], set())
    baseline = index(args.replay)
    protocol = read(args.protocol)
    slots = protocol['slots']
    candidates = {}
    for decision in testing:
        frame = baseline[decision.id]['frame']
        loss = decision.scores[-1]
        if (decision.current['mixed'] or not frame.get('rootAgrees') or
                not frame.get('legalPair') or not frame.get('legalPlayed') or
                not frame.get('legalPlayedReply') or not frame['bestReply'] or
                not frame['playedReply'] or loss < .75):
            continue
        best, played = frame['best'], frame['played']
        if best['pvUci'][0] != played['pvUci'][0]:
            candidates[decision.id] = dict(game=decision.game, loss=float(loss),
                                           best=best['pvUci'][0], played=played['pvUci'][0])
    if len({case['game'] for case in candidates.values()}) < slots:
        raise ValueError('Too few eligible games for the fixed number of slots')
    specs = model.model_specs(max_iterations=3000)
    keys = {'continuation-logistic': 'line-logistic', 'continuation-network': 'line-network',
            'score-logistic': 'score-logistic'}
    if protocol['policies'] != [*keys, 'evaluation-loss', 'seeded-control']:
        raise ValueError('Unexpected policy list')
    with model.threadpool_limits(limits=1):
        output = model.fit(historical, testing, {name: specs[name] for name in keys.values()})
    ranks = {policy: {row.id: float(rank) for row, rank in zip(
        testing, output[spec]['mixed'], strict=True)} for policy, spec in keys.items()}
    ranks['evaluation-loss'] = {key: case['loss'] for key, case in candidates.items()}
    ranks['seeded-control'] = dict.fromkeys(candidates, 0.)
    policies = {}
    for policy, ranking in ranks.items():
        ordered = sorted(candidates, key=lambda key: (
            -ranking[key], hashlib.sha256(('v49-tie:' + key).encode()).digest()))
        picks, games = [], set()
        for key in ordered:
            game = candidates[key]['game']
            if game in games:
                continue
            games.add(game)
            picks.append(dict(id=key, rank=ranking[key]))
            if len(picks) == slots:
                break
        policies[policy] = picks
    write(args.output, dict(protocol=protocol, protocolSha256=sha(args.protocol),
                            baselineReplaySha256=sha(args.replay), trainingReplays=[sha(p) for p in args.train],
                            trainingCases=len(historical), transferCases=len(testing),
                            uncertainPositional=args.uncertain_positional,
                            engineInputs=candidates, policies=policies))


def extend_case(task):
    key, choice, source, output, profile, engine, engine_hash, protocol = task
    if not re.fullmatch(r'[0-9a-zA-Z_-]+', key):
        raise ValueError('Invalid case ID')
    name = key + '.json'
    root_file = source / f'tournament-engine-{profile}' / name
    probe_file = source / f'tournament-probes-{profile}' / name
    shared_file = source / f'tournament-shared-{profile}' / name
    root, original = read(root_file), read(probe_file)
    if original['identity']['root_sha256'] != sha(root_file):
        raise ValueError('Reply lines do not match the root search')
    if (root['id'] != key or root['identity']['engine_sha256'] != engine_hash or
            original['identity']['engine_sha256'] != engine_hash):
        raise ValueError('Root, replies or engine identity changed')
    paired = root['comparison']
    moves = [choice['best'], choice['played']]
    if (root['played'] != moves[1] or paired[0]['pvUci'][0] != moves[0] or
            root['deep'][0]['pvUci'][0] != moves[0] or
            not all(any(line['pvUci'][0] == move for line in paired) for move in moves)):
        raise ValueError('Selected roots do not match the cached comparison')
    probes = load_module('decision-evidence-probes')
    original_by_move = {probe['moveUci']: probe for probe in original['replyProbes']}
    enhanced_by_move = original_by_move.copy()
    attempts = []
    board = chess.Board(root['identity']['fen'])
    with chess.engine.SimpleEngine.popen_uci(engine) as stockfish:
        stockfish.configure({'Threads': protocol['threads'], 'Hash': protocol['hashMiB']})
        for move in moves:
            after = board.copy()
            after.push_uci(move)
            original_probe = original_by_move[move]
            if (after.is_game_over() or not original_probe['lines'] or
                    any(line['fen'] != after.fen() for line in original_probe['lines'])):
                raise ValueError('A root lacks eligible reply lines: ' + key)
            lines, attempt = probes.search_replies(
                stockfish, after, min(protocol['maxReplyMultiPv'], after.legal_moves.count()),
                protocol['nodesPerReply'])
            accepted = lines[0]['depth'] >= original_probe['lines'][0]['depth']
            if accepted:
                enhanced_by_move[move] = dict(original_probe, lines=lines)
            attempts.append(dict(attempt, rootUci=move, accepted=accepted,
                                 previousDepth=original_probe['lines'][0]['depth']))
    enhanced = dict(original, replyProbes=list(enhanced_by_move.values()))
    saved_root = output / f'tournament-engine-{profile}' / name
    saved_probe = output / f'tournament-probes-{profile}' / name
    shutil.copyfile(root_file, saved_root)
    write(saved_probe, enhanced)
    if shared_file.is_file():
        previous = read(shared_file)
        shared = previous.get('sharedReply')
        original_played = original_by_move[moves[1]]['lines'][0]
        enhanced_played = enhanced_by_move[moves[1]]['lines'][0]
        if (previous['identity']['rootSha256'] != sha(root_file) or
                previous['identity']['probeSha256'] != sha(probe_file) or
                previous['identity']['engineSha256'] != engine_hash):
            raise ValueError('Shared search does not match the original frames')
        if shared and original_played['pvUci'][0] == enhanced_played['pvUci'][0]:
            previous['identity']['probeSha256'] = sha(saved_probe)
            write(output / f'tournament-shared-{profile}' / name, previous)
    return dict(id=key, attempts=attempts)


def search(args):
    plan = read(args.plan)
    baseline = index(args.replay)
    if sha(args.replay) != plan['baselineReplaySha256']:
        raise ValueError('Selection does not match the supplied replay')
    selected = sorted({item['id'] for arm in plan['policies'].values() for item in arm})
    if not selected or not set(selected) <= baseline.keys():
        raise ValueError('Selection contains invalid decisions')
    if any(len(arm) != plan['protocol']['slots'] for arm in plan['policies'].values()):
        raise ValueError('All arms must receive the same number of search slots')
    args.output.mkdir()
    for kind in ('engine', 'probes', 'shared'):
        (args.output / f'tournament-{kind}-{args.profile}').mkdir()
    executable = str(args.engine.resolve())
    engine_hash = sha(args.engine)
    tasks = [(key, plan['engineInputs'][key], args.source, args.output, args.profile,
              executable, engine_hash, plan['protocol']) for key in selected]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        work = list(pool.map(extend_case, tasks))
    write(args.output / 'receipt.json', dict(planSha256=sha(args.plan), engineSha256=engine_hash,
                                            cases=work))
    write(args.output / 'tournament-sample.json', dict(cases=[baseline[key]['row'] for key in selected]))
    write(args.output / 'reference.json', dict(cases=[baseline[key]['label'] for key in selected]))
    write(args.output / 'manifest.json', [dict(name='equal-budget-deeper-replies',
          path=str(args.output.resolve()), profile=args.profile, sample='tournament-sample.json',
          reference='reference.json')])


def score(args):
    scoring = load_module('decision-evidence-ordinary-replay-score')
    plan, receipts = read(args.plan), read(args.receipt)
    baseline, enhanced = index(args.replay), index(args.enhanced)
    by_id = {case['id']: case for case in receipts['cases']}
    if (sha(args.plan) != receipts['planSha256'] or sha(args.replay) != plan['baselineReplaySha256']
            or set(by_id) != set(enhanced)):
        raise ValueError('Replay, selection and searched reply caches do not align')
    protocols = plan['protocol']
    result = {'eligible':len(plan['engineInputs']), 'unionSearched':len(by_id),
              'transferCases': len(baseline), 'policyMetrics':{}}
    for method, arm in plan['policies'].items():
        ids = {item['id'] for item in arm}
        work = [item for key in ids for item in by_id[key]['attempts']]
        requested = sum(item['requestedNodes'] for item in work)
        if requested != protocols['slots'] * 2 * protocols['nodesPerReply']:
            raise ValueError('Unequal requested search budgets')
        before = {key: dict(baseline[key], searchedExtra=False) for key in baseline}
        after = {key: dict(enhanced[key], row=baseline[key]['row'], searchedExtra=True)
                 if key in ids else before[key] for key in before}
        for key in ids:
            if enhanced[key]['row'] != baseline[key]['row']:
                raise ValueError('Enhanced case identity changed')
            prior = before[key]['report']['mistake'] or {}
            updated = after[key]['report']['mistake'] or {}
            if prior.get('evaluationLossCp') != updated.get('evaluationLossCp'):
                raise ValueError('Reply-only search changed the recorded evaluation loss')
            after[key]['report'] = dict(after[key]['report'], position=before[key]['report']['position'],
                                        moves=before[key]['report']['moves'])
        metrics = scoring.evaluate_mistakes(before, after)
        result['policyMetrics'][method] = dict(
            requestedNodes=requested, observedNodes=sum(item['nodes'] for item in work),
            acceptedReplies=sum(item['accepted'] for item in work),
            pairs=sorted(ids), metrics=metrics)
    write(args.output, result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    rank = commands.add_parser('nominate')
    rank.add_argument('protocol', type=Path)
    rank.add_argument('replay', type=Path)
    rank.add_argument('output', type=Path)
    rank.add_argument('--train', required=True, nargs='+', type=Path)
    rank.add_argument('--uncertain-positional', nargs='*', default=[])
    rank.set_defaults(run=nominate)
    search_args = commands.add_parser('search')
    for argument in ('plan', 'replay', 'source', 'engine', 'output'):
        search_args.add_argument(argument, type=Path)
    search_args.add_argument('--profile', default='v49', choices=['v49'])
    search_args.add_argument('--workers', type=int, default=4, choices=range(1, 5))
    search_args.set_defaults(run=search)
    evaluate = commands.add_parser('score')
    for argument in ('plan', 'receipt', 'replay', 'enhanced', 'output'):
        evaluate.add_argument(argument, type=Path)
    evaluate.set_defaults(run=score)
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(SCRIPTS.parents[1]):
        raise ValueError('Keep raw engine caches and replays outside the repository')
    args.run(args)


if __name__ == '__main__':
    main()
