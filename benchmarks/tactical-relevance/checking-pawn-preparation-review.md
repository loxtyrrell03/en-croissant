# Checking preparations that force a pawn concession

Adapter **129 / live pipeline 134** recovers a real missed checking attack in
the owner's frozen eight-game sample. A short supplied checking line may now
nominate a pawn payoff, not only a knight-or-larger capture. The supplied moves
are ordering hints: the existing bounded verifier still checks every defence,
connected participants, capture costs, all friendly-piece liabilities, immediate
counterchecks and terminal resources. A piece-payoff nomination keeps priority.
The 32,768-operation budget and production deadlines are unchanged.

## Chess judgement, not matching an expected tag

The recovered queen check has two legal replies. A rook interposition concedes
a pawn; a king flight permits another check, after which different king flights
concede another pawn or the rook. **Forcing Attack** is the honest primary:
neither an immediate fork of the original targets nor a universal deflection
explains every branch. The checked local lower bound is one pawn, not the
engine's full-position advantage. Ten fresh depth-16 searches include all seven
selected attacking decisions; five further searches check the preceding mistake
and its alternative. The alternative keeps the rook able to capture the queen,
so the actual scan, allowed-mistake cause and missed-opportunity lesson agree.

Only two of 420 full owner contexts change: the opportunity and the preceding
mistake. That is **one recovered tactic**, not two independent successes. The
remaining contexts are not certified correct. A separate rook attack must not
be relabelled for an incidental pawn grab absent from its supplied continuation.

The initial bishop/queen-trap hypothesis was rejected: the queen can retreat
to d7. Four fresh searches support that defence. The queen capture in one older
PV cannot establish a trap, and the classifier was not made to accept that claim.

## Exchange context and contrary controls

The first expanded replay added a generic pawn-win badge after a course knight
sacrifice. That pawn was the same piece which had just taken the knight; its
capture only recovers part of the sacrifice. Replay-matching exchange context
now suppresses that small generic preparation at both a newly viewed root and
inside the timeline. The independently verified later fork/preparation remains.
All 246 private full source/live results and twenty rare results consequently
match adapter 128 apart from versions; this is stability, not an accuracy rate.

Constructed tests cover both colours, different defensive payoffs, a capturable
checker, already available material, absent/quiet payoff nomination, exhausted
budgets, a fifty-move claim, sacrifice recovery, live arrows and missed lessons.
An added pawn defender was initially proposed as a refutation; fresh analysis
and complete branches instead show another genuine checking attack. It is kept
as a positive variant, not forced into the negative set. Conversely, the
already-available-piece case is a relevance-policy abstention, not a declaration
that the checking move is bad or the position non-tactical.

The public `checking-pawn-preparation-stockfish-18.json` contains 112 final fresh
searches, including every selected answer in both positive constructed variants
and their colour reflections. All selected positive decisions retain a positive
full-position estimate or mate; this does not equate their estimates with the
local one-pawn bound. An earlier reflected fixture incorrectly retained the
original colour's castling right, producing an illegal engine PV and timeout.
The fixture now explicitly has no castling rights, and all 112 searches were
rerun. That failed harness run is not evidence of an app timeout or a passed audit.
Paid course and owner positions and their detailed receipts remain outside Git.

The expanded public-worker replay changes one of 1,043 previous primary lists:
the constructed `king-flight` control of Lichess 49h84 now explains a Forcing
Attack. Removing the h5 pawn lets the king escape, so the old mating
self-interference claim remains refuted. It does not erase the forcing sequence
R1e6+ Kg5 Rxg7+. Three fresh depth-16 searches in
`checking-pawn-king-flight-stockfish-18.json` support the best root (+438 cp),
held root (+434) and selected capture (+455), all from White's perspective.
The material certificate's bound remains 100 cp, not those engine scores.
The new mandatory regression preserves that distinction. The other 1,042
public primary lists remain unchanged; this is not 1,042 certified answers.

## Limits and delivery

This is a further recall improvement, not completion of the accuracy goal.
Quiet/long preparations, primary-theme judgement, full-position compensation
and load-sensitive native startup remain open. The pawn route needs a short
checking payoff nomination; an isolated first move cannot establish this lesson.
No broader root-only coverage or new network access is claimed.

An accidentally engine-enabled broad test run reproduced a pre-existing
opt-in `judge material mechanisms against engine defences` expectation mismatch
(`discoveredAttack` versus `null`) in both the current source and clean adapter
128. Its chess judgement still needs a separate audit. Another failure in that
run correctly refused to overwrite an existing private engine receipt. Neither
failure was silenced by weakening production expectations.

Final source/controller checks are recorded below. Desktop-package delivery is
recorded separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`; at this source
milestone the package is still adapter 128. Source and package evidence are not
direct native-window interaction or startup proof.

The final source selection passes **2,473 tests** with 195 optional skips across
165 files. TypeScript, scoped lint, the 43-module shared-review build and frontend
build pass, as do eleven generated-service and two development-cache tests.
After the additional king-flight regression, 72 focused tests pass with five
optional skips; whole-project TypeScript and scoped lint pass again. An invalid
test-only `cp` input field was removed rather than bypassing the type check.
The public engine receipt test checks every currently selected positive answer,
not merely that an old JSON file exists. The final immutable compiled worker is
`liveTactics.worker-GnPjnVQC.js`, SHA-256
`d21e42f308083a98e0a0eefa6fdb099a53ed8195cc145f3a1ed9066b0ff5346e`.

Private evidence includes `checking-pawn-preparation-engine-verified-20260916.json`,
`checking-pawn-preparation-cause-engine-20260916.json`,
`quiet-owner-decision-initial-engine-20260916.json`, the three
`chesscom-{recall,disjoint,third}-adapter129-final.json` files,
`adapter129-private-final2.json`, `adapter129-rare-final2.json` and
`adapter129-tests-clean-env.json`. Final fresh engine decisions total 134;
repeated/reflected decisions are not independent discoveries or new holdout games.

All 27 selected compiled-worker groups pass, with fifteen optional skips, and
all 420 owner inputs match their source scans across the three separate replay
runs. The 1,043 prior public inputs have computation/transfer median/p95/max
39/198/1,093 ms, excluding engine search, startup and native rendering. All 186
forced-cold HTTP inputs pass: server startup is 1,878 ms, first worker startup
1,202 ms, maximum worker startup 1,618 ms and maximum computation/transfer
1,322 ms. These are this run's measurements, not evidence that historical
load-sensitive or native startup failures are resolved. No browser automation,
owner-app restart or phone-service deployment was performed for this milestone.
