"""Regression cases for tournament benchmark sampling and group isolation."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

import chess
import chess.engine
import chess.pgn

path = Path(__file__).resolve().parents[1] / 'benchmarks' / 'decision-evidence-tournament.py'
spec = importlib.util.spec_from_file_location('tournament_sample', path)
sample = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sample)
passer_spec = importlib.util.spec_from_file_location(
    'passer_sample', path.with_name('decision-evidence-passer-sample.py'),
)
passer_sample = importlib.util.module_from_spec(passer_spec)
passer_spec.loader.exec_module(passer_sample)


class TournamentSampleTests(unittest.TestCase):
    def test_promotion_sample_checks_the_opponent_moves(self):
        board = chess.Board('4k3/P7/8/8/8/8/7p/4K3 b - - 0 18')
        reply_promotes = [chess.Move.from_uci(move) for move in ('e8d7','a7a8q')]
        mover_promotes = [chess.Move.from_uci(move) for move in (
            'h2h1q', 'e1d2', 'e8d7', 'd2c3', 'h1h5', 'c3b4',
        )]
        self.assertEqual(passer_sample.played_promotion_trajectory(board, reply_promotes),
                         'opponent-promoted')
        self.assertEqual(passer_sample.played_promotion_trajectory(board, mover_promotes),
                         'no-opponent-promotion')

    def test_annotated_pawn_sample_measures_loss_from_the_mover(self):
        board = chess.Board('4k3/P7/8/8/8/8/8/4K3 b - - 0 18')
        game = chess.pgn.Game()
        game.setup(board)
        node = game.add_main_variation(board.parse_uci('e8d7'))
        game.set_eval(chess.engine.PovScore(chess.engine.Cp(15), chess.WHITE))
        node.set_eval(chess.engine.PovScore(chess.engine.Cp(128), chess.WHITE))
        self.assertEqual(passer_sample.annotated_promotion_decision(board, node), 'recorded-loss')
        node.set_eval(chess.engine.PovScore(chess.engine.Cp(19), chess.WHITE))
        self.assertEqual(passer_sample.annotated_promotion_decision(board, node), 'recorded-control')
        node.set_eval(chess.engine.PovScore(chess.engine.Mate(2), chess.WHITE))
        self.assertIsNone(passer_sample.annotated_promotion_decision(board, node))

    def test_whole_game_is_excluded_if_any_root_matches_earlier_sample(self):
        board = chess.Board('4k3/1p3p2/8/8/8/5N2/PPP5/4K3 w - - 0 14')
        game = chess.pgn.Game()
        game.setup(board)
        game.headers['Result'] = '1/2-1/2'
        node = game
        boards = []
        # Construct all moves through the legal board, including repeated
        # positions. One overlap earlier in the game excludes all later plies.
        for _ in range(7):
            for san in ('Ng5', 'Kd7', 'Nf3', 'Ke8'):
                boards.append(board.fen())
                move = board.parse_san(san)
                node = node.add_main_variation(move)
                board.push(move)
        with tempfile.TemporaryDirectory() as temp:
            pgn = Path(temp) / 'one-game.pgn'
            pgn.write_text(str(game), encoding='utf-8')
            self.assertEqual(len(sample.read_games(pgn, set())), 1)
            self.assertEqual(sample.read_games(pgn, {sample.board_key(boards[2])}), {})

    def test_each_game_and_board_appears_in_at_most_one_stratum_or_event(self):
        board_a = '4k3/1p3p2/8/8/8/5N2/PPP5/4K3 w - - 0 14'
        board_b = '4k3/1p3p2/8/8/8/5N2/PPP5/4K3 b - - 0 14'
        board_c = '8/1p1k1p2/8/8/8/5N2/PPP5/4K3 b - - 0 14'
        rows = lambda fen: [{'fen': fen, 'ply': 26, 'pinChallenge': True}]
        seen_boards, seen_games = set(), set()
        first = {'a': rows(board_a), 'b': rows(board_b)}
        result = sample.select_event('first', first, 1, 1, seen_boards, seen_games)
        self.assertEqual(len(result), 2)
        self.assertEqual({row['stratum'] for row in result}, {'ordinary', 'quiet-with-pin'})
        second = {'a': rows(board_c), 'c': rows(board_a), 'd': rows(board_c)}
        result = sample.select_event('second', second, 1, 1, seen_boards, seen_games)
        self.assertEqual([row['sourceGroup'] for row in result], ['d'])
        self.assertEqual(seen_games, {'a', 'b', 'd'})

    def test_mistake_strata_require_distinct_eligible_boards_in_one_game(self):
        first = '4k3/1p3p2/8/8/8/5N2/PPP5/4K3 w - - 0 14'
        second = '4k3/1p3p2/8/8/8/5N2/PPP5/4K3 b - - 0 14'
        game = [
            dict(fen=first, ply=30, broadcastLossCp=120),
            dict(fen=first, ply=34, broadcastLossCp=0),
            dict(fen=second, ply=35, broadcastLossCp=20),
        ]
        seen_boards, seen_games = set(), set()
        rows = sample.select_mistakes(
            'event-a', 'development', {'one': game}, 2, seen_boards, seen_games)
        self.assertEqual([r['ply'] for r in rows], [30, 35])
        self.assertEqual([r['split'] for r in rows], ['development', 'development'])
        self.assertEqual(sample.select_mistakes(
            'event-b', 'validation', {'one': game}, 2, seen_boards, seen_games), [])


if __name__ == '__main__':
    unittest.main()
