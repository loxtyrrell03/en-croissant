# Promotion race: exact outcome is not a motif certificate

The retained public puzzle **i2SLh** has a uniquely winning first pawn push, but the opponent's later promotion does not save the game. This sharpens the benchmark's expected meaning; it does not repair the classifier's known local promotion-proof gap.

## Evidence and result

The source is the existing `secondary-theme-development.json` fixture, game [JRH8EioB](https://lichess.org/JRH8EioB/black#98). Eight six-piece positions were requested from the Lichess Syzygy service: four stages of that one puzzle and their colour reflections. They are not eight independent puzzles. The two original queen-ending outcomes were inspected before the expanded audit, so this is not blind sampling.

`promotion-race-outcome-tablebase.json` retains the exact requested positions, source hash, request URLs, timestamps and provider responses. The offline tests validate every legal move, including all four promotions, terminal flags and parent/child outcome consistency. They validate the provider certificate's identity and consistency, not the tablebase database independently.

| Stage | Exact outcome and alternatives |
| --- | --- |
| White to play the original pawn race | **a5 is the only winning move.** Kd7 draws; the four other king moves lose. |
| After a5 | Black loses against all five legal choices. |
| Black to promote after the supplied race | Black loses against all nine legal choices, including promotion to queen, rook, bishop or knight. |
| After Black's d1=Q | White still wins, but only Qxc6 or Qb8+ keeps that outcome. Eleven alternatives draw and six lose. |

Both colour versions give the same results. Child-move categories belong to the **child's** side to move; interpreting them as the mover's outcome reverses the conclusion.

## Classifier boundary

A game-theoretic win is not a material-gain certificate. Conversely, a useful local tactic may exist in an already lost position. Therefore the later promotion must not be described as saving a draw or win, but its losing game outcome does not prove that a bounded local promotion gain is impossible.

The existing expected-failure test for retaining this queen-ending promotion remains unchanged and separately counted. No larger search budget, engine-score shortcut, blanket suppression of tactics in lost positions, or automatic online lookup was introduced. The original a5 deserves further causal pawn-race coverage; exact outcomes alone do not establish a new tactical label.

## Repeatability

Run `node node_modules/vitest/vitest.mjs run src/utils/tests/promotionRaceOutcome.test.ts --maxWorkers=1 --update=none` from the En Croissant root. All **17 offline checks pass**, including rejection of a missing underpromotion and a falsely winning parent record in both colours.

The explicit `promotion-race-outcome-query.mjs` audit can fetch the same public positions into a new receipt path. It is not imported by the app and does not run during ordinary classification. No owner positions, evaluation corpus, installed application or phone service were accessed or changed.
