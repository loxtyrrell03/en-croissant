# Decision Evidence v56 checks the order of a check and a capture

An intermediate check can make the same capture work by changing what
the defender can do next. The earlier assessor could describe a later
capture or a strategic improvement while missing what made the checking
sequence work. An ordinary capture comparison also tends to miss these
positions because the first reply may be a quiet check.

The new check compares **Check first**, **Take immediately** and the
stronger root move. It requires that both orders can legally capture the
same original piece. A matched two-line Stockfish search after the
weaker move must repeat the checking sequence and favour it over taking
immediately. The stronger root move must move the exposed piece out of
that capture. The application keeps the tactical and positional evidence
separate and attaches the check only to its position or played-move
scope.

The first variant also required a retained net material difference.
That missed cases with different exchanges. The revised variant accepts
a concrete alternative explanation when taking first lets the defender
capture the original checking piece and both checked lines preserve that
piece through the comparison. Score agreement, legal continuations,
known game history and original piece identities constrain both variants.
A line that continues after a verified draw is rejected.

## Benchmarks

The first cached screen covers 1,785 prior requests. Thirty-three have
a check-before-capture shape and a large enough score difference in the
compared options. None meets the narrower nomination, so the new check
starts no extra searches there. A separate 64-game ordinary reserve from
Euskadi supplies no opportunities under either screen. The cached Finnish
case from the paired-choice study changes from positional to mixed once
the checker compares the queen move with the preserved bishop. [Earlier
paired-choice study](../paired-choice-training/README.md)

Two further cohorts each include 80 different public classical games,
selected on the recorded check-then-capture shape before new Stockfish
results. The second cohort excludes games and mirrored root boards used
in the first. It shares some tournament families, so this is a
game-disjoint holdout. Each reviewed reference uses a separate 3.6M-node
comparison of the two exact orders. A positive needs both a stronger
root move and a repeated payoff after the check. A close or reversed
order score marks a known negative for this lesson. Unresolved cases
are outside the positive and negative counts.

| Cohort | Known order positives | Known negatives | Prior side-by-side explanations | Material-only | Material or verified counterattack |
| --- | ---: | ---: | ---: | ---: | ---: |
| Development, 80 games | 11 | 6 | 0 | 0 | 2 |
| Holdout, 80 games | 7 | 9 | 0 | 1 | 1 |

The verifier issued no explanation for a known negative or an
unresolved case. The other nine development positives and six held-out
positives still lack this exact explanation. The second variant improves
the development replay and ties the first on the holdout. All three
explanations in these two cohorts add information to an existing tactical
mistake verdict. They do not change its class. Baseline classification
and the unlabelled controls do not establish population-wide error rates.

An analysed position or mistake can add at most one 1.4M-node,
two-candidate comparison within the existing time limit. If a completed
reply frame already contains both choices, it can be reused without an
extra query. In the recorded-order replays, the median time for an
extra query and verification was about 1.5 seconds on this machine.
[Reference counts, continuations and search costs](results.json)

## Exact examples

- **Finnish Championship.** After Qe6 or Qf7, …Rd1+ gets the rook out of
  the way before …gxf4. Taking the bishop first permits Qf5+ and Qxd3.
  Be3 preserves the bishop and gives it a pawn-supported square. The panel
  shows both the tactical requirement and the strategic interpretation.
  [Round 6](https://lichess.org/broadcast/finnish-championship-2025-open/round-6/VbaO6YyH/nG9f6NSy)
- **Asian Zone 3.3.** Nxd5 allows …Qxh2+ Kxh2 …hxg5+. Taking on g5
  immediately gives White Nxc7+ and Nxa8. Qg7 removes the queen from the
  original capture. The move-order evidence supplements the existing
  discovered-check and defender-removal diagnosis. This choice requires
  an exact played-move comparison because it falls outside the normal
  top three. [Round 6](https://lichess.org/broadcast/asian-zone-33-chess-championship-2025-open/round-6/roeA7bS3/2U0pPKIx)
- **Sardinia.** After f4, …Qxg4+ gives Black time to take the rook with
  …Bxf1. Taking the rook immediately lets fxg5 capture the queen.
  [Round 4](https://lichess.org/broadcast/sardinia-world-chess-festival-2025-open-a/round-4/rT0jLf1D/jhS34pTl)
- **La Roda, held out.** After …Rc6, Rxb5+ comes before Rxc6+. The
  immediate Rxc6 lets Black play …Kxc6, changing the rook exchange.
  The stronger …Re6 moves the rook away. [Round 7](https://lichess.org/broadcast/51-open-chess-la-roda/round-7/iviBqeo7/Pc7rAV0v)

The Finnish Bxg5 control offers a superficially similar sequence. Both
orders yield a draw in the matched engine frame. The verifier abstains.
Choices outside the leading searched moves, different replies to the
check, longer sequences and defences that save the target without
moving it remain important sources of missed cases.

Five of the six held-out misses already show the recorded checking
sequence in the normal candidate search. The stronger move prevents
the check in one. A separate search of the same reply after the
stronger choice scores it at least 281 centipawns worse in the other
four. These are concrete leads for verifying defences that leave the
original target in place. [Exact lines for the missed cases](heldout-misses.json)

## Reproduce

Use the checked-in fixture, the project Node dependencies, python-chess
and Stockfish 19 matching the [engine hash](results.json).

1. Set `CHECKING_ORDER_ENGINE` to Stockfish and run Vitest with
   `vite.config.mjs` for position and mistake searches through the
   ordinary engine boundary. Run `src/utils/tests/decisionCheckingOrder.test.ts`
   for exact-frame, board-binding, score-order and scope regressions.
2. Run `played_transfer.py score INPUT OUTPUT --engine STOCKFISH` with
   the frozen `development.json` and `holdout.json`. The recorded
   selection can be regenerated in place from the public broadcasts
   listed in the [source manifest](../paired-choice-training/public-sources.json).
   The holdout selection excludes the first sample, the [paired-choice
   holdout](../paired-choice-training/holdout.json), `ordinary-reserve.json`,
   and the retained `settled-exchange-plans/base-input.json`.
3. Set `CHECKING_ORDER_INPUT` to the recorded engine frames and
   `CHECKING_ORDER_OUTPUT` to a new result path, then run the same
   Vitest configuration. Set `CHECKING_ORDER_MATERIAL_ONLY=1` for the
   first proof variant. `summarize.py` records query counts, coverage and
   the compared continuations. Run `inspect_misses.py FRAMES RESULTS
   STOCKFISH OUTPUT` to replay the same reply after the stronger choice.
4. Use the adjacent `verify-panel.mjs` with Playwright and a local
   browser to exercise the actual worker and evidence expansion at
   320, 390 and 900 pixels. The [Windows regression workflow](../native-desktop/README.md)
   also accepts named capture-order scenarios.
