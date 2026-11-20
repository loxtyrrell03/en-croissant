# Promotion-backed intermediate checks

Decision Evidence now links a promotion to an intermediate check when
the legal variation shows the promotion bringing an opposing rook to
the promotion square. It checks the immediate recapture on the
earlier board. The king must be able to take back there, and the
same-square exchange must improve after the actual check and king
move. The report cites the continuation that was checked.

In the Kenya National Chess League example, the line begins
34.f8=R Rxf8. Immediate Rxf8 allows Kxf8. In the searched line,
35.Re1+ moves the king away before the eventual Rxf8. The queen
promotion is also competitive. The explanation applies to the
move order and the rook capture shown in the line.
[Classical game](https://lichess.org/broadcast/kenya-national-chess-league-2026-premier-league/round-1/IhmJDJ0p/ntAXRlf7)

## Evaluation

| Evidence | Before | After |
| --- | ---: | ---: |
| Independently confirmed puzzle lines linked to the root promotion | 0 / 3 | 3 / 3 |
| Root-promotion links among 37 mechanism controls | 0 | 0 |
| Root and position evidence for the Kenyan promotion | Unestablished | Supported |
| Programme-level report changes across the 1,050 valid archive replays | 0 | 0 |

The puzzle selector streamed 4.5 million public Lichess records,
made no local copy of the corpus, and used move geometry rather
than theme tags. It found 40 cases from distinct games. Three
contained a legal immediate king recapture, a king move in
response to the inserted check and a same-square rook payoff.
Separate three-million-node searches compared the direct capture
and the check at the same board. All three searches confirmed the
checking choice. The other 37 are controls for this exact promotion
link. This is a mechanism benchmark and gives no estimate of
overall tactical precision. [Lichess puzzle export](https://database.lichess.org/#puzzles)

Among 221 classical and archival requests in the grouped replay,
one position and its associated candidate-move evidence changed.
On 39 runnable puzzle worker requests, two move explanations
became suggestive. One reply search completed at depth 14. The
other comparison had a score discrepancy outside the existing
corroboration budget. The application gives those exact lines
limited confidence. The check adds zero engine searches. The
existing Decision Evidence panel rendered the supported Kenyan
example at desktop and narrow widths of 320, 390 and 900 pixels.
[Counts, engine identity and input hashes](results.json)

The experimental played-mistake verifier requires the stronger
branches to repeat the same recapture, the weaker branches to
leave the same original rook alive, and the paired material and
score contrasts to hold. It would diagnose the Kenyan mistake.
It adds no new verified comparisons in the puzzle sample. The
separate prototype for an immediate promotion trade found one
development example, and zero in 76 development or 127 reserve
broadcast games from disjoint events. These two experimental
mistake verifiers stay offline.

## Mixed reference audit

Independent searches rechecked all 17 historical mixed mistake
labels. Eight have supported tactical and positional evidence
under the revised review. Nine have at least one unresolved
axis. The incumbent identifies one of the eight as mixed. The
original one-of-17 result is still the score against the
original archive. These are retrospective, single-reviewer
judgments. The revised subset is a map of review priorities
and supplies no new estimate of general mixed recall.
[Both versions and short engine lines](mixed-reference-reviewed.json)

- In the World Amateur case, the supposed second passed pawn on
  d5 faces the opposing pawn on d6 and an e-pawn on the adjacent
  file. The forcing queen exchange can still be checked separately.
- The Tournament of Peace promotion on e1 trades off a pair of
  rooks. All four promotion pieces had the same exact Stockfish
  score at matched depth. The d6 rook invasion after the played
  move does not repeat in the same way in the deeper reply, so the
  positional mechanism remains uncertain.
- In the Fall NYC Norms, both root moves allow the same sequence
  ending in ...Qc1. White can play Qd1 with its rook on e1. With
  the rook already on d1 this defence is unavailable. At the
  e1-rook checkpoint Qd1 scored 0.00 and a separately searched
  position with Qd1 excluded scored −6.27 for White. The exact
  path and both searches are in the receipt. [Game](https://lichess.org/broadcast/2026-fall-nyc-chess-norms/round-3/0VwGgtP4/y3XU0Bki), [checkpoints](counterfactual-checkpoints.json)

## Reproduce

Run from the repository root with Python 3 and python-chess. The
puzzle streaming sampler also uses zstandard. The app replay uses
the committed baseline core and optionally the updated tactical
sequence helper. A real Stockfish frame is needed for the worker
test. Line-only tests use the archived moves and do not infer a
score from their dummy metadata.

```powershell
$suite = 'benchmarks/decision-evidence/promotion-intermezzo'
$env:DECISION_PROMOTION_MODE = 'line'
$env:REPLY_BUDGET_INPUT = "$suite/puzzle-sample.json"
foreach ($arm in @('baseline', 'candidate')) {
    $env:DECISION_LINK_ARM = $arm
    $env:REPLY_BUDGET_OUTPUT = Join-Path $env:TEMP "intermezzo-$arm-$PID.json"
    node node_modules/vitest/vitest.mjs run --config "$suite/vite.config.mjs"
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
node node_modules/vitest/vitest.mjs run src/utils/tests/tacticalSequenceEvidence.test.ts
```

- For the focused puzzle reanalysis, run `puzzle-trials.py` and
  `puzzle-reference.py` with the saved puzzle sample, separate
  output files and the pinned Stockfish binary. The puzzle trial's
  weaker move is a legal counterfactual, selected as a checking
  move played first when available or the highest searched
  non-promotion. It represents a comparison of choices, with
  recorded games evaluated separately.
- For classical score frames, split `classical-samples.json` into
  its two lists and run `gather.py INPUT OUTPUT ENGINE` on each.
  It uses the normal adaptive root and reply budgets. `scan.py`
  replays the promotion-trade prototype on these frames.
  `DECISION_PROMOTION_MODE=paired` runs the separate recapture
  verifier on the same cases as the full worker.
- To reproduce source sampling, pass the local classifier research
  directory, an empty output directory and the repository's
  `reply-search-allocation` benchmark directory to `sample.py`.
  The older private cases are used exclusively as exclusion keys.
- The archived review uses `audit.py INPUT OUTPUT ENGINE` on the
  17-case historical mix subset and `checkpoints.py RESEARCH
  OUTPUT_DIRECTORY ENGINE` for the two exact counterfactuals.
