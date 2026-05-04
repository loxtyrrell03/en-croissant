DROP INDEX IF EXISTS games_date_idx;
DROP INDEX IF EXISTS games_white_idx;
DROP INDEX IF EXISTS games_black_idx;
DROP INDEX IF EXISTS games_result_idx;
DROP INDEX IF EXISTS games_white_elo_idx;
DROP INDEX IF EXISTS games_black_elo_idx;
DROP INDEX IF EXISTS games_plycount_idx;
DROP INDEX IF EXISTS mistake_review_move_evals_game_idx;
DROP INDEX IF EXISTS mistake_review_move_evals_player_idx;
DROP INDEX IF EXISTS mistake_review_move_evals_fen_idx;
DROP INDEX IF EXISTS mistake_review_move_evals_updated_idx;

VACUUM;
