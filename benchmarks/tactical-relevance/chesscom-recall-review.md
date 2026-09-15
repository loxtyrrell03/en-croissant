# Whole-game recall audit — adapter 110 / live pipeline 115

The subsequent `discovery-recall-review.md` records two recovered discovered
attacks in this same frozen sample, including the e-pawn opportunity left open
below. This document preserves the earlier fork milestone's evidence and limits.

## Selection and chess judgement

The frozen September archive sample contains the owner's latest three standard
games, selected by end time before engine or classifier output. All **217
pre-move positions** are retained, including both players, quiet openings,
exchanges and endings. Initial board-based notes cover selected opportunities,
not independent judgements of every position. This is development evidence,
not an accuracy estimate. Owner games, identities and detailed reports remain
outside Git under `Documents/OnCrescent Tactical Benchmarks/`.

Fresh depth-16 MultiPV-3 analysis required 216 distinct searches, with identical
FENs cached. The terminal played move retains its root scan but omits the
after-position causal review. The subsequent exact-input replay makes no new
engine searches. Forty-two further searches examine one real fork and all
forty selected defensive answers; fourteen examine constructed controls and
an unresolved discovered attack: **272 fresh searches in total**.

## Recovered opportunity, without weakening the proof

A quiet knight fork of a queen and bishop was rejected because the queen can
give a countercheck. In the real position those checks can be answered by
allied captures. The existing named-target, all-defence fallback previously
considered only piece/pawn pairs; it now also considers piece/piece pairs.
Every legal defence must still permit a connected material answer, accounting
for moved victims, all friendly-piece liabilities and immediate mating threats.
The shared 8,192-operation limit and runtime deadlines are unchanged.

The recovered fork has forty checked replies and a minimum local material
bound of 230 cp. Fresh engine estimates for the full positions are different:
the held root scores +497 cp and the weakest selected answer +95 cp. A local
material bound is not a full-position evaluation or a guaranteed game result.

The live fork, the preceding opponent move allowing it, and the owner's move
missing it now agree. Exactly two of the 217 full result rows change: these are
two move contexts of **one recovered tactic**, not two independent discoveries.
Eleven reviewed concrete capture/drawing lessons remain available, including
loose queens/minors, compensated exchange gains and a later perpetual check.

The broader fallback initially added a duplicate Fork beside an existing
Interference in a course continuation. The duplicate is now suppressed only
when the cut attacks its guard, covers exactly the same two targets, and has
at least the fork's proved gain. Distinct targets and stronger gains are not
discarded. Both-colour controls check this relationship.

## Contrary evidence and remaining misses

- An initially proposed checking queen fork is unsound: the attacked queen can
  capture the checking queen. The initial judgement remains in the private
  record; the existing rejection is correct for that proposed mechanism.
- Removing blockers/support in constructed fork controls creates real defensive
  resources. Withholding those certificates does not mean the whole position
  is non-tactical or losing; several controls retain other winning resources.
- An earlier pawn move uncovers a bishop attack on the queen, but a queen flight
  requires further quiet preparation before winning material. The root remains
  unexplained. Fresh engine checks support the follow-up; no label is borrowed
  from the later supplied line to make this audit appear complete.
- In a rook ending a material-fork headline may be less instructive than the
  eventual saving perpetual. The later perpetual is detected; establishing the
  earlier drawing-resource cause remains open.
- Most of the 217 boards do not yet have an independently adjudicated complete
  theme set. Empty and unchanged results are not counted as correct negatives.

## Verification and delivery boundaries

- 2,233 selected tests pass, with 150 optional skips. Whole-project type checking,
  scoped lint, shared-review and frontend builds pass. Five sampler, four built
  service and two development-cache tests pass.
- All 246 prior private source/live full results and twenty rare-theme full
  results remain unchanged apart from versions. All 1,043 prior public worker
  primary lists remain unchanged; stability is not a chess accuracy score.
- The production controller also replays all 217 owner inputs and twelve new
  constructed/reflected controls. Twelve real React/Chrome groups verify the
  fork label, keyboard previews, timeline and target arrows at three widths and
  100/200% text. These are browser checks, not owner native-window interaction.
- All 87 forced-cold HTTP cases pass. **First/max startup is 19,719 ms**, close
  to the unchanged 20-second bound; maximum computation/transfer is 1,326 ms.
  This is adverse load-sensitive startup evidence, not a reliability fix.
- Tested worker: `liveTactics.worker-BUo7O0lE.js`, SHA-256
  `9be4e7e2fe6c4a1c08767e1d9bb6901260855f827d08a0a658194d6494a423bb`.

Private receipts include `chesscom-recall-adapter109-baseline.json`,
`chesscom-recall-adapter110-verified.json`,
`chesscom-recall-fork-stockfish-verified.json`,
`chesscom-recall-supplement-verified.json`, `adapter110-tests-verified.json`,
`adapter110-private-replay-verified.json`, `adapter110-rare-verified.json`,
the seven `adapter110-worker-*-verified.json` reports and
`adapter110-dev-cold-verified.json`. The initial notes are preserved separately.

Source milestone only at the time of this commit. Desktop package delivery is
recorded separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`; no phone service,
owner data, engine installation or running native session is changed here.
