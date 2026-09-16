# Quiet allied repairs before collecting a checking fork

Adapter **119 / live pipeline 124** recovers the previously documented real
Lichess tA2XR fork without undoing the off-square queen-liability correction.
The fixed owner-game and course samples remain in use; no easier replacement
games were selected. This is a recall milestone, not completion of the broader
accuracy goal.

## Chess judgement

Nf6+ attacks both rooks and checks the king while uncovering the queen's check.
The knight on c5 attacks White's queen on b3. Immediately collecting a rook
after ...Kh8 therefore loses the queen. **Qf7** first saves that queen and
maintains the pressure. The other legal king reply, ...Kf8, requires **Qg8+**.
The primary lesson is Fork, with those supporting moves described as future
alternatives, not starting-board arrows or an independently forced root mate.

The shorter supplied line is not a sufficient proof. ...Nd3+ requires a safe
king refuge; ...Qe7 can require exchanging queens before collecting a rook;
...Qf5 can instead allow gxh6 and a new mating threat. ...gxf6 after Qf7 is
answered by Rxh6#. These mechanisms must survive actual alternative defences.

Final fresh held root searches give +244 cp for Nf6+ and +210 for its
colour/rank-reflected constructed counterpart. Removing White's mating rook
gives -476, and placing a black rook in the mating file gives -655. These
controls invalidate this certificate, not every possible tactic in the board.
The constructed a3 mistake scores -945; ...Nxb3+ is +835 in the separate
reply search. Review keeps that larger established opponent cause ahead of the
missed fork. Its existing Capturing Defender wording is not newly certified
as the ideal primary taxonomy by this milestone.

## General proof and boundaries

- Only a checking, non-capturing, non-promoting fork is eligible. A threatened
  allied piece is nominated from legal captures of that piece, not a supplied
  engine continuation. Checking repairs by that ally are considered; a quiet
  repair must support the forker and attack an original fork victim.
- Every legal root reply and every reply to the chosen repair is checked.
  Targets follow their actual moves. Allied captures of original targets and
  replies to newly moved counterattackers are allowed; a pre-existing unrelated
  loose piece cannot supply the certificate.
- One pre-collection check evasion, one equal major-piece exchange and one
  further newly created mating threat are supported. A hypothetical pass only
  nominates that threat; all real replies still require an answer. Checking
  mates are independently searched through two attacking moves.
- Material leaves use the existing all-friendly-piece liability and
  one-countercheck-evasion checks. A costly allied queen-for-rook liquidation
  is not accepted as a shortcut. Immediate mate is preferred to abandoning the
  attack for a small material gain. King-refuge ordering favours fewer immediate
  counterchecks, but ordering itself does not certify safety.
- The shared **8,192-operation** budget includes these branches, mating searches
  and leaf checks. The real proof uses **4,671 operations** and has a **100-cp
  local material bound**. It does not promise a won game or equal that position's
  engine evaluation. Existing application deadlines are unchanged.
- The root-only, quiet-queen and checking-queen supplied lines yield the same
  root lesson. The board draws Nf6 and its present targets, not Qf7 or Rxh6.
  Missed opportunities retain the root fork; unsupported opponent causal
  comparisons remain neutral instead of using an immediate-exchange comparison
  for this longer mechanism.
- Default caches are bounded; custom/exhausted budgets cannot reuse a default
  success. Fifty-move claim boundaries and incomplete searches withhold proof.
  Longer quiet counterplay, broader repetition handling and arbitrary repairs
  remain outside this certificate.

## Contrary evidence retained

The first draft found positive local material but selected Kd2 after ...Nd3+.
Fresh Stockfish scored that move -415 cp; several queen-liquidation witnesses
were also losing. A second ordering-only draft still selected five losing
queen trades, reaching -651 cp. Neither draft was integrated or delivered.

The final **426 distinct selected decisions** were each searched afresh at
depth 16. All have positive full-position estimates or a winning mate: 25
finite scores (minimum +84 cp) and 401 mating results. These are many branches
of one real position, **not 426 independent puzzles**. The public receipt is
`fork-repair-stockfish-18.json`; it excludes owner/course positions and their
private source identity. Six final root/control searches are retained privately
in `quiet-fork-repair-controls-engine-20260916.json`.

## Regression and delivery scope

The exact-input source replays leave all **339 owner-game results** (217 + 122)
and **246 private course/generated-game results** unchanged apart from metadata
and timing. Of twenty fixed rare-theme positions, only tA2XR changes, from an
unexplained root to Fork. This is one recovered opportunity, not proof that
the unchanged or empty outputs are correct. The different course fork requiring
a rook-saving tempo remains outside this new certificate.

The selected 153-file source suite passes **2,379 tests**, with zero failures
and 166 optional skips. A focused 43-check run also exercises the actual engine
witness receipt. TypeScript, scoped lint, shared-review and frontend builds
pass. Ten service checks (including real Stockfish) and two worker-cache checks
pass. No new browser automation or native-window interaction is claimed.

The immutable production worker passes seventeen groups, including ten new
real/reflected repair and contrary inputs. Separate owner replays match all
339 source scans. All 1,043 prior public report inputs retain their ordered
primary lists; computation/transfer median/p95/max is **37/193/851 ms**, excluding
engine time, startup and the native UI. The tested worker is
`liveTactics.worker-BzIG7cnk.js`, SHA-256
`3a7a215618b9ff3b2ea33f6e27b79943c9e232f5f6ef240f7b3e78126a87bf2f`.

The forced-cold HTTP check **fails at the unchanged twenty-second startup
deadline**, with its first worker-module request still pending and no completed
module loads. Its test child exits; the owned test server stalls in cleanup
and is explicitly stopped. A separate warm-cache run passes all 122 cases,
including the new fork fixtures. Warm success does not erase the cold failure
or certify native reliability. No deadline is increased, and an error is not
converted into a successful empty scan.

Private receipts are `adapter119-tests-final.json`,
`adapter119-{private,rare}-final.json`,
`chesscom-{recall,disjoint}-adapter119-final.json`,
`adapter119-worker-{public,capture,discovery,preparation,game,drawing,owner,disjoint}-final.json`,
and `adapter119-dev-{cold,warm}-final.json`. The final six root/control searches
and 426 selected-decision searches are separate from the rejected draft
receipts; none are independent accuracy samples.

Desktop packaging is recorded separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`.
Owner data and phone runtimes are not changed by this milestone.
Older pawn opportunities, wider quiet/long
combinations, primary-theme accuracy, independent accuracy benchmarking and
load-sensitive native startup remain unresolved.
