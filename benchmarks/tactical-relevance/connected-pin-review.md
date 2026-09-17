# Connected quiet pins — adapter 157 / pipeline 164

## Recovered real-game lesson

The original owner **...Bb4** root, left open in the fork-ray audit, now leads
with **Pin**. The bishop pins Nc3 to Ke1, but winning Nc3 is not the answer to
every defence. All 37 legal replies have connected checked continuations:

- Most allow Bxc3; Bd4 instead concedes its newly added guard to exd4.
- Bd2 permits Bxc3 and the previously verified checking-fork preparation.
- Bxg4 first loses the attacking bishop. Bxc3+ must then recover that actual
  capturer, including Bxd2+ before Nxg4 against the interposed bishop. The
  sacrificed bishop and every checking reply count in the net result.
- Rd8+ concedes the checking rook to Nxd8.
- Kd2 allows Bxe2 because the same pin forbids Nxe2; the alternative king
  recapture permits a checked queen capture.

The minimum local bound is **100 cp**, not a free knight or the engine's
whole-position score (the held root scored +535 cp for Black in this audit).
The actual queen-losing move still has **Hanging Piece** as its primary mistake;
the missed pin is the secondary lesson. The preceding opponent move receives
neutral tactical-context wording: its better-move comparison has not established
that it caused this pin.

## General rule and limits

This supplements the existing immediate pin checks for a noncapturing quiet
move creating a new absolute pin. Every legal reply must permit capture of
the original/moved target, its newly added guard, a checking piece, or a gain
independently protected by this same pin. Capturing the original target may
also begin a verified checking-fork preparation. Off-square countercaptures
are debited and must be recovered through their actual piece/checking exchange;
unrelated loose material cannot finance that branch.

The new proof shares a 32,768-operation envelope, reserving the full allowances
of nested proofs. Existing helper limits and the 20-second startup/three-second
worker computation deadlines are unchanged. Unknown, exhausted, promotion,
terminal and available fifty-move-claim branches do not certify the pin.
Colour-reflection-stable ordering prevents search order from selecting different
proof branches solely because the board is reversed.

This is bounded local material verification, not an exhaustive game solver.
It does not establish arbitrary longer attacks, repetitions or exact ending
outcomes. A failed proof is an abstention, not evidence that the position has
no tactics. Heterogeneous pin branches cannot establish a causal comparison
merely by comparing the originally pinned victim's value.

Current-board arrows show the pin ray and initiating move, not future captures.
Matching later intermediate checks/fork preparations keep their actual-ply
mechanism, without counting their already-included material a second time.

## Contrary controls and review calibration

The constructed bishop/rook battery wins material but only holds approximately
equal play: it is a saving pin, not a winning position. After the inferior king
move, fresh searches prefer Kh2/Kh7 in the two colour versions, with side-to-move
scores +359/+382. Source and generated saved-review tests use those decisions.

Removing support, moving the king off the ray, allowing capture of the pinner,
adding a second ray blocker and an ordinary opening pin all fail the new
certificate in both colours. This rejects the proposed pin gain, not necessarily
every possible tactical move on those boards. Invalid budgets cannot reuse a
cached certificate, and a quiet entry reaching a fifty-move claim is rejected.

## Verification

- The frozen **27 games / 1,319 contexts** change in four full rows: the new
  live pin/missed lesson, the preceding neutral opponent context, and two
  alternative-line timelines. The latter do not change their principal theme.
  One replaces a trapped-rook label with the actual pin; another uses 170 cp
  for the pin instead of borrowing an earlier pawn capture, with the subsequent
  intermediate check's duplicate value removed. These are not four independent
  newly solved root tactics.
- All **246 private-course** and **twenty rare-theme** full results remain
  unchanged, excluding classifier versions. Unchanged is not certified correct.
- **258 final fresh depth-16 engine searches** comprise 252 main decisions and
  six additional recorded countercheck answers. The public constructed subset
  has 76 searches in `connected-pin-stockfish-18.json`; 182 private owner
  decisions remain outside Git. These are branch searches, not puzzle counts.
- Independent python-chess checks cover all six positive root-reply sets
  (24, 24, 37, 37, 19, 22), recovery paths, pin geometry and legal countercheck
  answers. Deliberately removing any root reply fails. This does not independently
  certify TypeScript material arithmetic or solve the ending.
- The final selected source suite passes **2,848 tests** with 341 conditional
  skips. Twelve opted-in pin tests and 32 generated-service checks pass; one
  service test requiring an optional real engine is skipped. Types, scoped
  lint and review/frontend builds are checked separately from native delivery.
- An earlier concurrent full selection reported two sample failures; the
  unchanged assertions pass in isolation and in the final full selection.
  Their retained JSON stack alone does not identify a cause. A separate
  diagnostic-recording variable mistake was caught by focused tests/types and
  repaired before the final suite and generated-service rebuild.

Private receipts use the `connected-pin157-` prefix under
`Documents/OnCrescent Tactical Benchmarks/`. `decisions-final2`,
`engine-final` plus `engine-supplement`, `owner-final`, `private`, `rare` and
`tests-final2` dated `20260917` are authoritative over earlier drafts.
Compiled-worker and clean desktop delivery evidence is recorded below.
Owner stores and phone services are not changed or automatically
rescanned. Broader quiet/long combination recall, the known queen-ending
promotion miss and primary-theme accuracy remain open.

## Compiled controller and desktop handoff

All **2,143 current compiled-controller inputs** pass: 808 public cases,
sixteen pin/contrary-control inputs and all 1,319 owner contexts. Six retained
adapter-156 comparisons include the original owner pin and its reflection,
which lacked the recovered label. All 808 public primary lists remain unchanged.
The owner replay compares both the frozen final source results and fresh
classification, including full history and the changed alternative timelines.

Public computation/transfer median/p95/max is **43/222/1,218 ms**; owner timings
are **103/457/2,204 ms**. Startup maxima are 38/46 ms respectively. Engine search,
development HTTP startup and native UI are excluded. This is not an isolated
performance experiment or a native-startup reliability guarantee.

Source `d482389e` is the committed clean desktop-build input. Its worker is
byte-identical to the tested primary-checkout artifact. Clean TypeScript, the
81 focused source/React checks (four conditional skips), 32 generated-service
checks (one optional engine skip), 43-module review build and 8,863-module
frontend build pass. Generated service differences are source-region comments
only; the route tree differs only by line endings. Native delivery identities,
backup and final status belong in `docs/TACTICAL_DESKTOP_DELIVERY.md`.
