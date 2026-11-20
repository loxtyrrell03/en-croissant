# Checking-order defences

The v56 explanation required the stronger choice to move the eventual
capture target. This experiment keeps that test and checks other ways
to change the sequence. The stronger choice can take the original
checking piece, prevent the checking move by giving check itself, or
make a new answer to the same attack legal. The last case requires a
separate Stockfish search of the identical reply after the stronger
choice. A changed score with the original attack and answer still
available does not establish the mechanism.

## Held-out results

The development sample is the previous version's 80-game holdout.
The new holdout selects one position per game from 80 public classical
games across 35 normalized 2026 event groups. The development and
holdout share no game, event group or exact root board. Selection used
the recorded moves' check-before-capture shape before engine analysis.
Both versions and the more permissive trial start from the same
Stockfish frames and use the same references within each cohort.

The independent played-move reference compares the exact recorded
sequence against taking immediately with up to 3.6 million nodes. It
also requires a stronger root move and a repeated capture after the
check. The position column is a count of additional explanations on
other decisions from those games, outside the played-move references.

| Cohort | Reference played positives | Reference played negatives | v56 correct played | v57 correct played | More permissive trial correct played | New position explanations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Development | 7 | 9 | 1 | 2 | 2 | 2 |
| Holdout | 10 | 8 | 2 | 2 | 2 | 1 |

Both versions make zero calls on the eight known held-out negatives.
Eight of the ten positive held-out played examples remain unexplained.
Thirteen more played cases are unresolved and 49 lack the conditions
to test this mistake. The more permissive trial accepted a different
answer to the intermediate check when the original piece was still
captured. It gained no explanations and used an extra development
query, so the app keeps the exact reply requirement.

### What the evidence shows

- **Held-out position at Berjaya.** After …Rxb4, Qh8+ Kg6 Rxc8
  takes the knight. Rxc8 immediately allows …Qxc8. After the stronger
  …Kg6, Qh8 gives no check and …Qf6 is legal. A deeper matched root
  search scored …Kg6 at −634 and …Rxb4 at −764 from Black's side.
  The exact order comparison scored +720 for checking and −482 for
  taking first from White's side. Against …Kg6, the separate six
  million node search of Qh8 repeated …Qf6 and scored it +503.
  Both root choices still leave Black worse. This is a corroborated
  position explanation and is outside the played-mistake score.
  [Game](https://lichess.org/broadcast/1st-berjaya-global-chess-open-2026-masters/round-6/Z7lzric1/idslgxxK)
- **Development mistake at La Roda.** …Qc2 permits Bxf7+ and Qxa8.
  …Bxe6 takes the original bishop that would give the check. The
  tactical assessment already existed, and the new evidence explains
  how the stronger move addresses that reply.
- A development control with …Qd7 and …Qc3 keeps the same Qh1+
  and Kxh1 legal after both moves. The verifier does not attribute the
  score difference to stopping that check. In a separate missed
  case, Stockfish identifies a new legal capture of the checker but
  the lower-budget order frame disagrees with the root score beyond
  the allowed tolerance. The verifier leaves the explanation unset.

### Cost

The optional comparison is capped at a 1.4-million-node matched
query and, only when necessary, a 1-million-node same-reply query.
Both share 3.6 seconds of the existing analysis session. Completed
matching replies can be reused. The held-out replay went from two
extra requests across 80 games to five, with seven engine queries
in total. The median time for an affected request was 1.74 seconds
and the slowest took 2.84 seconds on this machine. The timed portion
excludes the normal root search. The cohort is deliberately enriched
for an order pattern, so these timings do not estimate the frequency
of extra searches in ordinary use. The separate 64-game ordinary
reserve made no additional queries under either version.

### Reproduce

Use the frozen `development.json` and `holdout.json`. From the
repository root, score each with the adjacent checking-capture-order
`played_transfer.py score INPUT OUTPUT --engine STOCKFISH`. Use that
folder's Vitest config with `CHECKING_ORDER_INPUT` set to the scored
file, `CHECKING_ORDER_OUTPUT` set to a new file, and
`CHECKING_ORDER_ENGINE` set to the engine. Set
`CHECKING_ORDER_VERSION=8bb06b6f` for v56 and set the same variable
to the v57 commit for the stricter version. Set
`CHECKING_ORDER_ALLOW_CHANGED_DEFENCE=1` on v57 for the permissive trial.
Match the scope and the second and fourth plies of each proof to
the recorded reply and capture before comparing to the played reference.
`independent-reference.py` reruns the deeper Berjaya check.

[Counts, timings and reproduced lines](results.json) ·
[Earlier move-order benchmark](../checking-capture-order/README.md) ·
[Neural search-selection test](../paired-choice-training/README.md) ·
[Isolated Windows run](windows.json)
