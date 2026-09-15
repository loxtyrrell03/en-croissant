# A hanging piece outside the preferred engine line

Adapter **113** / live pipeline **118** continues the frozen three-game,
217-position owner audit. In one game, Na3 newly exposes the knight to Bxa3.
The live tab already found that capture in its second candidate, but mistake
review only had Qxc3+, the preferred reply. Its harder combination remained
unexplained and the straightforward piece-loss cause was missing.

## Evidence and implementation

The existing seven-search private audit supports Bxa3 (+664 cp for Black),
Qxc3+ (+705 cp), and the better White move d4 (-447 cp for White). These are
finite-depth whole-position estimates, not the capture's 320 cp local bound.
Black was already winning; d4 avoids this knight loss, not the entire loss.

The fallback now considers only same-board, legal engine alternatives supplied
alongside the preferred reply. Both need at least depth 14; the alternative
cannot be shallower than the principal. It must be within 100 cp and preserve
at least half the measured mistake swing. Mate scores do not become centipawns.
These thresholds nominate candidates; they are not tactical proof or an accuracy
calibration. No additional engine request happens inside the classifier.

A separate local check verifies the capture, recaptures, friendly liabilities,
immediate terminal replies and one countercheck evasion. The same victim must
have avoided a profitable immediate exchange before the move and after the
better move, including captures by different attackers. A changed-turn prior
board is only a static exposure comparison, not a legal passing variation.
Moving a guard away can qualify even if the lost piece does not move. Promotions
and terminal captures retain their dedicated paths. Exhaustion supplies no new
witness. The capture/comparison loop has 8,192 counted operations; called exchange
and contextual-capture helpers retain their existing separate bounds.

Only a missing established opponent cause receives this fallback. Existing
priority selection still compares allowed and missed lessons. The alternative
retains its own FEN/UCI/SAN and never enters the preferred PV timeline. Both
review readers expose a separate expandable reply, with persistence, nature
classification, cache identity and idle migration preserving the evidence.

Native review now retains up to three after-move lines, respecting its configured
MultiPV cap. Phone fallback and background local review request three after-move
lines but keep one-line before-move searches. Available stored/cloud alternatives
are retained without adding network requests. Old cached evaluations/cards with
only one line remain usable but cannot invent alternative evidence; a new analysis
is needed to gain it. Review selection/scheduling and owner data are unchanged.

## Contrary evidence that changed the design

The first draft enumerated every legal capture and caused six regression failures.
It wrongly displaced a saving perpetual with a pre-existing loose pawn and called
two inferior pawn captures mistake causes. The novelty check removes the first
class. Nine fresh depth-16 searches additionally show:

- After Bb4 in a public middlegame, Nxb5 scores **-367 cp** for Black versus
  **+22 cp** for the preferred reply. Bxe7 and the opened queen attack refute the
  tempting material-only account.
- In a public rook ending, Rxb6 scores **-1,038 cp** versus **-520 cp** for Black's
  preferred king move. Trading rooks into the pawn ending is not the reason to
  criticize b6+ merely because the exchange wins a pawn locally.
- Another owner-game cxb5 is a genuine local pawn gain, but its score is **+270 cp**
  versus **+366 cp** for the stronger reply. It does not preserve half this move's
  recorded loss, so it is not promoted to the main explanation by this fallback.

The inferior captures and pre-existing-threat controls remain explicit regressions.
The initial failed reports remain private; their expectations were not changed to
make the draft pass. A two-position real background-engine check also validates
rank-one retention, three legal candidates and White/Black score conversion.

## Verification and limits

- Exactly **one** full result changes in the final 217-position replay: Na3 gains
  the separate knight-loss explanation. The other 216 are unchanged apart from
  versions/timing, not independently certified correct.
- **2,299 selected tests pass**, 153 optional skips; 26 new cause/policy controls
  include colour reflection, changed attackers, moved guards, stale/illegal/shallow
  input, budget exhaustion, engine-refuted captures, persistence and nature.
  A final 35-test phone/cause selection passes with the optional owner test skipped.
- All 246 prior private source/live results and twenty rare-theme full results
  are unchanged apart from versions. All 1,043 public worker primary lists remain.
  Twelve controller groups pass, replaying these, the 217 owner inputs and existing
  fork/discovery/perpetual controls; thirteen optional groups are skipped.
- Twelve actual React/Chrome desktop groups pass at 1100/760/360 px, 100/200% text,
  including hidden/revealed answers, separate branches and saved-card migration.
  Screenshots were inspected. The separate reply is explanatory text, not a new
  interactive alternative-board control; the live Tactics tab retains its previews.
- Two native wire/export tests, six built-service tests (including the real engine),
  two cache tests, both TypeScript projects, scoped lint and frontend/service builds
  pass. The 99 cold-HTTP cases pass: first/max startup **1,180/2,072 ms**, max
  computation/transfer **1,342 ms**. Earlier 19.7-second startup under load remains
  contrary evidence; this is not native responsiveness certification.

The tested worker is `liveTactics.worker-HqjXhabb.js`, SHA-256
`59e7055611d2338881179740fbc6190dffffa5beb170e55c42de7d8e366f98d6`.
Authoritative private receipts include `alternate-capture-cause-engine-20260915.json`,
`alternate-capture-cause-novelty-engine-20260916.json`,
`chesscom-recall-adapter113-final.json`, `adapter113-tests-final.json`,
`adapter113-private-replay.json`, `adapter113-rare.json`, the seven
`adapter113-worker-*.json` reports and `adapter113-dev-cold.json`.

Wider recall, longer counterplay, non-capture alternative causes and representative
independent accuracy measurement remain open. Finite-depth nomination and bounded
local retention are not whole-game minimax. Desktop package delivery is recorded
separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`; this source milestone does not
restart any owner app/service or change phone hosting. Paid and owner data remain
outside Git.
