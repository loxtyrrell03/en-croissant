# Pawn exposure after a defender captures elsewhere

Adapter **125 / live pipeline 130** removes an over-broad previous-capture
exclusion without admitting ordinary pawn recovery. The same eight owner games
and **420 pre-move contexts** are replayed; this is not another game sample or an
accuracy percentage.

## Chess judgement and user-visible results

In the third sample, a pawn on d6 guarded e5 before **...dxc5**. The recapture
moves that guard away from a different, stationary pawn. **Nxe5** is now a
Hanging Pawn opportunity; playing **d3** misses it because **...Nc6** restores
the defence. Its local bound is one pawn. Fresh depth-16 searches prefer Nxe5
(+484 cp), give held Nxe5 +490 and held d3 +393. These whole-position estimates
are separate from the local material bound.

The preceding ...dxc5 also captured a pawn. Its review retains a neutral
**Tactic after the move**, not a claim of net material loss caused by that
recapture. The selected better move ...Nc6 does not settle this compensation
comparison merely by preventing Nxe5.

A second owner opportunity appears in the earlier disjoint sample: **Bxg5**
moves a bishop away from guarding f2. **Qxf2** is now a supported missed
alternative to the played **Qg7**, not a replacement for the engine's preferred
**Bh6**. Fresh root/held estimates are -6/-53 cp for Bh6/Qxf2 versus -383 for
Qg7. After Rdf1, the checked Qxh2 continuation is -89 cp in another finite-depth
search. The pawn gain is not a winning-position claim; the preferred quiet
move's own mechanism remains unexplained.

Only three full owner rows change: the new Nxe5 opportunity/missed lesson, its
neutral predecessor, and the separate Qxf2 missed alternative. The other 417
full results, all 246 private course/derived results and twenty rare-theme
results remain unchanged, ignoring version metadata. Neither unchanged nor
empty output is certified correct by this replay.

## General rule and rejected draft

The new route requires exact preceding-move replay, a stationary pawn different
from the capturing defender, and a legal historical recapture by that actual
defender which no longer exists after its move. Every legal earlier capture of
the target must have lacked a positive exchange return. Existing actual-position
capture checks still debit all immediate friendly liabilities, compensation
and their bounded countercheck horizon. The historical comparison shares the
unchanged 4,096-operation budget and fails closed on exhaustion.

The broader first draft falsely labelled **Rxh6+** as a pawn win in another
owner position where it only delays forced mate. Fresh unrestricted and held
searches return mate against White in ten/nine moves. The new historical route
therefore cannot admit a checking pawn capture by exposure alone: checking
captures retain their separate follow-up verification. The misleading headline
and its preceding-row detail are absent from the final replay. The draft and
contrary engine evidence are retained privately, not counted as successes.

Eight constructed cases, checked in both colours, cover pawn/bishop guards,
remaining defenders, a guard that still defends after capturing, a pawn that was
already loose, ordinary recapture, an off-square rook loss, and a checking move
needing separate retention. The bishop positive is engine-equal despite the
local pawn gain. The already-loose control reaches the same favourable board
as a positive but lacks newly exposed history; withholding it remains an
older-pawn coverage gap. The checking control is not declared an unsound move.

Text names the defender's departure; root arrows show only the current capture.
Saved-card migration uses the new motif/pipeline versions. No deadline,
automatic network request, engine configuration or storage format changes.

## Verification and scope

- **2,429 selected source tests pass**, 182 optional skips. Subsequent receipt,
  owner-regression and actual-component rendering checks pass in a **73-test**
  focused run (five optional skips). Whole-project types and eight-file lint pass.
- The public `capturing-guard-stockfish-18.json` contains **16 fresh** depth-16
  searches on constructed roots/held choices. **12 further fresh owner searches**
  cover the two opportunities, actual alternatives and the rejected delaying
  check. Searches are decisions, not 28 independent puzzles.
- Shared review (42 modules) and frontend (8,875 primary modules) builds pass.
  Ten built-service checks, including the real background engine, and two
  development-cache recovery checks pass.
- **23 compiled-controller groups pass**, fourteen optional skips, including
  sixteen new constructed/reflected inputs. All **420 owner scans** match source.
  All **1,043 prior public primary lists** are unchanged. Computation/transfer
  median/p95/max is **39/200/848 ms**, excluding engine, startup and native UI.
- All **163 cold HTTP cases** pass. First/max worker startup is **1,340/2,409 ms**;
  maximum computation/transfer is 1,356 ms. Server startup is separately 1,955 ms.
  An initial test-harness import error occurred before any worker case; removing
  the fixture's unnecessary production-source import fixes that harness error.
  Passing these cases does not resolve historical twenty-second startup failures.

The immutable tested worker is `liveTactics.worker-D1ItMGOG.js`, SHA-256
`6795ea6cd166f4523e4b14d163f9b6af5c97d82aad0d523c45c19b91fa247357`.
Private receipts remain under `Documents/OnCrescent Tactical Benchmarks/`:
`capturing-guard-{owner,disjoint,public}-*20260916.json`,
`chesscom-{recall,disjoint,third}-adapter125-{draft,final}.json`, and
`adapter125-{private,rare,worker-*,dev-cold,tests}-*.json`.

Desktop package delivery is recorded separately in
`docs/TACTICAL_DESKTOP_DELIVERY.md`. Older/history-free pawn opportunities,
longer quiet preparations, primary-theme selection, native interaction and
load-sensitive reliability remain open. No owner data or phone service changes.

## Subsequent quiet-move review

Eight additional fresh searches examine the next apparently empty owner **Bg5**
root. Its queen-winning PV is not forced: ...Qd7 and ...Nf6 allow ordinary dxe4
recovery, while ...Qd6 permits Nxe4. Held Bg5 is +538 cp versus +500 for the
immediate recapture. These finite-depth estimates and queen-saving defences do
not establish a missed forced queen win. A useful intermediate tempo may still
be explainable, but no new tactic is certified merely to fill the empty result.
The premature Nxe5 option has separate ...Qd4 counterplay (+275 cp), so it is
not treated as an equivalent harmless pawn capture at this later position.

This audit changes the next priority, not the classifier: the still-unexplained
Nb5 queen/c7 preparation is a stronger next candidate than a speculative
queen-winning Bg5 headline. Private initial judgement, requests, fresh results
and reviewed conclusions are `third-bg5-{initial,probes,engine,reviewed}-20260916`.
These eight searches are additional to the 28 source-milestone searches above.
