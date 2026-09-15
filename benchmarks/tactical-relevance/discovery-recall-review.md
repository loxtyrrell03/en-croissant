# Recovering discovered attacks from the owner's games

Adapter **111** / live pipeline **116** continues the fixed 217-position,
three-game audit in `chesscom-recall-review.md`; it does not select a different
sample after seeing the results. Paid material and owner games/reports remain
private, outside Git.

## Chess findings

The first recovered opportunity advances the e-pawn to uncover a bishop's
attack on the queen. Most queen flights lose to an allied piece; the remaining
flight allows the bishop to pin that same queen to its king. The e4 and e3
versions both work. The original expectation that a longer knight continuation
was necessary was too restrictive: the pin and immediate queen capture already
retain material, including the opponent's pawn capture and compensation.

A later b-pawn advance opens a different bishop/queen diagonal. It also traps
the queen, with allied pieces covering its flights; it does not need the pinning
extension. This second candidate was found in the changed-output audit, not
independently selected before classifier output. Its board geometry, all legal
defences and selected captures were then reviewed and checked with fresh Stockfish.

Both positions now have a **Discovered Attack** root lesson and a matching missed
opportunity. That is the useful initiating mechanism: moving the pawn opens the
bishop, and the later pin remains secondary on its actual ply and branch. There
is no duplicate starting-board pin or future capture arrow. In the preceding
opponent-move contexts, the new tactic is shown neutrally: the comparison still
has not established that the move caused it. Four full owner-result rows change,
representing **two tactical opportunities**, not four independent discoveries.

## Bounded mechanism

The new fallback catches only a named newly revealed non-pawn victim. After
every legal defence, either an ally can capture that same victim profitably, or
the original slider pins its fleeing victim to the king and every subsequent
defence still loses that victim. The proof cannot substitute an unrelated loose
piece or pawn gain. A piece already immediately winnable before the discovery
does not qualify through this fallback.

The shared 4,096-operation budget covers the selected captures, all friendly
piece liabilities, immediate terminal resources and the existing one-evasion
countercheck safety horizon. There is one extra pinning tempo, not arbitrary
quiet search. Exhaustion/unknown stays unproved. Previous proof paths, engine
requests and runtime deadlines are unchanged. Text, board geometry and causal
target comparisons use only the actually certified ray/victim.

The real e4/e3/b4 certificates check respectively 40/39/39 first replies, with
25/24 further replies for the two pins, using 422/363/304 counted operations.
Their local material bounds are 470/570/470 cp. The **185-search final fresh
Stockfish audit** checks the three unrestricted/held roots, every selected root
answer, every pin answer and twelve constructed/reflected controls. The weakest
full-position estimates in the three real groups are +554/+560/+335 cp; these
are not the local material bounds. An earlier 144-search run is a repeated
subset, not additional independent coverage.

## Contrary controls and limits

- Removing flight coverage, removing the check-capture recapturer, moving the
  king off the pinning diagonal or leaving the discovery blocked invalidates
  the new certificate in both colours.
- An off-square loose queen defeats the local gain instead of being ignored.
  This additional control is checked by legal source/worker proof, not included
  in the twelve engine-checked controls above.
- The first blocked-ray fixture accidentally put a bishop on the pawn's path;
  the legal replacement blocks the bishop's diagonal on a different square.
  That correction is not an algorithm success.
- A draft that mixed the original queen with a pawn target accepted a weaker
  pawn payoff. It was discarded in favour of the same-victim proof; the private
  draft receipt is retained. The shipped logic does not promote that shortcut.
- Four changed rows do not establish accuracy for all 217 positions. The earlier
  saving-perpetual headline issue and other longer/quiet combinations remain
  open. Bounded local retention is not a full minimax game result.

## Verification

The final source selection passes 2,254 tests with 151 optional skips. All 246
prior private source/live full results and twenty rare-theme full results remain
unchanged apart from version metadata. Twelve actual React/Chrome groups cover
the root label, exact preview geometry, keyboard timeline, actual-ply pin and
no-theme escape control at three widths and 100/200% text. Screenshots were
inspected. Type checking, scoped lint, shared-review/app builds, four built-service,
five sampler and two development-cache checks pass. These are development and
regression checks, not a representative accuracy score or native-window proof.

Detailed private receipts: `discovery-recall-adapter111-final-witnesses.json`,
`discovery-recall-adapter111-engine-final.json`,
`chesscom-recall-adapter111-verified.json`, `adapter111-tests-final.json`,
`adapter111-private-replay-final.json`, and `adapter111-rare-final.json`.
All eleven production-controller test groups pass, with thirteen optional private
groups skipped. All 1,043 earlier public primary lists are unchanged. The final
artifact also passes all 217 owner inputs, fourteen new constructed/reflected
controls and the twelve earlier quiet-fork controls. All 94 forced-cold HTTP
cases pass: first/max startup 1,175/2,018 ms and max computation/transfer 1,365 ms.
That successful run does not erase the earlier 19.7-second startup under load.

Final worker: `liveTactics.worker-1lM6yZng.js`, SHA-256
`5c5513ce796a1c6aed3676f1d1993b1e69d21d65193b696229c3303a241c2ba5`.
The seven `adapter111-worker-*-final.json` reports and
`adapter111-dev-cold-final.json` retain the receipts. Package delivery is recorded
separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`; this source milestone does not
restart an owner app or change owner data/phone services.
