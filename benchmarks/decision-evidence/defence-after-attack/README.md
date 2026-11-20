# The same attack after a different move

Decision assessment v41 can explain a mistake when two searches agree on
the opponent's checking sequence and a stronger move would have kept a
concrete defence legal. It replays the common attack after both choices,
tracking the same pieces across the two boards. A new search considers
only captures of the attacker after the stronger choice. A second search
repeats the played reply from the exact reached board. The report needs
a sound defence, agreement with the original scores and a sustained
material difference in all three played continuations.

When the same original passed pawn advances with support in all three
played lines, the worker can compare the advance separately. It tests
the same move at the corresponding ply of two distinct lines after the
stronger choice. Both searches must hold the evaluation and take the
original pawn without giving back material in the immediate sequence.
The pawn's identity and the capture lines are concrete evidence. The
attribution to restraint of a passed pawn is a positional interpretation.
The tactical explanation describes an available defence, which can be
one of several adequate answers to the attack.

## Results

| Checkpoint experiment | Eligible archive decisions (8) | Eligible reserve decisions (15) |
| --- | ---: | ---: |
| Four searches, including unrestricted and capture-excluded checks | 5 | 4 |
| Two searches, comparing with the existing stronger-choice score | 5 | 6 |
| One search, relying on the existing played lines | 5 | 7 |

There were 125 archived decisions and 319 reserve decisions with a
stable score comparison after grouping by game and board. These counts
include mirrored board deduplication. The reserve uses different games
from the reviewed archive, drawn from existing classical caches. The
rows are verified defensive resources within each selected group.
Excluding the capture set reproduced the material loss in two reserve
cases. The one-search arm added a case whose new played search fell
below depth 16. The final check retains the independent played search
and makes the narrower claim that the capture holds in the tested branch.

The complete worker replay includes 1,734 valid archived and reserve
requests. With the original frames, every existing report agrees after
ignoring the cache version and optional search requests. With additional
frames, three archival cases and three reserve cases gain a tactical
explanation. One archival case also gains positional evidence. On the
317 valid archived mistakes with existing manual labels, the comparison
is as follows. Uncertain labels are excluded from the relevant denominator.

| Mistake dimension | v40 true positives | v41 true positives | False positives, both |
| --- | ---: | ---: | ---: |
| Tactical | 20/67 | 23/67 | 0/165 |
| Positional | 20/88 | 21/88 | 0/164 |
| Mixed | 1/16 | 2/16 | 0/185 |

Sixteen distinct reports requested a search in the app. Four further
requests replayed the same archived ending with different root or reply
budgets. The independent reserve supplies three new tactical case
explanations and no eligible passed-pawn verification. This targeted
replay supplies limited evidence about tactical mechanisms outside the
loss of a defensive capture. Reserve-wide precision and mixed recall
would require fresh labels at that scope.

## Verified lines

- In the Asian Disabilities women's classical event, `...Kd7 Re7+
  Kc6 Rc7+ Kd5 d7 Rd8 Be7 Rxd7 Rxd7+` costs Black the rook.
  `...Rf7 Re7 Rxe7+ dxe7` holds in the checked line. The two
  additional pawn tests after `...Rf7` independently allow `...Bxd7`
  and `...Rxd7`, both evaluated around equal. Only the final,
  separately checked result is mixed.
- In the Copa Revolución, the sequences after `...e5` and `...Re7`
  share `Ng5 hxg5 Bd5`. The move gives check after `...e5`, while the
  original e-pawn can answer with `...exd5` after `...Re7`.
  The tactical report identifies that lost defence.

One common failure is early divergence between the paired and independent
played searches. Another is recovery through different material exchanges
without a repeated captured target. A quiet threat or a later positional
collapse can still remain unclear.

## Cost and reproduction

Use Stockfish 19 with the hash in the checkpoint receipts. Research
searches use 2.4 million nodes, one thread and 32 MiB hash. The app's
existing native-search settings use one thread and 64 MiB hash. The app
adds up to two searches per confirmed nomination and two more for a
passed-pawn check within the existing 28-second session. An unfinished
optional search leaves the available result in place. Two fresh full-path
engine replays on this machine took 9.8–10.8 seconds for the mixed case
and 13.8–13.9 seconds for the separate tactical case, including the root
and reply searches. The UI replay uses the real worker with saved engine
frames at 320, 390 and 900 pixels.

1. Use the five retained cache paths in `prepare.py`. Run
   `gather.py nominate strict-archive.json <archive files>` and
   `gather.py nominate strict-reserve.json <reserve files> --exclude <full-pair-input.json>`.
   Run `gather.py search <nomination> <engine> <checkpoint output>`
   with outputs named `strict-archive-search.json` and `strict-reserve-search.json`.
2. Run `analyse.py <checkpoint output> <results> --arm targeted` for
   each cohort. Repeat with `full` and `cached` for the comparison.
   Run `passers.py <checkpoint output> <targeted results> <engine> <pawn output>`
   for `archive-passers.json` and `reserve-passers.json`.
3. Run `prepare.py <classifier-rework> <checkpoint directory> <input> --include-unselected`.
   Set `DEFENCE_INPUT` and `DEFENCE_OUTPUT`, then run
   `vitest run --config benchmarks/decision-evidence/defence-after-attack/vite.config.mjs`.
   Use `DEFENCE_REVISION=ae566ad5` for v40 or the v41 commit for the
   candidate. Run `score.py <input> <baseline> <candidate> <score output>`.
4. Set `DEFENCE_ENGINE` and change `DEFENCE_OUTPUT` to run the checked
   live-engine smoke test with the same Vitest command. Run
   `node benchmarks/decision-evidence/defence-after-attack/verify-panel.mjs <playwright-core entry> <chrome executable>`
   for the panel checks.

[Worker results](results.json) · [Exact engine fixtures](fixtures.json) · [Session timings and engine identity](engine-results.json)
