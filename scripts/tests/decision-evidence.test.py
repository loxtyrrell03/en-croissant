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
