# A completed exchange must not hide a later loose pawn

Adapter **135 / live pipeline 141** corrects a concrete recall failure in the
owner-game audit. The classifier now retains the first capture of an old
same-square exchange when deciding whether a later pawn capture is merely
recovering sacrificed material. It does not admit all pawn captures, increase
their local values, or relax any engine/worker deadline.

## Chess finding and actual change

In the reviewed game an early Nxd4 exd4 exchanged knights. Much later, Qxd4
can take that loose pawn. The history calculation started at ...exd4, charging
White a 320-cp knight loss while omitting the knight White had just captured.
That fictitious debt suppressed the otherwise checked pawn opportunity.

The exchange window now extends backwards through contiguous legal captures
on the same square. A quiet move or different capture square stops extension.
The complete-origin history, piece identities, exact reached position and
independent current capture-safety requirements remain. Earlier material cannot
inflate the displayed gain. Truncated histories cannot manufacture credit.

The owner position now leads with **Hanging Pawn: Qxd4**, valued at the local
100-cp pawn bound. In review, the actual Qxe7 queen-for-bishop loss still leads
at 570 cp; the missed pawn opportunity is secondary. The preceding position
also mentions the available pawn capture, but its unproved best-move comparison
remains neutral. These are two changed report rows for one recovered live
opportunity, not two independent tactical discoveries.

The minimal baseline reproduces the false debt in both colours and the empty
owner headline. Constructed legal opening histories distinguish a settled
knight exchange from a knight genuinely lost without compensation. Existing
Petroff/Catalan repayments and shortened-history controls remain excluded.

## Independent chess checks

There are **58 fresh Stockfish 18 depth-16 searches**: owner best/held/after
positions, all 43 legal replies after Qxd4, and best/held/after checks for the
positive and negative constructed histories in both colours.

- The owner best/held root estimates are +119/+150 cp for White; the after-move
  best defence is ...Nf6 at -162 cp for Black. Every independently searched
  reply position remains positive for White; the lowest is +159 after ...Nf6.
- The constructed positive histories give approximately +1 pawn for the
  capturing side. Qxd4/Qxd5 is also the engine's first choice.
- The unrecovered-knight controls still prefer taking the pawn, but remain
  roughly 3.5 pawns worse. Best available play is not proof of a new net gain.
  Their historical loss is retained rather than erased to satisfy a label.

These finite searches support the chess judgement; they are not exact global
minimax bounds. The 100-cp certificate is local material, not a promised game
result. Constructed boards and reflected colours are not additional real games.

## Verification and delivery

The full **720-context exact replay** changes only the two adjacent owner rows
above. The other 718 full results and all 246 private-course/twenty rare-theme
results are unchanged apart from versions. The latter datasets lack full game
history and are regression checks, not evidence of this rule's broader recall.
Unchanged results and abstentions are not assumed correct.

The 13-file focused source/render/review selection passes 219 checks with
seventeen optional skips. TypeScript and the generated 43-module service build
pass; twelve generated-service tests pass with one optional engine test skipped.
Compiled-worker and clean desktop delivery are recorded after completion.

Broader pawn-history relevance, long attacks, endgame explanations, automatic
review acquisition of extra candidates and native startup reliability remain
open. This small correction does not establish representative tactical accuracy.
Owner game reports remain private under `Documents/OnCrescent Tactical Benchmarks/`:
`settled-pawn-history-{probes,engine}-20260916.json`,
`settled-pawn-owner-adapter135-20260916.json`, and
`adapter135-{private,rare}-verified.json`.
