# A saving perpetual is not just a material fork

Adapter **112** / live pipeline **117** continues the frozen three-game,
217-position owner audit. The source algorithm can already prove the rook's
all-defence checking cycle, including from the first move alone. Its nomination
gate incorrectly skipped that proof whenever a Fork had survived filtering.
A positive local material bound was being treated as a winning game mechanism.

## Chess finding and change

In the reviewed ending, checking first, then taking a knight with check, enables
the repeating rook checks. Taking that same knight immediately, without check,
allows a rook countercheck and loses. The live headline and missed opportunity
now lead with **Perpetual Check**; the actual root Fork remains secondary in the
timeline. The drawing resource has zero invented material profit.

An engine-equal estimate (within 50 cp) and a material deficit now allow the
existing perpetual verifier to run alongside material mechanisms. The estimate
only nominates the comparison: every legal defence must still be covered by
the independent bounded checking-cycle proof. Independently verified mate and
exact ending resources retain priority. Without the equal estimate, an existing
material lesson is not displaced. The unchanged empty-result path may still
find its previously supported perpetual. No engine or worker deadline changed.

This proves an available strategy for at least a draw, not that every alternative
loses or that no winning strategy exists. The drawing-resource headline relies
on a finite-depth engine estimate for context; it is not exact whole-game minimax.

## Independent checks and contrary evidence

- The final fresh Stockfish receipt contains **22 searches**, including repeated
  root checks, not 22 independently sampled positions. Both the owner root and
  a simplified constructed root score 0 for the checking move and all selected
  cycle answers. Every defensive node along these particular witnesses has
  exactly one legal reply, separately enumerated from the board.
- The owner's immediate knight capture scores -1,191 cp; the constructed one
  is a forced loss by mate. These are full-position engine estimates, not the
  fork's 320 cp local gain.
- Adding a bishop that can capture the checking rook produces mate against the
  attacker. Removing king/pawn support permits a king capture and loses heavily.
  Neither control acquires a perpetual in either colour.
- An immediate mating control remains mate, and positive/unknown evaluation
  inputs preserve the material lesson. A positive-score input on the constructed
  draw is a nomination-policy test, not a claim that this board actually wins.
- Two initial constructed controls were invalid: a knight blocked the proposed
  rook move, and a relocated king was already checked. They were replaced with
  legal controls, and every final root is explicitly checked for legality. The
  incomplete engine receipts remain private; they are not successful validations.

Exactly two full owner rows change: the saving opportunity and its preceding
opponent-response detail. The previous player's missed checkmate remains that
row's primary explanation. This is **one improved tactical opportunity**, not
two discoveries. All other 215 full results remain unchanged apart from version
metadata/timings. This does not adjudicate all 217 positions as correct.

## Verification and remaining scope

The selected source run passes **2,274 tests**, with 152 optional skips across
143 files. All 246 prior private source/live results and twenty rare-theme full
results remain unchanged apart from versions. Type checking, scoped lint, shared
review and frontend builds pass. Four built-service and two development-cache
checks pass. Twelve actual React/Chrome groups check the headline, keyboard
preview, present-check arrows and retained root fork at three widths and
100/200% text; inspected screenshots include the narrow enlarged view.

The 99-case forced-cold HTTP suite passes. Its first/max startup is 1,545/1,657 ms;
maximum computation/transfer is 1,311 ms. An initial harness assertion wrongly
assumed every MultiPV input was the old f7 fixture; that assertion now explicitly
belongs to the f7 case. This was a harness correction, not a runtime failure.
The earlier 19.7-second load-sensitive startup remains contrary reliability
evidence, and no native-window latency claim follows.

Private receipts: `perpetual-priority-adapter112-verified-probes.json`,
`perpetual-priority-adapter112-engine-verified.json`,
`chesscom-recall-adapter112-initial.json`, `adapter112-tests.json`,
`adapter112-private-replay.json`, `adapter112-rare.json`, and
`adapter112-dev-cold.json`. All twelve production-controller groups pass, with
thirteen optional private groups skipped: the final artifact replays all 217
owner inputs, ten new constructed/reflected controls, the earlier fork/discovery
controls and all 1,043 previous public inputs. Their ordered primary lists are
unchanged. Final worker `liveTactics.worker-TZ9L-rPZ.js` has SHA-256
`2d8f138c274437062ef17bdf031f276b11c52a6e841d975943ff6859cb1fad5d`;
the seven `adapter112-worker-*.json` receipts record parity and timing.
Desktop delivery is recorded separately. Owner games and paid material remain
outside Git.

Other missed combinations and cause coverage remain open. A new candidate in
the same audit has a correctly identified loose knight in the engine's second
line, but no mistake cause because the preferred checking line is unexplained.
That is a separate multi-line causal-coverage issue, not solved by this change.
