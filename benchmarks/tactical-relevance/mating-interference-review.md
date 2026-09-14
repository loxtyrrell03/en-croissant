# Mating interference, primary relevance and contrary defences

Adapter 103 / live pipeline 108. This is a scoped source/build milestone, not a
complete accuracy claim or an installed-app release.

## Changes and chess judgement

The quiet mating-attack proof previously required a whole-piece concession.
A new mating threat can genuinely force a pawn or exchange instead. This path
now admits a minimum pawn gain, but must exceed any immediately available capture
in the original position. Checking/capturing proof thresholds and all work budgets
are unchanged. This is not permission to classify ordinary pressure as a tactic:
the threat must be a new legal mate, and every legal reply must independently
concede material or allow a bounded mate. Counterchecks and friendly liabilities
remain part of the proof; a winning engine evaluation is not a certificate.

When a move cuts an enemy slider's defence against that mate, it can now explain
**Mating Interference**. A counterfactual board without the blocker establishes the
cut route; the same defence must also have been legal against the premature
threat in the original position. Both captures and interpositions qualify. A
piece merely supporting mate, a pre-existing blocked route, or an unproved
countercheck cannot fund this label. The geometry probe is not a game variation.

An all-defence explanation supersedes a conditional Quiet Preparation of the
**same mating threat**, even when the conditional route advertises a larger gain.
This is evidence-based selection, not a global preference for the interference
theme name. A separately proved forced mate still outranks a smaller material
concession. Secondary motifs remain at their actual moves.

Two course results change:

- One pawn move now explains the cut queen-defence line, replacing conditional
  Quiet Preparation in the live result and recovering the previously empty
  source-only root. Its local worst-branch bound is 230, not the old conditional
  400 and not Stockfish's full-position evaluation. All 32 defences are covered.
  Board arrows show the pawn, cut defensive route and mating threat; they no
  longer borrow the future rook capture.
- A separate position keeps Deflection primary and adds Mating Attack only at
  ply 5. Stopping that new mate concedes a pawn in all ten legal branches. Nothing
  else in this result changes. Missed root interference is separately tested.

The other 244 private positions retain both complete source/live results. All
twenty rare results and 32 frozen priority judgements are unchanged. Unchanged
is not synonymous with accurate; empty results are not counted as correct negatives.

## Independent checks and corrected assumptions

The [public engine receipt](mating-interference-stockfish-18.json) contains 124
allowlisted searches. Together with 89 private searches, the final audit makes
213 fresh depth-16 searches: best/fixed roots, every immediate defence and every
recorded attacker decision for the positive mechanisms. Six constructed controls
are reflected through colour; these are twelve inputs, not twelve real games.
The two course positions supply real additional mechanisms. Existing broad
opening, positional, tactical and ending corpora are replayed, not newly sampled.

| Case | Chess interpretation |
| --- | --- |
| Rook interposition cut | e7 cuts Rb7-h7, creating Qh4 mate. Before e7, Rh7 legally interposes; Qg7 is instead met by Rxg7. The bounded material certificate covers all 25 replies. The longer fresh engine line independently proves mate in three and correctly leads with Mating Preparation. Root-only nomination does not establish that stronger distance. |
| Queen countercheck | Adding a queen and shielding pawn looks similar geometrically, but Qxc6+ supplies a genuine drawing resource. Fixed e7 evaluates 0 cp in both colours; it receives no new interference certificate. |
| Missing supporting rook | The mate is no longer established. Fixed e7 is near equal in these depth-16 searches (3/5 cp), not proof of an exact draw. |
| Already blocked rook | Mate in one was available before e7. e7 retains a verified mate in two; the existing Mate Threat can remain, but the move must not receive credit for creating interference. |
| Added diagonal bishop | My initial concern was another defensive route. Inspection and Stockfish instead reveal that this bishop also blocks its own rook on the eighth rank, permitting the pre-existing Qg8 mate. This is not a correct quiet negative; the new interference proof appropriately abstains. |
| Exposed king | Rb1+ / Rb8+ requires a checking exchange beyond this local proof. Fixed e7/e2 remains winning (+531/+551 cp), so the abstention is a coverage gap, not a refutation. |

