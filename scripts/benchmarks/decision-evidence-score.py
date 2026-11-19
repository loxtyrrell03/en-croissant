"""Score a candidate against reviewed independent dimension labels.

Unknown reference dimensions are excluded, never converted into negatives.
Abstentions on reviewed positives count as missed detections. These metrics
cannot upgrade provisional source review into independent human ground truth.
"""
import argparse
import json
import math
from pathlib import Path


def proportion(numerator, denominator):
    if not denominator:
        return dict(value=None, numerator=numerator, denominator=0, interval95=None)
    p = numerator / denominator
    z = 1.959963984540054
    centre = (p + z*z/(2*denominator)) / (1+z*z/denominator)
    radius = z * math.sqrt(p*(1-p)/denominator + z*z/(4*denominator*denominator)) / (1+z*z/denominator)
    return dict(value=p, numerator=numerator, denominator=denominator, interval95=[centre-radius, centre+radius])


def detection(labels, predictions):
    tp = fp = fn = tn = unknown = 0
    for label, predicted in zip(labels, predictions):
        if label is None:
            unknown += 1
        elif label and predicted:
            tp += 1
        elif not label and predicted:
            fp += 1
        elif label:
            fn += 1
        else:
            tn += 1
    return dict(tp=tp, fp=fp, fn=fn, tn=tn, unknownReference=unknown,
                precision=proportion(tp, tp+fp), recall=proportion(tp, tp+fn),
                specificity=proportion(tn, tn+fp), agreement=proportion(tp+tn, tp+fp+fn+tn))


def score(reference, outputs):
    predictions = {row['id']: row for row in outputs['results']}
    cases = reference['cases']
    if len(predictions) != len(outputs['results']) or len({row['id'] for row in cases}) != len(cases):
        raise ValueError('Duplicate reference or prediction identities')
    if any(row['id'] not in predictions for row in cases):
        raise ValueError('Every reference case needs a recorded result, including errors/abstentions')
    labels = {dimension: [row[dimension] for row in cases] for dimension in ['tactical', 'positional']}
    labels['mixed'] = [True if row['tactical'] is True and row['positional'] is True else
                       False if row['tactical'] is False or row['positional'] is False else None for row in cases]
    before = []; after = []
    for row in cases:
        output = predictions[row['id']]
        baseline = next((v for v in output['baseline']['variations'] if v['multipv'] == 1), None)
        # Baseline live labels keep later PV events distinct from the root move.
        old_tactical = bool(baseline and any(m['ply'] == 1 and m['moveUci'] == row['moveUci'] for m in baseline['motifs']))
        before.append(dict(tactical=old_tactical, positional=False, mixed=False))
        candidate = next((m for m in (output.get('assessment') or {}).get('moves', []) if m['moveUci'] == row['moveUci']), None)
        after.append(dict(tactical=bool(candidate and candidate['tactical']['support'] == 'supported'),
                          positional=bool(candidate and candidate['positional']['support'] == 'supported'),
                          mixed=bool(candidate and candidate['category'] == 'mixed')))
    return dict(scope='Move-justification development agreement only; not held-out accuracy',
                referenceLimitations=reference['limitations'],
                old={d:detection(labels[d], [row[d] for row in before]) for d in labels},
                candidate={d:detection(labels[d], [row[d] for row in after]) for d in labels},
                intervals='Wilson intervals at case level; correlated source cases are not independent',
                individualMotifs=dict(available=False, reason='Complete reviewed per-motif positives and negatives are not yet available'),
                missingAssessment=sum(predictions[row['id']].get('assessment') is None for row in cases))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference', type=Path)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    report = score(json.loads(args.reference.read_text()), json.loads(args.candidate.read_text()))
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(report, stream, indent=2)
    print(json.dumps({method: {dimension: {key: value for key, value in metrics.items() if key in ['tp','fp','fn','tn','unknownReference']}
                              for dimension, metrics in report[method].items()} for method in ['old','candidate']}))


if __name__ == '__main__':
    main()
