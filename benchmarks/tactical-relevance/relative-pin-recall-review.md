# Relative-pin capture recall

Adapter **123 / live pipeline 128** recovers a missed bishop capture in the
existing six-game owner audit. This is one recovered opportunity, not a new
game sample, an overall accuracy score, or completion of the recall goal.

## Chess judgement and result

In the second sampled game, ply 27, **Bxe4** takes a pawn defended by a pawn
which blocks a rook's line to its queen. **dxe4** is legal, but **Rxd1+** then
takes the queen. Accounting for the bishop and rook given back leaves a local
gain; declining the capture can instead require a bishop retreat, a connected
capture or saving the queen attacked by **d4**. Every one of the 26 legal root
replies is checked. The local minimum is 100 cp, using 183 of 4,096 operations.

The live board and missed-opportunity review now lead with **Pin**. The
intermediate check remains at ply 3 in the supplied continuation, not a
starting-board arrow. The actual **Nd5** misses this opportunity. The separate
preceding **fxe4** context retains credit for its pawn capture: a pawn recapture
alone cannot prove net material loss. Its new position lesson is explicitly
not an established explanation of that move's mistake.

The final owner engine receipt contains 28 fresh depth-16 searches: unrestricted
and held root searches plus all 26 selected answers. The root estimates are
+886/+831 cp and the weakest selected answer +668 cp. These are full-position
finite-depth estimates, not the local 100 cp bound or exact game outcomes.

## General implementation and bounds

- A real relative pin must put a meaningfully more valuable piece behind the
  defender. The bishop/knight ten-point convention cannot establish this.
- A legal recapture must erase the initial same-square profit, and the pinner's
  actual capture of the rear piece must recover a positive net balance.
- Every legal alternative must permit a connected capture or material-retaining
  flight of the capturer, a directly attacked ally, or a checked king. Unrelated
  free pieces elsewhere cannot fund admission.
- Leaves debit all immediate friendly-piece liabilities and use the existing
  one-evasion countercheck/terminal safeguards. Selected safety decisions are
  retained for independent inspection. This is not unrestricted minimax against
  longer quiet attacks, king hunts or perpetuals.
- Text says the recapture is legal but costly. Board geometry marks the real
  pinned defender and existing pinner-to-rear line. The later capture can be
  linked as a Pin Payoff without inventing an additional profit.
- Same-ray, same-payoff pin/deflection duplicates collapse. A newly created
  direct attack on the rear piece keeps the fuller existing Deflection lesson;
  otherwise the already pinned recapturer is the useful explanation.
- A matching proof under the better move establishes continuing danger. Failure
  to re-prove the alternative does not establish prevention or reduced loss.
- Cache versioning advances; app deadlines and automatic network behaviour do
  not change. Ordinary scans remain local.

## Contrary controls and unsolved cases

Nine constructed cases are tested in both colours. They include rook/pawn/queen
and bishop/knight/rook pins; removed pinners, moved rear pieces, insufficient
exchange compensation, already-profitable queen captures, off-ray liabilities,
rook counterchecks and bishop/knight exchanges. The public receipt contains 150
fresh root, selected-branch and safety-decision searches, not 150 game positions.
One constructed positive is approximately equal in whole-position engine
estimates: a local material gain must not be described as a won game.

An initial bishop/knight/rook setup illegally left its king in check; legal
replay caught it before engine review. Moving the king exposed a genuine rook
countercheck resource instead of the presumed positive. Both the contrary
control and a separately constructed sheltered-king positive are retained.

The first overlap policy displaced a valid knight-offer Deflection; the final
rule preserves its distinct rear-piece attack. An early draft also added a
misleading Pin in a private continuation because a bishop was valued only ten
points above a knight, then exposed its exchange payoff as a loose bishop.
That near-equal-minor pin claim is excluded. The genuine underlying checking
exchange still needs its own correct root explanation; withholding the wrong
label is not a solved-tactic or correct-negative claim.

## Verification and receipts

The selected source run passes 2,400 tests, with 177 optional skips. Subsequent
focused checks also cover identical relative-pin danger after two quiet moves,
private missed/neutral review, and matching public engine requests. Whole-project
types, seven-file lint, shared-review and frontend builds pass. The ten service
and two development-cache checks pass.

All 246 prior private full source/live results and all twenty rare-theme full
results are unchanged, excluding version metadata. Two of 339 owner contexts
change for this single opportunity; the remaining 337 do not. Neither stable
nor empty results are certified correct.

Private receipts under `Documents/OnCrescent Tactical Benchmarks/` include:

- `relative-pin-owner-final-20260916.json` and
  `relative-pin-owner-engine-final-20260916.json`;
- `relative-pin-controls-verified-20260916.json` and
  `relative-pin-controls-engine-final2-20260916.json`;
- `adapter123-tests-final2.json`, `adapter123-{private,rare}-final2.json`,
  `chesscom-{recall,disjoint}-adapter123-final.json`.

Public constructed evidence: `relative-pin-stockfish-18.json`. Owner FENs,
identities and paid course data remain outside Git.

Twenty-two compiled-controller groups pass (thirteen optional skips), including
the eighteen new constructed/reflected controls and all 339 owner scans matching
source. All 1,043 prior public primary lists remain unchanged. Public computation/
transfer median/p95/max is 39/192/845 ms, excluding engine, startup and native UI.
The immutable artifact is `adapter123-worker/liveTactics.worker-DoedAu-J.js`,
SHA-256 `25b250721e582e5c1e0b803ebc14e77784ca1849d3ee5a680f2cc8d89469aa1a`.
Receipts are `adapter123-worker-{public,capture,discovery,preparation,game,drawing,
owner,disjoint}-final.json` and `adapter123-worker-tests-final.json`.

All 148 cold-HTTP cases pass in `adapter123-dev-cold-final.json`. First/max
startup is 1,199/1,810 ms and maximum computation/transfer is 1,295 ms; server
startup/prebuild is a separate 1,802 ms. This does not resolve the previously
recorded twenty-second failures or prove native startup reliability. Desktop
package delivery is separately recorded in `docs/TACTICAL_DESKTOP_DELIVERY.md`.

Broader pawn/quiet-combination recall, equal-minor deflection coverage, causal
primary selection and historical load-sensitive startup/native UI gaps remain.
