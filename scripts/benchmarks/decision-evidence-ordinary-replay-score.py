"""Score matched ordinary-position replays from the actual decision worker."""

import argparse
import importlib.util
import json
from pathlib import Path
from statistics import median

SPEC = importlib.util.spec_from_file_location(
    'scoring', Path(__file__).with_name('decision-evidence-score.py'),
)
scoring = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scoring)
DIMENSIONS = ('tactical', 'positional', 'mixed')


def read(path):
    reports = json.loads(path.read_bytes())['results']
    indexed = {case['row']['id']: case for case in reports}
    if len(indexed) != len(reports) or not indexed:
        raise ValueError('Reports need distinct, nonempty case identities')
    return indexed


def support(assessment, axis):
    return assessment is not None and assessment[axis]['support'] == 'supported'


def reference(case, axis):
    label = case['label']
    if axis != 'mixed':
        return label[axis]
    tactical, positional = label['tactical'], label['positional']
    if False in (tactical, positional):
        return False
    if tactical is True and positional is True:
        return True
    return None


def detect(case, axis):
    assessment = case['report']['position']
    if axis == 'mixed':
        return all(support(assessment, label) for label in DIMENSIONS[:2])
    return support(assessment, axis)


def breakdown(cases):
    results = {}
    for axis in DIMENSIONS[:2]:
        missed = [case for case in cases if reference(case, axis) is True and not detect(case, axis)]
        results[axis] = {
            'missed': len(missed),
            'foundInAViableMove': sum(
                any(
                    support(move, axis)
                    for index, move in enumerate(case['report']['moves'])
                    if index == 0 or (
                        case['cp'][0] is not None
                        and move['evaluationCp'] is not None
                        and case['cp'][0] - move['evaluationCp'] <= 50
                    )
                )
                for case in missed
            ),
            'foundInMistake': sum(support(case['report']['mistake'], axis) for case in missed),
        }
    results['tactical']['withEarlyWitness'] = sum(
        any(
            witness['rootMoveInvolved'] or witness['payoffPly'] <= 7
            for line in case['signals'] for witness in line['witnesses']
        ) for case in cases
        if reference(case, 'tactical') is True and not detect(case, 'tactical')
    )
    results['positional']['withPersistentBoardFact'] = sum(
        any(
            fact['firstPly'] <= 5
            and fact['lastConsecutivePly'] >= fact['firstPly'] + 3
            for line in case['signals'] for fact in line['changes']
        ) for case in cases
        if reference(case, 'positional') is True and not detect(case, 'positional')
    )
    return results


def evaluate(before, after):
    if before.keys() != after.keys():
        raise ValueError('The report pairs must cover the same decisions')
    pairs = [(old, after[case]) for case, old in before.items()]
    for old, new in pairs:
        if old['row'] != new['row'] or old['label'] != new['label']:
            raise ValueError('Replay reference or position changed')
    result = {
        'cases': len(pairs),
        'events': len({old['row']['event'] for old in before.values()}),
        'legacyTacticalProxy': scoring.detection(
            [reference(case, 'tactical') for case in before.values()],
            [bool(case['legacy']) for case in before.values()],
        ),
        'before': {
            axis: scoring.detection(
                [reference(case, axis) for case in before.values()],
                [detect(case, axis) for case in before.values()],
            ) for axis in DIMENSIONS
        },
        'after': {
            axis: scoring.detection(
                [reference(case, axis) for case in after.values()],
                [detect(case, axis) for case in after.values()],
            ) for axis in DIMENSIONS
        },
        'missesBefore': breakdown(before.values()),
        'changedMoves': sum(old['report']['moves'] != new['report']['moves'] for old, new in pairs),
        'changedMistakes': sum(old['report']['mistake'] != new['report']['mistake'] for old, new in pairs),
        'changes': [
            {
                'id': old['row']['id'],
                'reference': {axis: reference(old, axis) for axis in DIMENSIONS},
                'before': old['report']['position']['category'],
                'after': new['report']['position']['category'],
            }
            for old, new in pairs if old['report']['position'] != new['report']['position']
        ],
        'workerCpuMedianMilliseconds': {
            'before': median(case['workerMs'] for case in before.values()),
            'after': median(case['workerMs'] for case in after.values()),
        },
    }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline', type=Path)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    metrics = evaluate(read(args.baseline), read(args.candidate))
    with args.output.open('x', encoding='utf-8') as out:
        json.dump(metrics, out, indent=2)
        out.write('\n')
    print(json.dumps({
        method: {axis: {key: cell[key] for key in ('tp', 'fp', 'fn', 'tn', 'unknownReference')}
                 for axis, cell in metrics[method].items()}
        for method in ('before', 'after')
    }))


if __name__ == '__main__':
    main()
