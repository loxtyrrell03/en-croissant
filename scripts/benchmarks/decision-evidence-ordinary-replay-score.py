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


def evaluate_mistakes(before, after):
    if before.keys() != after.keys():
        raise ValueError('The report pairs must cover the same decisions')
    pairs = [(old, after[case]) for case, old in before.items()]
    promotion_count = sum('promotion' in old['label'] for old, _ in pairs)
    if promotion_count not in (0, len(pairs)):
        raise ValueError('Promotion references must cover the entire sample or be omitted')
    for old, new in pairs:
        label = old['label']
        if (
            old['row'] != new['row'] or label != new['label']
            or label['scope'] != 'mistake-mechanism'
            or label.get('moveUci') != old['row']['playedMoveUci']
        ):
            raise ValueError('A mistake reference must identify the actual move in both reports')
    axes = (*DIMENSIONS, 'promotion') if promotion_count else DIMENSIONS

    def detect_mistake(case, axis):
        mistake = case['report']['mistake']
        if axis == 'promotion':
            return bool(mistake and mistake.get('promotion'))
        if axis == 'mixed':
            return all(support(mistake, dimension) for dimension in DIMENSIONS[:2])
        return support(mistake, axis)

    return {
        'cases': len(pairs),
        'events': len({row['row']['event'] for row in before.values()}),
        **{
            version: {
                axis: scoring.detection(
                    [reference(row, axis) for row in rows.values()],
                    [detect_mistake(row, axis) for row in rows.values()],
                )
                for axis in axes
            }
            for version, rows in [('before', before), ('after', after)]
        },
        'changedPositionReports': sum(old['report']['position'] != new['report']['position']
                                      for old, new in pairs),
        'changedMoveReports': sum(old['report']['moves'] != new['report']['moves']
                                  for old, new in pairs),
        'extraSearchDecisions': {
            version: sum(row['searchedExtra'] for row in rows.values())
            for version, rows in [('before', before), ('after', after)]
        },
        'workerMedianMs': {
            version: median(row['workerMs'] for row in rows.values())
            for version, rows in [('before', before), ('after', after)]
        },
        'changes': [
            dict(id=old['row']['id'], reference={axis: reference(old, axis) for axis in axes},
                 before=[axis for axis in axes if detect_mistake(old, axis)],
                 after=[axis for axis in axes if detect_mistake(new, axis)],
                 promotion=new['report']['mistake'].get('promotion') if new['report']['mistake'] else None)
            for old, new in pairs if old['report']['mistake'] != new['report']['mistake']
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline', type=Path)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--mistakes', action='store_true')
    args = parser.parse_args()
    compare = evaluate_mistakes if args.mistakes else evaluate
    metrics = compare(read(args.baseline), read(args.candidate))
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
