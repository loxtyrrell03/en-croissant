"""Small non-network checks of the public benchmark source identities."""
import importlib.util
from pathlib import Path
import unittest
import chess
import chess.engine

path = Path(__file__).resolve().parents[1] / 'benchmarks/decision-evidence-public.py'
spec = importlib.util.spec_from_file_location('public_sample', path)
sample = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sample)
score_spec = importlib.util.spec_from_file_location('scores', path.with_name('decision-evidence-score.py'))
scores = importlib.util.module_from_spec(score_spec)
score_spec.loader.exec_module(scores)
engine_spec = importlib.util.spec_from_file_location('engine_frames', path.with_name('decision-evidence-engine.py'))
engine_frames = importlib.util.module_from_spec(engine_spec)
engine_spec.loader.exec_module(engine_frames)
probe_spec = importlib.util.spec_from_file_location('capture_probes', path.with_name('decision-evidence-probes.py'))
probes = importlib.util.module_from_spec(probe_spec)
probe_spec.loader.exec_module(probes)
evaluation_spec = importlib.util.spec_from_file_location('decision_evaluation', path.with_name('decision-evidence-evaluate.py'))
evaluation = importlib.util.module_from_spec(evaluation_spec)
evaluation_spec.loader.exec_module(evaluation)


class SourceGameIdentity(unittest.TestCase):
    def test_old_and_new_export_urls_group_the_same_game(self):
        for url in ['https://lichess.org/787zsVup/black#48',
                    'https://lichess.org/game/787zsVup/black#48',
                    'https://lichess.org/game/787zsVup#48']:
            self.assertEqual(sample.source_game_id(url), '787zsVup')

    def test_distinct_games_never_collapse_to_the_game_route(self):
        first = sample.source_game_id('https://lichess.org/game/787zsVup/black#48')
        second = sample.source_game_id('https://lichess.org/game/F8M8OS71#53')
        self.assertNotEqual(first, second)

    def test_unknown_routes_or_origins_fail_explicitly(self):
        for url in ['https://example.org/game/787zsVup', 'https://lichess.org/analysis/787zsVup',
                    'https://lichess.org/game', 'https://lichess.org/game/../787zsVup']:
            with self.assertRaises(ValueError):
                sample.source_game_id(url)


class ReferenceMetrics(unittest.TestCase):
    def test_unknown_is_not_a_negative_and_abstention_misses_positive(self):
        result = scores.detection([True, True, False, None], [True, False, True, True])
        self.assertEqual((result['tp'], result['fp'], result['fn'], result['tn'], result['unknownReference']), (1, 1, 1, 0, 1))
        self.assertEqual(result['precision']['value'], 0.5)
        self.assertEqual(result['recall']['value'], 0.5)
        self.assertEqual(result['agreement']['denominator'], 3)

    def test_no_reviewed_evidence_has_no_accuracy_value(self):
        result = scores.detection([None], [True])
        self.assertIsNone(result['precision']['value'])
        self.assertIsNone(result['recall']['interval95'])

    def test_duplicate_predictions_are_rejected(self):
        with self.assertRaises(ValueError):
            scores.score({'cases': []}, {'results': [{'id': 'same'}, {'id': 'same'}]})


class CaptureNominations(unittest.TestCase):
    def test_only_legal_captures_of_the_moved_piece_are_nominated(self):
        board = chess.Board('8/2r1k2p/3b4/8/8/2N5/1P5P/6K1 w - - 0 1')
        self.assertEqual([item[1] for item in probes.capture_nominations(board, 'b2b4')], ['d6b4'])

    def test_en_passant_identifies_the_removed_pawn(self):
        board = chess.Board('8/2r1k2p/8/8/3p4/2N5/4P2P/6K1 w - - 0 1')
        self.assertEqual([item[1] for item in probes.capture_nominations(board, 'e2e4')], ['d4e3'])

    def test_ordinary_expensive_capture_of_a_defended_piece_is_excluded(self):
        board = chess.Board('1q3rk1/2N2ppp/8/7Q/8/3B4/8/R5K1 w - - 0 1')
        self.assertEqual(probes.capture_nominations(board, 'a1a8'), [])


