# Tactical danger alongside two competitive moves

The earlier position check looks for a substantial score gap between the
first two candidates. That misses situations where two choices are sound
and a third allows a concrete tactical reply. This check compares a ranked
third choice against one of the two competitive moves. It uses score gaps
only to decide which comparison is worth checking.

The weaker move needs an immediate capture with a legal exchange gain.
The stronger move must save the exact threatened piece, remove the attacker,
or meet the comparable move with a concrete answer. When the same capture
remains legal on a similar choice, a restricted search verifies the
recapture on that exact board. The ordinary root and an independent reply
search must agree on the losing capture and retain a material deficit.
The position report shows the actual choices and both continuations. Existing
candidate and played-mistake reports are unchanged by this position check.

## Compared methods

| Trial | Cached nominations | Cached confirmations | Fresh audited nominations | Fresh audited confirmations |
| --- | ---: | ---: | ---: | ---: |
| Similar moves only | 1 | 1 | 0 | 0 |
| Similar moves or a direct effect on the original attacker or target | 18 | 10 | 4 | 2 |
| Any supported comparison among the ranked choices | 22 | 13 | 6 | 2 |

The matched audit contains 1,785 cached inputs with 1,679 complete reports.
The middle rule is used in the app. It adds nine tactical position
explanations. On the explicit position-character reference, tactical
recall rises from 40/135 to 42/135. Both versions have zero calls on 54
reviewed negatives. The other seven added explanations have no explicit
position-character reference and do not enter that score. Neither this
result nor the exact lines measure all possible tactics.

The fresh selection was frozen before search. It uses 240 separate games
with a quiet similar-move geometry stratum and ordinary controls. A later
audit matched public game histories against the archive and removed 16
selections that visit an archived board. There were no matched development
event families among the remaining 224 selections. There are 222 usable
reports after this check. Both new tactical explanations remain.
[Input sources](fresh-sources.json) · [Overlap audit](fresh-audit.json)

Each fresh frame uses a 2.4M-node root and a 1.4M-node best-reply search in
both worker arms. The candidate check adds four searches across the 224
audited requests. It starts only when the earlier report has not established
tactical support. The cached experimental replay used 18 extra searches,
including one for a position already diagnosed by the worker. The median
extra query time per nominated fresh case is about 1.5 seconds on this
machine. The app reuses matching replies and caps the new step at two
1.4M-node queries within 3.6 seconds and within the existing session.
[Scores, exact continuations and runtime](results.json)

## Exact examples and deeper checks

- **Bavarian Open.** 28...Nxd4 removes the knight before it can play
  Nxb5. The reasonable alternative 28...Qd7 also works because Nxb5
  then permits ...Qxb5. The alternative 28...Qc8 allows Nxb5 and lacks
  the recapture. The app reports the Nxd4 comparison in the live search.
  The similar-choice experiment also verifies the Qd7 line directly.
  [Exact records](fixture.json)
- **Arequipa.** After 22.Bxd8, ...Bxc2 takes the queen despite the
  rook capture. 22.Qc1 saves the original queen. The unrestricted deeper
  search prefers a different third choice, Qxe4. It verifies ...Rxe4
  and the same Qc1 defence. This repeats the defensive obligation with
  a different capture.
  [Game](https://lichess.org/broadcast/itt-im-arequipa-leon-del-sur/round-6/OyhNXhCb/pNvjHjWO)
- **Bengbu.** After 46.Qc8, ...Qxc5+ takes the bishop and both continuations
  retain a material loss. 46.Be3 moves the original bishop out of that
  exchange. The exact comparison repeats at higher budgets when the
  original three moves are searched again.
  [Game](https://lichess.org/broadcast/2nd-belt-and-road-china-international-chess-open-bengbu-anhui-2026-group-a/round-4/iA7Yri6A/pCi07dl4)

With 4.8M root and 2.8M reply nodes, unrestricted searches repeat three
exact comparisons among the ten cached confirmations. Replaying the
original three choices at the deeper budget repeats six exact comparisons
and one with a different defence. On the fresh cases, the same-choice
check repeats one exact comparison. This measures how sensitive the
lesson is to the search horizon and to which alternatives make the list.

## Reproduce

Use python-chess and the project Node dependencies. The Stockfish 19
binary hash and input hashes are in [results.json](results.json). The
retained cached input and baseline are under the research directory at
settled-exchange-plans/base-input.json and settled-exchange-plans/full-product.json.

1. The public selection is in [fresh.json](fresh.json). Run sample.py roots
   and sample.py reply for its exact frames. For each input, set
   SIBLING_INPUT, SIBLING_OUTPUT, and SIBLING_SCOPE to similar, causal, or
   ranked. Run Vitest with [vite.config.mjs](vite.config.mjs) to nominate
   one weaker choice per position.
2. Run probe.py INPUT NOMINATIONS STOCKFISH OUTPUT. Set SIBLING_FRAMES to
   its result and run the same test again to confirm the exact lines.
   Use sample.py roots with 4800000 nodes for the unrestricted recheck,
   or add --reuse-choices for the deeper comparison of the original
   choices. Use probe.py with --nodes 2800000 for their replies.
3. Set SIBLING_REPORTS=1 and SETTLED_EXCHANGE_REVISION to 8e38f00f or the
   product revision to replay the full worker. The audit and the
   [receipt script](receipt.py) compare the resulting reports and check
   the legal move notation.
4. Run src/utils/tests/siblingRefutation.test.ts for the regression cases.
   Run the benchmark configuration with SIBLING_LIVE_ENGINE set for
   real Stockfish. The source-panel check uses
   verify-panel.mjs PLAYWRIGHT_MODULE CHROME_EXECUTABLE. It verifies the
   normal position report and keyboard evidence disclosure at 320, 390
   and 900 pixels. Installed verification remains open.
