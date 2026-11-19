"""Score separate decision questions and explicitly reviewed root motifs.

Missing motif labels are unknown, never negative. Conditional-refutation motifs
are deliberately not transferred to the root move. This reports agreement with
the supplied reference, not independent expert validation by implication.
"""
import argparse
import hashlib
import importlib.util
import json
import statistics
from pathlib import Path

spec = importlib.util.spec_from_file_location('decision_scores', Path(__file__).with_name('decision-evidence-score.py'))
metrics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metrics)
SCOPES = ('move-justification', 'mistake-mechanism', 'position-character')


def predictions(row, case):
    scope = case['scope']
    report = row.get('assessment') or {}
    if scope == 'mistake-mechanism':
        candidate = report.get('mistake') or {}
        old_nature = row['baselineMistake']['nature']
        old = dict(tactical=old_nature == 'tactical', positional=old_nature == 'positional', motifs=set())
    else:
        candidate = report.get('position') or {} if scope == 'position-character' else next((m for m in report.get('moves', []) if m['moveUci'] == case['moveUci']), {})
        old_line = next((v for v in row['baseline']['variations'] if v['lineUci'][0] == case['moveUci']), None)
        old_motifs = {m['id'] for m in (old_line or {}).get('motifs', []) if m['ply'] == 1 and m['moveUci'] == case['moveUci']}
        old = dict(tactical=bool(old_motifs), positional=False, motifs=old_motifs)
    current = dict(tactical=candidate.get('tactical', {}).get('support') == 'supported',
                   positional=candidate.get('positional', {}).get('support') == 'supported', motifs=set())
    if current['tactical']:
        current['motifs'].update(m['id'] for m in candidate.get('verifiedMotifs', []) if m['ply'] == 1)
        current['motifs'].update(m['mechanism'] for m in candidate.get('mechanisms', []) if m['rootMoveInvolved'] and m['mechanismPly'] == 1)
        current['motifs'].update(m['mechanism'] for m in candidate.get('localProofs', []))
    for result in [old, current]:
        result['mixed'] = result['tactical'] and result['positional']
    return old, current


def evaluate(reference, outputs):
    rows = {row['id']: row for row in outputs['results']}
    cases = reference['cases']
    keys = [(case['id'], case.get('scope'), case.get('moveUci')) for case in cases]
    if len(rows) != len(outputs['results']) or len(keys) != len(set(keys)):
        raise ValueError('Duplicate result or reference question')
    for case in cases:
        if case.get('scope') not in SCOPES or case['id'] not in rows:
            raise ValueError('Unknown question or missing result, including abstentions')
        if case['scope'] != 'mistake-mechanism' and not case.get('moveUci'):
            raise ValueError('Root reference needs an explicit move identity')
        if any(case.get(d) is not None and type(case[d]) is not bool for d in ['tactical', 'positional']):
            raise ValueError('Dimensions must be true, false or null')
        if any(label is not None and type(label) is not bool for label in (case.get('motifs') or {}).values()):
            raise ValueError('Motif labels must be true, false or null')
    scopes = {}
    for scope in SCOPES:
        selected = [case for case in cases if case['scope'] == scope]
        if not selected:
            continue
        pairs = [predictions(rows[case['id']], case) for case in selected]
        dimensions = {d: [case.get(d) for case in selected] for d in ['tactical', 'positional']}
        dimensions['mixed'] = [True if case.get('tactical') is True and case.get('positional') is True else False if case.get('tactical') is False or case.get('positional') is False else None for case in selected]
        motif_names = sorted({name for case in selected for name in (case.get('motifs') or {})})
        results = {}
        for method, index in [('old', 0), ('candidate', 1)]:
            results[method] = {d: metrics.detection(labels, [pair[index][d] for pair in pairs]) for d, labels in dimensions.items()}
            results[method]['motifs'] = None if method == 'old' and scope == 'mistake-mechanism' else {name: metrics.detection([(case.get('motifs') or {}).get(name) for case in selected], [name in pair[index]['motifs'] for pair in pairs]) for name in motif_names}
        scopes[scope] = dict(cases=len(selected), **results)
    runtime = {}
    for key in ['baselineMs', 'milliseconds']:
        times = [r[key] for r in rows.values() if key in r]
        runtime[key] = dict(medianMs=statistics.median(times), totalMs=sum(times), cases=len(times)) if times else None
    return dict(scope='Agreement with saved reference questions; see review limitations', split=outputs.get('split', 'development'),
                freezeSha256=outputs.get('freezeSha256'), referenceLimitations=reference.get('limitations', []), questions=scopes,
                classifierRuntime=runtime, engineCostIncluded=False,
                limitations=['Case-level Wilson intervals do not correct for correlated source games.',
                             'Unlabelled motifs and uncertain dimensions are excluded, not treated as negatives.',
                             'Old live root motifs are a proxy for tactical position character; the old system has no equivalent independent positional/mixed position dimension.',
                             'Old mistake nature does not expose a comparable named-motif inventory here; its empty motif prediction is not a motif-accuracy claim.',
                             'Conditional capture-refutation motifs remain outside root motif scoring.'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference', type=Path)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    reference_bytes = args.reference.read_bytes()
    outputs = json.loads(args.candidate.read_bytes())
    if outputs.get('split') in ['validation', 'reviewed-validation'] and hashlib.sha256(reference_bytes).hexdigest() != outputs.get('referenceSha256'):
        raise ValueError('The held-out reference differs from the one saved before classification')
    report = evaluate(json.loads(reference_bytes), outputs)
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(report, stream, indent=2)
    print(json.dumps({scope: {method: {dimension: {k: v for k, v in result[method][dimension].items() if k in ['tp','fp','fn','tn','unknownReference']} for dimension in ['tactical','positional','mixed']} for method in ['old','candidate']} for scope,result in report['questions'].items()}))


if __name__ == '__main__':
    main()