An eight-input retained adapter-102 build reproduces the old generic headline,
conditional course primary and absent ply-5 attack without replacing working
files. This separates actual behavior changes from fixture expectations.

## Rejected queen-trap extension

Public Lichess snAK4 still lacks a root explanation. Qd5 threatens Qxg2 mate and
supports a later Ra2 queen trap. A prototype passed 269 fresh root/selected-choice
engine searches, but a stricter audit exposed an insufficient local certificate:
after Rf3, Ra2 c4 Rxb2 cxd5, assuming Bxd5 leaves Rb2 to Bxb2. A real alternative
Rxb1 exists, but retaining its gain through the subsequent liabilities needs
more connected proof. The stronger prototype exhausted the existing budget.
All trap-preparation, extra-countercheck and mating-liability prototype changes
were withdrawn. The final production patch does not contain them. The concrete
countercapture is a regression, and this missing root remains open rather than
being recorded as a recovered tactic. Earlier private exploratory reports are
not final certificates. ZVq1J and 4Ds65 root gaps also remain open.

## Verification and delivery limits

- 2,012 selected source/review/render tests pass; 84 conditional skips remain.
  Exact private replay is included. Eleven scoped files lint cleanly; TypeScript,
  shared-review/app builds, three service tests and two cache-recovery scenarios pass.
- 1,271 actual-controller production-worker inputs: 763 in the public timing
  receipt, twenty additional public rare inputs, 485 existing private inputs,
  two new private original-position checks and one public promotion regression.
  All 727 prior public headline lists remain unchanged. The new worker report
  includes fresh full engine lines as well as short constructed inputs.
- Public worker median/p95/max: 71/260/1,564 ms; maximum computation/transfer
  1,496 ms. These exclude engine/network/native UI and are not speedup claims.
  Artifact: `dist/assets/liveTactics.worker-D6aN2-Og.js`.
  The final rebuild reproduces the same artifact hash. Three groups were
  interrupted while that rebuild temporarily removed the worker file; those
  groups were rerun after the build. This was test sequencing, not a classifier
  exception, and the interrupted run is not counted as passing.
- 60 actual-Chrome groups verify the result component, keyboard details/preview
  callback and exact arrow endpoints at 1100/760/360px and 100/200% text.
  Root and expanded screenshots were inspected. This is not an owner app or
  physical-board test, nor a redesign of the existing long-form explanation UI.
- 63 isolated cold-HTTP cases pass. First/next worker startup: 6,326/7,050 ms;
  separate server startup: 7,218 ms; maximum computation/transfer: 1,314 ms.
  Startup remains variable; no timeout-fix or native reliability claim is made.

No owner app/package/service restart or deployment. Paid course material stays
private. Broader causal/quiet/endgame coverage, proof-budget gaps, longer-line
nomination consistency and native verification remain unfinished.

## Reproduction and private evidence

Public scripts: `scripts/benchmarks/mating-interference-{baseline,stability,receipts}.mjs`.
Run `matingInterference.test.ts` with `TACTICAL_INTERFERENCE_AUDIT_INPUT` pointing
to the exact private replay and `TACTICAL_INTERFERENCE_AUDIT_REPORT` to a fresh
private output; the report supplies the deterministic fresh-engine probes.
`tacticalBuiltWorker.test.ts` uses the actual application controller. Browser QA:
`node scripts/qa-tactical-payoffs.mjs --interference`.

Authoritative private files under `Documents/OnCrescent Tactical Benchmarks/`:
`adapter103-interference-engine.json`, `adapter103-final-exact-proof.json`,
`adapter103-retained-baseline.json`, `adapter103-final-exact-replay.json`,
`rare-theme-adapter103-final.json`, `adapter103-final-stability.json`,
`built-worker-adapter103-expanded-private.json`, and
`adapter103-final-cold-http-worker.json`. Final proof decisions match the audited
engine inputs exactly. [Public worker receipt](built-worker-adapter103.json).
