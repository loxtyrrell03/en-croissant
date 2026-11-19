# Tactical recovery after a shared capture

This experiment asks why two moves can differ when both allow the
opponent to capture the same piece. It compares an earlier exchange
screen with a stricter comparison of the legal responses. It uses
ordinary classical decisions, including defensive choices.

## Evidence

Both root searches and both independent child searches must agree on
the opponent's first capture and its victim. The better branch must
allow the same immediate response in both searches. That response must
be illegal after the played move and the common capture. Both better
continuations must take the same opposing piece by ply nine, and both
played continuations must retain that piece through their shared
sampled horizon. The material comparison includes the opponent's turn
after the later of the two recovery captures. Search scores must agree
on the size and direction of the setback.

The explanation applies to the sampled replies and the material
balance at the recovery checkpoint. The compared moves can still
leave the side to move with a losing evaluation.

## Results

| Data or method | Outcome |
| --- | --- |
| 65 previously reviewed games, material must settle together | 1 supported recovery |
| Same 65, quiet ending also required | 1 supported recovery |
| Same 65, local comparison after the opponent's reply | 2 supported recoveries |
| App worker, same search frames | 1 new tactical mechanism. The existing worker already explained the other case. |
| 34 fresh games from three events | 0 eligible positives, 0 changed reports |
| 1,051 additional archived requests | Identical assessments apart from the report version. 1,050 valid reports. |

In Karlstad, both `Bf4` and `Kg1` allow `...Nxa1`. Only after
`Kg1` can White play `Ne5` immediately. After `Bf4`, the knight is
still pinned on f3. Both better continuations recover material by
taking the rook that started on d8. This is the actual worker gain.
In a separate search at eight million nodes per branch, the engine
preferred `...Rd6` after `Kg1`. The shared-reply evidence was withheld.

In Lorca, `...Rg6` vacates g8, permitting `...Kg8` against
`Nxf7+`. In both better continuations Black takes the queen that
started on f4. The legal recovery also appears in the deeper rerun.
The previous worker already diagnosed a tactical loss for `...Bxh6`.
Both choices still have negative engine evaluations. The app keeps
the previous explanation.

The 34 fresh games include 22 selected using only the recorded board
geometry and 12 ordinary controls. Thirty failed the comparable loss
frame and four had incompatible opponent replies. This sample checks
that the new trigger leaves those reports alone. A further sample with
eligible positives is needed to estimate recall. The strict rule can
miss plausible continuations when the available searches
reorder the opponent's replies, as in the deeper Karlstad rerun.

The app reuses the paired and independent reply searches already
collected by its existing analysis. The classifier adds zero engine
searches. It labels the finding as engine supported and shows SAN
continuations in the existing evidence control.

## Reproduction

- [Protocol](protocol.json) identifies the engine, classical sources,
  sampling quotas, and input hashes. [collect.py](collect.py) rebuilds
  the controls from the PGNs and runs the existing paired search.
- [Control frames](controls.json) and [deeper frames](deeper.json)
  contain the exact engine inputs. The 65 original cases are in the
  [previous exchange benchmark](../compared-exchange-outcomes/input.json).
- [recovery.py](recovery.py) uses python-chess to replay the material
  comparison and write evidence for its three comparison methods. It
  takes one or more input JSON files and a new output filename.
  [Reviewed lines](reference.json) show the recorded results.
- Set `RECOVERY_OUTPUT` to a new filename and run
  `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/tactical-recovery/vitest.config.mjs`
  from the repository root. Set `RECOVERY_REVISION=f0d82946` for the
  baseline, or use the committed candidate for the updated worker.
  [Results](results.json) includes the archive compatibility totals.
