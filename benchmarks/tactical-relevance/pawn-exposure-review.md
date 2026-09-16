# Pawn recall without incidental continuation noise

Adapter **115** / live pipeline **120** continues the same three-game,
217-position owner audit. It does not select easier games after inspecting
outputs. Private games, course content and detailed engine receipts remain in
`Documents/OnCrescent Tactical Benchmarks/`, outside Git.

## Chess findings

- A pawn advance leaves e5 available to dxe5. The preceding move now has the
  allowed-pawn explanation, and the reply which overlooks it has a missed
  opportunity. The unrelated d4 pawn was already vulnerable; the new reply
  must not be blamed for creating that old danger.
- A queen move abandons e5's protection and Bxe5 becomes available. The queen
  move is itself engine-best, so its response detail remains neutral rather
  than accusing it of a mistake. After the actual f4 and best ...Ne7, Bxe5 is
  still available: the initial draft's missed-pawn accusation was rejected.
- A knight leaves its e4-pawn guard and Rxe4 is now recognized. The owner
  actually takes it, so there is no missed-opportunity accusation. The side
  remains losing overall: winning this pawn is not a claim to win the game.
- The existing Bxa3 knight lesson remains more instructive than the newly
  recognized Qxc3+ pawn gain. Its allowed/missed review explanation stays
  primary, and the live tab initially selects that strong alternative while
  retaining the engine's original ranks and separate lines.
- Another real root retains its direct knight-capture headline while two
  lower-ranked, winning pawn captures gain their own immediate explanations.
  Their later engine-line combinations are not imported as part of the pawn
  lesson.
- One prior public castling response changes from empty to Qxf2's pawn
  capture: queenside castling removes the king's f2 guard. Kingside castling
  instead supplies a rook on f1, and the same queen capture is rejected.
  This is a legal castling alternative from the frozen real game, not a
  newly sampled actual game move.

Nine of 217 complete source/live/review rows change. Several are two contexts
of the same opportunity; this is **not nine independent recovered tactics**.
The other 208 full rows, all 246 prior course/generated-game full source/live
results and twenty rare-theme full results remain unchanged apart from
versions/timing. Unchanged and empty results are not certified correct.

## General mechanism and integration

A generic pawn capture needs a legal, exactly replay-matching previous move.
The pawn must have had no profitable legal immediate capture before that move;
the history move cannot be a capture or promotion. This is a static exposure
comparison using a turn-swapped board, not a played pass or proof of a whole
position's outcome. The actual capture still needs the existing liability and
countercheck-aware gain check. Both bounded helpers use at most 4,096 operations
per call; normal deadlines and engine search counts are unchanged.

The text is **Hanging Pawn**. More specific same-move mechanisms retain
priority. The simple pawn lesson does not establish a connected long engine
continuation; its timeline stops at the capture. Generic later pawn exposures
are not added just because they appear in a PV. Independently connected
interference/pin/other payoffs retain their existing handling, and a reached
board can be scanned on its own.

A concrete retained-capture check withholds a missed-pawn accusation when that
same pawn can still be won after the actual move and supplied legal reply. It
does not prove the moves equivalent or exclude other reasons for the loss.

A stronger alternative can lead over a generic pawn lesson only with legal,
high-confidence immediate evidence, finite same-search scores within 100 cp,
depth at least 14 and no shallower than the principal. The alternative must
retain at least one extra pawn of local gain. These are nomination/teaching
policies, not calibrated accuracy guarantees or claims of best engine play.
Other established primary mechanisms and saving-resource priorities remain.

Native review records the preceding board/move before any per-move filtering;
phone/background review uses the parsed prior move. Both readers, saved schema,
shared deck, nature/motif caches and migration preserve this optional context.
Old cards without history stay usable but cannot invent it. No owner progress
or selection is reset, and ordinary scans make no new external request.

## Contrary evidence and verification

The first broad draft admitted all positive pawn captures. It failed fourteen
existing checks, including routine opening recaptures and primary displacement,
and was discarded. The next draft incorrectly accused f4 of missing Bxe5 and
added an incidental ply-nine course pawn capture; those were removed through
the retained-opportunity and timeline rules above, not redefined as successes.

The final fifteen fresh depth-16 searches check three actual opportunities,
their held captures/played moves, and the preceding exposure decisions. Scores
are full-position estimates, not the local 100-cp pawn proof. dxe5 is +230 cp
versus -87 for held b3; Bxe5 is -310 versus -360 for f4, whose PV still contains
Bxe5; Rxe4 is -826 and was actually played. Some roots repeat the same move,
so this is fifteen searches, not fifteen independent positions.

- 2,331 selected tests pass, with 160 optional skips across 149 files. A further
  43 focused checks include the actual owner pawn contexts, the two additional
  castling controls and both UI/schema
  paths. TypeScript, scoped lint and frontend/shared-service builds pass.
- Three native serialization/export checks, nine built-service checks including
  actual Stockfish, and two development-worker cache/recovery checks pass.
- Forty-eight actual React/Chrome groups cover the live result, both review
  alternative types and pawn review, save/migrate, keyboard preview/reveal and
  layout at 1100/760/360px and 100/200% text. Screenshots were inspected.
  The old renderer expectation of an absent principal line was updated to
  assert its newly verified pawn explanation, still separate from Bxa3.
- The 102-case forced-cold HTTP run includes the new pawn/history/priority
  controls. First/max startup is 7,305 ms; maximum computation/transfer is
  1,345 ms. It overlapped the compiled-worker suite; earlier 19.7-second
  variability remains contrary evidence, not resolved by a passing bound.
- All thirteen enabled production-controller groups pass, with thirteen
  optional private groups skipped. The compiled worker replays all 217 owner
  inputs, new pawn controls and earlier fork/discovery/perpetual controls.
  Its asset is `liveTactics.worker-U6gi6U4r.js`, SHA-256
  `4f4a22dbba1f7cec5bfef1393f66e0fef365e7d4d563f40d320e3f9ee2424f87`.
  Seven `adapter115-worker-*-reviewed.json` receipts retain timings/results.
  All 217 worker scans exactly match the frozen source results. Of 1,043
  prior public primary lists, only the castling-response pawn changes; the
  other 1,042 remain unchanged. Public computation/transfer median/p95/max is
  39/206/838 ms, excluding engine/startup/UI. Four additional fresh held-move
  searches are retained in `pawn-castling-engine-20260916.json`.

Final private receipts are `pawn-exposure-engine-20260916.json`,
`chesscom-recall-adapter115-reviewed.json`, `adapter115-tests-reviewed.json`,
`adapter115-private-reviewed.json`, `adapter115-rare-reviewed.json`, and
`adapter115-dev-cold-reviewed.json`. Earlier `*-final.json` drafts are retained
but are superseded by the reviewed reports. Owner source/live/review computation
median/p95/max is 87/444/644 ms, excluding engine, startup and rendered UI.

## Remaining gaps

This restores new pawn exposure, not every older loose pawn or every capture.
Missing history, earlier captures, promotions and en passant deliberately do
not use this fallback. The retained-opportunity check only follows the same
stationary pawn through the supplied immediate reply. An unresolved real
checking capture before a bishop capture still lacks a convincing root
move-order certificate; it is not counted as recovered. Quiet/longer attacks,
broader causal attribution, representative independently adjudicated accuracy,
alternative practice-answer acceptance and native responsiveness remain open.

Desktop packaging is recorded separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`.
No owner app/service restart, phone deployment, account mutation or native-window
interaction is part of this source milestone.
