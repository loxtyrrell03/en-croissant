# Testing whether a passed pawn can advance

The v41 verifier can check a passed pawn after confirming a lost capture
against the same attack. This study asks whether the positional effect can
be verified when the played search branches diverge. It follows the
original enemy pawn. The candidate needs a legal supported or checking
advance in both played branches. At least one leading line must actually
choose it. After the stronger move, the same pawn must already be taken
economically or the same push must be testable at the corresponding ply.
The screen permits up to one pawn of prior net loss for the defender
before the tested advance in the played branches.

## Compared methods

- Natural lines require both leading played lines to push the pawn and
  both stronger lines to take it economically, using saved searches.
- Checked advance searches the board after the push, retaining an
  evaluation that justifies the advance after the played move. A lasting
  pawn or a concrete material payment qualifies. The stronger frame
  must hold and remove the same pawn economically.
- Persistent pawn also requires the played-side pawn to remain an actual
  pawn through two defender turns. This rules out equating a costly
  tactical exchange with strategic pressure.
- Sustained preparation also recognizes when the pawn has already been
  a lasting difference before the push. Both played branches must retain
  it on the same square for four plies immediately before the advance.
  Both stronger branches must have taken that pawn by then. The final
  transition can be a promotion.

One candidate can require up to four searches, with identical prefixes
searched once. Stockfish 19 used 1.8 or 6 million nodes per exact reached
board. The engine, source hashes, depths, outcomes and available replay
timings are in the [results](results.json) and [fixtures](fixtures.json).

| Sample and comparison | Valid paired requests | Nominated games | Natural | Checked | Persistent | Sustained preparation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Archive, seventh rank, 16 plies, 1.8M | 125 | 2 | 0 | 1 | 0 | 0 |
| Reserve, seventh rank, 16 plies, 1.8M | 319 | 7 | 0 | 3 | 2 | 2 |
| Same reserve, 6M | 319 | 7 | 0 | 3 | 2 | 2 |
| Reserve, sixth rank, 16 plies, 1.8M | 319 | 5 | 0 | 1 | 1 | 1 |
| Same sixth-rank reserve, 6M | 319 | 5 | 0 | 2 | 2 | 2 |
| Archive, seventh rank, 24 plies, 6M | 125 | 3 | 1 | 2 | 0 | 1 |
| Separate cached check, seventh rank, 16 plies, 1.8M | 72 | 1 | 0 | 0 | 0 | 0 |
| Fresh complete searches at 78 selected boards, 24 plies, 1.8M per checkpoint | 7 | 1 | 0 | 0 | 0 | 0 |

The table counts supported examples within this specific nomination
method. The samples reuse earlier engine caches, but mirrored boards
and overlapping game IDs are excluded between cohorts. The refreshed
cohort selects one position per game where a fifth- or sixth-rank
opponent passer already exists and the comparison is incomplete.
Forty-three of the 78 played moves led the new preview. Eighteen lacked
a 90-centipawn finite difference in the matched pair, six changed leading
choice, and four lacked corroboration. All seven stable comparisons were
checked. This sample gives a transfer check for this eligibility rule,
with limited power for broad accuracy or recall.

## What the variations establish

- **The stronger move can contain the same pawn.** After `34...Nb8` in
  Misamis Occidental, `e7` survives several moves in two separate played
  continuations. After `34...Nf6`, the engine can take the pawn with
  `...Ncxe7` in both tested lines at six million nodes. This persists
  across both search budgets and is a candidate positional explanation.
- **Short and deep searches can give different outcomes.** In the NATO
  rook ending, one deeper line after `54.Re8+` and `...f2` trades the
  promoted rook on f1 within two defender turns. The shallow search keeps
  the pawn for longer. The persistent seventh-rank verdict changes in
  this case, while an initially incomplete Cork position clears the
  deeper check. Two positives at each budget therefore conceal a
  case-level disagreement.
- **The strategic pressure can precede promotion.** In the Grand Swiss
  example, `51...Kc7 52.Nb5+ Kxc6` removes the pawn. After `51...Kb8
  52.Rb4+ Kc8 53.Rb7`, the c-pawn survives through move 60, then
  `60.c7+ Kxe7 61.c8=Q` converts. The post-advance persistence test
  fails because the pawn promotes. Checking its preparation recognizes
  the earlier difference. The archive informed this variant.
- **A tactical exchange can explain the outcome by itself.** After
  `43.g3 d2 44.Rxd2 Bxd2 45.Qxd2` in a different Grand Swiss game,
  the first counterfactual method would support a positional label.
  The pawn is taken immediately. Both duration-based methods leave
  the positional claim unestablished, consistent with the prior
  review.

The median reached-board search time across the seven nominated
reserve cases was about 3.1 seconds at 1.8M nodes and 11.2 seconds at
6M, excluding the paired root searches. The candidate remains an
offline study. The separate cached and refreshed checks produced no
supported case. A fixed deeper budget also changed which cases were
supported. For a further app trial, the useful distinction is whether
the pawn has a sustained effect before or after forcing play and
whether the effect survives the same-board comparison.

## Reproduce

Use the local Python with python-chess, Stockfish 19, and the retained
input caches identified by name and hash in the results. Run
`experiment.py STOCKFISH OUTPUT INPUT...` with `--exclude INPUT...`
for the previous cohorts. The seventh rank and 16 plies are the defaults.
The comparison flags are `--target-rank 6`, `--horizon 24` and
`--nodes 6000000`. For the refreshed cohort:

1. Use the five cached-check inputs in `cachedCheckInputs` in the results. Exclude
   the two archive and three reserve frame collections. Run
   `refresh.py STOCKFISH OUTPUT INPUT... --exclude INPUT...` to freeze
   12 games per starting rank.
2. Run the same command to a new output with `--per-rank 78
   --skip-sampled INITIAL_OUTPUT` to refresh the remainder.
3. Run `experiment.py` on the refreshed frame files. Use
   `summarize.py RAW_RUN_DIRECTORY RESULTS FIXTURES --cached-check INPUT...` to rescore the
   retained runs and regenerate the compact receipts.
4. Run `test_experiment.py` for exact-board regressions, including a
   wrong-board control and a promotion preceded by stable pressure.