class SeparateQuestionMetrics(unittest.TestCase):
    def test_mixed_move_does_not_make_the_actual_mistake_mixed(self):
        supported = {'support':'supported'}
        report = {'results':[dict(id='case', baseline={'variations':[]}, baselineMistake={'nature':'tactical'},
            assessment={'moves':[dict(moveUci='a2a4', tactical=supported, positional=supported,
                mechanisms=[dict(mechanism='fork', rootMoveInvolved=True, mechanismPly=1)],
                conditionalResources=[dict(refutationMechanisms=[dict(mechanism='pin')])])],
                'mistake':{'tactical':supported, 'positional':{'support':'unestablished'}}})]}
        reference = {'cases':[dict(id='case',scope='move-justification',moveUci='a2a4',tactical=True,positional=True,motifs={'fork':True,'pin':False,'overloading':None}),
                              dict(id='case',scope='mistake-mechanism',tactical=True,positional=False)]}
        scores = evaluation.evaluate(reference,report)['questions']
        self.assertEqual(scores['move-justification']['candidate']['mixed']['tp'],1)
        self.assertEqual(scores['mistake-mechanism']['candidate']['mixed']['tn'],1)
        self.assertEqual(scores['move-justification']['candidate']['motifs']['pin']['tn'],1)
        self.assertEqual(scores['move-justification']['candidate']['motifs']['overloading']['unknownReference'],1)

    def test_bad_labels_and_missing_predictions_fail_instead_of_changing_denominators(self):
        with self.assertRaises(ValueError):
            evaluation.evaluate({'cases':[dict(id='missing',scope='move-justification',moveUci='a2a4',tactical=True,positional=None)]}, {'results':[]})
        with self.assertRaises(ValueError):
            evaluation.evaluate({'cases':[dict(id='case',scope='move-justification',moveUci='a2a4',tactical='likely',positional=None)]}, {'results':[{'id':'case'}]})


class EngineFrames(unittest.TestCase):
    def setUp(self):
        self.board = chess.Board()
        self.frames = engine_frames.CompleteVariations(self.board, 3)
        for rank, uci in enumerate(['e2e4', 'd2d4', 'g1f3'], 1):
            self.frames.add(self.info(rank, uci, 12, 100-rank*10))

    def info(self, rank, uci, depth, cp):
        return dict(multipv=rank, depth=depth, pv=[chess.Move.from_uci(uci)],
                    score=chess.engine.PovScore(chess.engine.Cp(cp), chess.WHITE))

    def test_partial_reordered_same_depth_frame_does_not_replace_complete_snapshot(self):
        self.frames.add(self.info(1, 'd2d4', 12, 100))
        self.frames.add(self.info(2, 'g1f3', 12, 80))
        self.assertEqual([str(item['pv'][0]) for item in self.frames.best], ['e2e4', 'd2d4', 'g1f3'])

    def test_duplicate_bound_illegal_and_unordered_frames_do_not_replace_best(self):
        for roots, values, bound in [(['e2e4','d2d4','d2d4'], [100,80,80], False),
                                     (['e2e4','d2d4','g1f3'], [100,80,70], True),
                                     (['e2e5','d2d4','g1f3'], [100,80,70], False),
                                     (['e2e4','d2d4','g1f3'], [100,110,70], False)]:
            for rank, (move, value) in enumerate(zip(roots, values), 1):
                self.frames.add({**self.info(rank,move,13,value), 'lowerbound': bound and rank == 1})
            self.assertEqual(self.frames.best[0]['depth'], 12)

    def test_complete_distinct_frame_replaces_snapshot_without_retaining_mutable_pv(self):
        for rank, move in enumerate(['d2d4','g1f3','e2e4'], 1):
            info = self.info(rank,move,13,100-rank*10)
            self.frames.add(info)
            info['pv'].clear()
        self.assertEqual([str(item['pv'][0]) for item in self.frames.best], ['d2d4','g1f3','e2e4'])

    def test_single_pv_without_explicit_rank_is_valid(self):
        single = engine_frames.CompleteVariations(self.board, 1)
        info = self.info(1,'e2e4',12,0)
        del info['multipv']
        single.add(info)
        self.assertIsNotNone(single.best)


if __name__ == '__main__':
    unittest.main()
