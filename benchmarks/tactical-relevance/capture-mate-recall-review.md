# Nonchecking capture mates — adapter 144 / live pipeline 151

Nonchecking captures now enter the existing bounded mate-in-three proof without
requiring a supplied continuation that already ends in mate. Every legal defence
still needs a concrete answer. Short independent capture proofs run before the
longer PV-nominated proof; a longer engine line cannot inflate the displayed
distance. A next-turn mate is reported within two moves, not three. Promotions
retain their prior nomination rules. The 16,384-operation cap, caches, engine
deadlines and worker deadlines are unchanged.

## Chess judgement and exact-input comparison

The original owner Bxd5 continuation was explained as Material Gain although it
forces mate within three. Root-only input now receives the mating explanation,
and secondary occurrences stay at their actual ply. Qg7# remains the faster
principal choice in those positions; this is not a claim Bxd5 is best.

The same 1,000 contexts from 21 owner games were replayed, with their stored
engine inputs and complete supplied history. Twenty-one full rows change, but
only one principal live label changes: an endgame Kxd7 now explains the short
mate rather than only taking a loose knight. Adjacent missed/allowed review
shares that lesson, retaining the missed defensive fork as secondary. Six
repeated mating accusations become existing danger: ...Rxe5+ delays Qg7# but
dxe5 preserves a separately proved mate. Other changes concern continuations,
alternatives and proof wording. These are overlapping contexts, not 21 new
tactics. No additional empty principal headline is claimed recovered.

All 246 private course source/live results and twenty rare-theme results remain
unchanged apart from versions. Among 808 prior public worker cases, only the
two colour versions of a constructed queen-countercheck control change primary:
cxb7/cxb2 is mate within two, not merely a queen gain. This is one constructed
layout, not two real-game discoveries or a general accuracy estimate.

An additional inspection of an apparently missed Bxg4 queen capture confirmed
the preceding Qxg4 had just taken the opposing queen. Omitting a fresh free-queen
headline in that live historical context is appropriate; a high engine score or
large destination-piece value alone cannot justify weakening capture filtering.

## Independent verification and contrary evidence

The final diagnostic exports 52 complete mating strategies (including colour
reflections, overlapping reached positions and constructed controls), plus two
queen-capture refutations. The independent python-chess checker verifies every
legal defensive reply, legal attacking answer, terminal mate and distance.
Owner histories are replayed, including repetition and fifty-move checks.
Reflection of complete histories correctly swaps castling/en-passant metadata
and derives fullmove numbering from the replay; the older small-fixture helper
explicitly did not support those fields.

There are 860 distinct nominated engine decisions across the final export.
The three fresh receipts contain 865 held-move searches including repeats and
deeper follow-ups. Expected outcome signs pass across all nominations, and
terminal mate answers retain exact mate-in-one checks. The first receipt stops
at search 719 because Stockfish depth 16 reports mate in five for Kxd7 rather
than the tree's three. It is retained, not called a fully passing distance audit.
Depth 22 finds three in the original and four in the colour reflection. The
complete legal trees establish the upper bound; finite-depth engine distances
do not override them. After a4/a3, the quieter ...Nh5 prepares ...Rf6#, whereas
the longer engine line spends time collecting a pawn. The follow-up receipts
finish all outstanding nominations and the changed public control.

Earlier test mistakes are retained in the work record: a proposed next-turn
fixture started with the king in check and was replaced by a legal capture of
the h6 blocker; the old deflection timeline expectation incorrectly forbade
Bf7# even after an independently mating declined branch. The corrected test
requires a separate reached-position certificate, not borrowed acceptance text.

## Verification and limits

- The selected tactical suite passes 2,660 tests (298 optional skips); the final
  four-file source/React selection passes 111 checks (four optional skips).
- Nineteen generated-review service checks pass (one optional engine skip),
  including root-only mate recognition and saved-card reload. Both development
  worker-cache/recovery tests, TypeScript, scoped lint and frontend/review builds
  pass. Native delivery is recorded separately.
- The final 808-case public production-controller replay passes. Computation
  and transfer median/p95/max is 43/205/1,182 ms, excluding engine and native UI.
  The initial draft worker run timed out once at the unchanged three-second
  deadline during concurrent validation. It lacked the failed case ID; failure
  reporting now retains that ID and completed count. A later pass does not
  resolve the historical load-sensitive timeout or certify native reliability.
- All 1,000 owner-game inputs pass through the actual production controller,
  with source and stored-result parity. Owner computation/transfer median/p95/max
  is 93/341/1,350 ms, excluding engine and native UI. Ten capture-mate/reflection
  cases and twenty existing capture/fork controls also pass: 1,838 selected
  controller inputs in total. These timings are not evidence of acceleration.
- Final worker `liveTactics.worker-CMhfomBf.js` has SHA-256
  `26a3c79a558221316ef976e92a1145f14af396a6d8c68dec8939c62f43611ca9`.
  Native package delivery and exact clean-build identity are recorded separately
  in `docs/TACTICAL_DESKTOP_DELIVERY.md`.

Private receipts use `capture-mate-` in Documents/OnCrescent Tactical Benchmarks.
`*-owner144-final-*` and `*-strategy144-complete-*` are the final source/tree
records. `*-engine144-full-*`, `*-engine144-followup-*` and
`*-engine144-public-*` preserve the contrary search and final coverage. Paid and
owner boards remain outside Git. Broader missed tactics, longer combinations,
primary specificity, automatic review candidate coverage and native startup
remain unfinished; this milestone does not complete the recall goal.
