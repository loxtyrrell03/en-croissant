# En Croissant Decision Evidence

## What is available

Open a game, select **Tactics**, and choose **Analyse position** or
**Analyse last move**. The position, selected candidate and actual
mistake have separate summaries. Use the candidate selector to
inspect alternatives, including the scored played move when it is
outside Stockfish's top three. **Show evidence** exposes the legal
continuations and whether each reason is engine supported, proved
locally, or a strategic interpretation. The same panel is available
from the individual mistake review.

The earlier scanner concentrated on named tactical patterns. Its
separate mistake classifier could infer a positional error from
quiet lines and did not represent mixed evidence. The replacement
keeps tactical and positional support independent. It can verify a
motif through a legal payoff, reuse a completed opponent-reply
search, compare the same reply after different moves and follow the
original piece through captures and promotion. Positional
observations track persistent changes and compare alternative routes
where available. The engine's numerical score stays separate from
the reason. A report can remain unclear.

The runtime uses bounded Stockfish searches, legal board replay and
mechanism-specific comparisons. Maia, Leela and smaller trained
models were compared offline against simpler legal-line rankers.
The best Maia version matched them at six reviewed mixed positions
in twelve review slots on an outside annotated study. The shipped
path uses the interpretations it can support with the actual legal
continuations. [Neural comparisons](../benchmarks/decision-evidence/annotation-transfer/README.md)

## Matched scores at v64

The exact worker at `7a11ac6a` was run on 1,051 historical
requests, 124 earlier reviewed decisions, and the 26-game and
72-game classical samples. Each comparison uses the original saved
Stockfish inputs. The archive and course cases informed earlier
development. The 72-game labels were sealed before the original
prospective replay and have been used for subsequent diagnosis.
The 33 downloaded Woodpecker chapters were read locally. Course
categories served as sampling labels and the evaluated questions
were reviewed separately.

| Reviewed scope | Positives / negatives | Original true / false positives | v64 true / false positives |
| --- | ---: | ---: | ---: |
| Historical classical position, tactical | 135 / 54 | 31 / 0 | 40 / 0 |
| Historical classical position, positional | 212 / 27 | — | 66 / 0 |
| Historical classical position, mixed | 88 / 81 | — | 8 / 0 |
| Historical classical mistake, tactical | 68 / 165 | 10 / 1 | 22 / 0 |
| Historical classical mistake, positional | 89 / 164 | 2 / 0 | 20 / 0 |
| Historical classical mistake, mixed | 17 / 185 | — | 1 / 0 |
| Woodpecker exact move, tactical | 35 / 9 | 7 / 1 | 20 / 1 |
| Woodpecker exact move, positional | 24 / 13 | — | 6 / 1 |
| Woodpecker exact move, mixed | 9 / 22 | — | 2 / 0 |
| 72-game transfer position, tactical | 29 / 1 | 6 / 0 | 9 / 0 |
| 72-game transfer position, positional | 59 / 1 | — | 14 / 0 |
| 72-game transfer position, mixed | 17 / 2 | — | 0 / 0 |
| 72-game transfer exact move, tactical | 19 / 4 | 6 / 0 | 8 / 0 |
| 72-game transfer exact move, positional | 54 / 3 | — | 8 / 0 |
| 72-game transfer exact move, mixed | 7 / 7 | — | 0 / 0 |
| 72-game transfer played mistake, tactical | 3 / 52 | 1 / 1 | 1 / 0 |
| 72-game transfer played mistake, positional | 10 / 52 | 1 / 1 | 2 / 0 |

A dash means the original classifier did not have that independent
output. Its position and exact-move tactical scores use a proxy
based on the scanner's motif on the exact candidate. A missed
positive includes an abstention. Uncertain references and
per-motif denominators are preserved in the machine-readable
scores. Both broad classical reviews use a single engine-assisted
reviewer. The small number of definite negatives for some axes
limits precision estimates.
[Archived and course scores](../benchmarks/decision-evidence/current-classifier-audit/results-v64.json)
· [72-game transfer scores](../benchmarks/decision-evidence/current-classifier-audit/classical-results-v64.json)

## Verified scope and remaining issues

The v65 follow-up explains an actual castling delay when a
specific check forces every legal reply to move the king.
An independently compared earlier castle supplies the
counterexample. This is a separate measured change to the
mistake diagnosis. Collapsed mixed summaries show one reason
from each supported dimension.
[Castling-delay benchmark](../benchmarks/decision-evidence/castling-interruption/README.md)

V66 qualifies an immediate loose-pawn certificate when a comparable
quiet line still takes the same pawn with the same piece. In the
64-game transfer, the deeper search verifies seven deferred captures.
The ordinary captured frames reproduce two and both false tactical
requirements disappear. The 1,367 matched requests retain all reviewed
tactical positives. The change adds no Stockfish queries.
[Deferred capture comparison](../benchmarks/decision-evidence/deferred-pawn-capture/README.md)

- Live Stockfish in an isolated Windows build reproduced the
  Candidates discovered check and the European Club Cup fork,
  each with a separately explained pawn-chain effect. The browser
  panel also passed at 320, 390 and 900 pixels. The installed app
  and phone service are outside those checks.
  [Build receipt](../benchmarks/decision-evidence/capture-route-structure/windows.json)
- The 47-game pawn-chain transfer had one verified
  positive and 34 negatives. The new rule diagnosed the positive
  with zero false calls on those negatives. The separately
  annotated Candidates readback has one of seven reviewed
  mixed positions detected. Its recovered case informed
  development.
  [Pawn-chain comparison](../benchmarks/decision-evidence/capture-route-structure/README.md)
- Quiet threats, late effects and strategic purpose are still
  missed in ordinary games. The 72-game transfer contains
  no confirmed mixed mistake, so it cannot measure that recall.
  Historical mixed mistake recall is 1 of 17. The `Kxg4` example
  is corrected on its reviewed frame. A short search can still
  miss the line that shows the capture can wait.
  [Reviewed failure cases](../benchmarks/decision-evidence/annotation-transfer/README.md)
- The v64 worker took 82 ms median to produce all three scopes
  on the 72 cached frames. Stockfish and rendering are separate.
  The older score and the newer worker timings were captured in
  separate runs. One optional pawn-chain comparison takes at most
  1.4 million nodes in a 3.6-second window inside the normal
  session deadline. It was requested on four of 210 replays.
  [Engine and replay details](../benchmarks/decision-evidence/capture-route-structure/results.json)

The historical research record retains the other controlled
experiments, comparison protocols, motif-specific scores and
source versions. The experimental cases and broad comparisons
measure different things and should be read at their stated scope.
[Research record](CHESS_DECISION_CLASSIFIER_REBUILD.md)
