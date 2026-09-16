# Older pawn opportunities with costly defenders

Adapter **124 / live pipeline 129** recovers a genuine owner-game `Nxc3`
opportunity without reinstating the rejected blanket pawn-capture rule.
The extended owner audit now covers all eight games in the fixed monthly
archive: **420 pre-move contexts**, not 420 independent games or accuracy labels.

## The chess and visible result

The c3 pawn was already available before the preceding queen move, so the
newly-exposed-pawn rule did not admit it. Its rook defender cannot profitably
take the capturing knight: `Rxc3 Qxc3+` gives up a rook for that knight.
The live headline now says **Hanging Pawn** and explains that actual exchange.
The root gain is one pawn; the recapture branch gains 280 local cp, not a free
rook and not the engine's whole-position score. Arrows remain on the root.

The preceding queen move was also the analysed best move. Its review therefore
shows existing danger, not an accusation that it caused a new tactic. After the
actual rook move and the supplied bishop reply, the pawn remains available;
there is no invented missed-pawn explanation for that decision.

Two other owner rows gain clearer descriptions of already-visible pawn
alternatives, not new primary lessons. The three first-sample changed rows
represent one newly visible opportunity and one existing-alternative context.
All 122 second-sample full rows remain unchanged. One of the 81 additional rows
changes only its existing `Bxg5` alternative explanation. All 246 private-course
and twenty rare-theme full results remain unchanged, ignoring version metadata.
None of these unchanged/empty results is certified correct by that comparison.

## General rule and contrary controls

- Every legal recapture must have an actual same-square punishment which gains
  at least a pawn beyond replacing the original capturer. The apparent defender
  must be meaningfully more valuable, not a ten-point bishop/knight convention.
- The root and punishment leaves debit other friendly-piece losses, immediate
  terminal threats and the existing countercheck horizon. They share 4,096
  operations, reject incomplete work, and do not borrow a later PV gain.
- The new headline requires exact replay-matching non-capture history. Static
  exchange arithmetic alone cannot say whether this pawn is recovering a prior
  sacrifice. Missing/mismatched history and immediately preceding captures do
  not use this new admission route. Existing connected tactical proofs remain.
- Nonchecking roots only: a generic pawn tag cannot replace the explanation of
  a checking king attack. Checking-pawn retention has its separate proof.
- The text describes why recapturing is costly, not a forced future line. No
  extra labels/arrows are projected onto that hypothetical continuation.

Seven constructed boards are checked in both colours: one and two expensive
defenders, an effective extra defender, missing protection, equal recapturers,
no recapturer and an off-square rook liability. An initial two-defender setup
accidentally pinned the capturing knight to its king; explicit legal replay
exposed that error. The corrected king placement is used in the final receipt.
The two-defender positive is approximately equal in full-position engine
evaluation despite its local pawn gain. The liability control is still globally
winning despite failing this local certificate. Neither is a contradiction or
permission to infer the whole game result from the local material bound.

The draft also admitted an ordinary pawn recovery when a source-only scan lacked
the preceding capture. That finding caused the history requirement; the final
source-only result remains unchanged. Petroff and Catalan recovery controls,
a pawn that just captured a bishop, absent/stale history and exhausted budgets
are separately covered. Broader history-free/undefended older-pawn opportunities
remain a coverage gap, not correct negatives.

## Additional game judgement

The sampler requested three further games but only two remained after the six
explicit exclusions. Both are retained; no easier replacement game was chosen.
Initial chess notes preceded the **81 fresh depth-16 MultiPV searches** and
classifier output. The two games contain 61 and twenty pre-move positions.

The clear bishop-for-pawn gain and hanging queen are explained. Ordinary opening
tempi and compensated pawn exchanges are not turned into tactical mistakes.
The apparently attractive rook-fork sequence must be judged alongside multiple
missed mates: the classifier correctly keeps several short forced mates ahead
of material. A late `d6+` explanation names the discovered check and explicitly
states its independently verified mate. A longer king-escape/mating preparation
remains conditional, and a mate-in-six rook capture still has only its material
headline. Earlier quiet queen/knight preparations are not comprehensively
explained. These are continuing primary-selection/recall gaps, not a completed
game-accuracy audit.

## Verification and private receipts

The final broad source selection passes **2,410 tests**, with 179 optional skips;
a subsequently added compensation regression passes in the 33-check focused
selection. Whole-project types, seven-file lint, the 42-module review build and
8,875-module primary frontend pass. Ten built-service checks (including the real
background engine) and two development-cache recovery checks pass.

The public `costly-pawn-stockfish-18.json` contains **31 fresh searches** over
constructed roots, actual punishment choices and selected safety responses.
Four additional fresh searches check the owner root, its punishment and a queen
countercheck response. These are decisions, not 35 independent puzzles; the
81-search new-game audit is separate. Private games and detailed reports remain
outside Git under `Documents/OnCrescent Tactical Benchmarks/`:

- `chesscom-recall-third-20260916.json`,
  `chesscom-third-initial-judgement-20260916.md`,
  `chesscom-third-adapter123-initial-20260916.json`;
- `chesscom-{recall,disjoint,third}-adapter124-final.json`;
- `costly-pawn-owner-{final,engine-draft}-20260916.json`,
  `costly-pawn-public-{controls-verified,engine-final}-20260916.json`;
- `adapter124-{private,rare}-final.json`, `adapter124-tests-final2.json`.

Twenty-two compiled-controller groups pass (fourteen optional skips), including
fourteen new constructed/reflected inputs. All **420 owner scans** match source
through the production controller. All **1,043 prior public primary lists** are
unchanged; computation/transfer median/p95/max is **38/187/862 ms**, excluding
engine, worker startup and native UI. The immutable worker is
`adapter124-worker/liveTactics.worker-olkEdZhN.js`, SHA-256
`2a208dcdd3f35c3fe5830db92c7bfb35db563f66cdf861db32357d4a818f3452`.

All **155 forced-cold HTTP cases** pass; first/max worker startup is
**1,359/1,684 ms**, maximum computation/transfer 1,279 ms. These measurements do
not resolve historical twenty-second failures or certify native startup. Seven
sampler checks pass, including truthful requested-versus-available game counts.
The frozen initial sample is not rewritten by that metadata correction.

Worker receipts are `adapter124-worker-*-final.json`; the cold receipt is
`adapter124-dev-cold-final.json`. Desktop delivery is recorded separately in
`docs/TACTICAL_DESKTOP_DELIVERY.md`. Broader recall, primary selection, historical
load-sensitive startup failures and native-window interaction remain open. No
owner game, setting, engine profile or phone service has been modified.
