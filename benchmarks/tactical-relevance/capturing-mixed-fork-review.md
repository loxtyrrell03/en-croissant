# Capturing forks and sacrificing counterchecks

Adapter **153 / live pipeline 160** recovers nonchecking capture forks whose
targets include a pawn. The prior mixed-target verifier rejected every capture
before examining its defences. Its named-target capture search also treated a
sacrificing countercheck as a refutation even when an ally could safely take
the checker. Neither a supplied PV nor an engine score now bypasses the proof.

## Owner-game judgement

The reviewed **Qxg2** attacks Rh1 and Pe4. Rf1 saves the rook but permits Qxe4+;
Qxe7+ instead offers the queen to Nxe7. The verifier now covers all 31 legal
replies, with a 200-cp local material bound including the initial pawn. This
does not claim a free rook or a 200-cp full-position evaluation. The preceding
Qxc7 had already won a pawn, so the first capture alone was reciprocal recovery;
the further fork-target gain is the additional point.

Fresh unrestricted/held depth-16 searches give +332/+372 cp for Black. All 31
selected answers remain winning in their separate engine searches. Some answers
are inferior to another winning continuation; the verifier establishes a safe
local resource, not the optimal full-position move in each branch.

The same 27-game, 1,319-context replay changes 35 full rows: six wording-only
and 29 with additional structural differences. Only one live principal list
changes, from empty to this Fork. Its preceding review gains a neutral opponent
tactic, **not** a claim that the played move caused it. Two source-solution
roots also gain forks, and actual-ply continuations gain mechanisms without
replacing their established live primary. These overlapping contexts are not
35 newly solved tactics or an accuracy percentage.

Nine distinct newly admitted reached forks were audited, including two quiet
entries restored by the counterchecker rule. Their 216 legal defensive branches
have fresh best/held-answer searches. The source-only Qxb2 fork's stronger live
Forcing Mate remains primary. One private course continuation adds a secondary
capturing fork beside its pin; that root preparation remains unproved. Of 246
private full results, three change (two wording-only); all their primary lists
and all twenty rare-theme full results remain unchanged, not certified accurate.

## Boundaries and contrary controls

- A capturing mixed fork must prove at least one further pawn beyond its entry
  capture. Taking a queen cannot finance an otherwise harmless rook/pawn fork.
- The normal targets, their moved identities and legal allied captures remain
  the basis of the search. Only an actual counterchecking piece can substitute;
  arbitrary loose pieces elsewhere cannot fund the claimed fork.
- Existing all-friendly-piece liabilities, legal recaptures, immediate mate/
  promotion refutations and countercheck-leaf checks remain. The shared 8,192
  operations, other proof budgets and worker deadlines are unchanged.
- A failed alternative-position proof does not establish a capturing fork as
  the cause of a mistake. Comparable captures/entry credit need a stronger
  causal comparison. Matching verified persistence is still reported.
- In constructed controls, Rh4 both saves the rook and guards e4; Bxg2 takes
  the forking queen. Neither gets a root fork. Without the second target there
  is no fork, even in a winning or mating position.
- An early constructed queen-countercheck fixture exposed Qc3+/Qg3+/Qe5+.
  It remains an explicit unproved-fork control, not a losing-move claim. The
  positive construction includes the blocking pawns that remove those checks.
- A fresh control PV contains a later real checking fork. The regression checks
  that the rejected **root** is not certified, not that every future motif is
  absent. Continuation evidence retains its own ply.

## Verification and receipts

There are 554 completed fresh engine searches: 64 initial owner root/branch
checks, 450 reached-owner checks (including deliberate repeats of the initial
case), 28 constructed decisions and twelve private course decisions. This is
not 554 independent positions. The public constructed receipt is
`capturing-mixed-fork-stockfish-18.json`; owner/paid positions stay outside Git.

The selected source run passes 2,781 tests with 328 conditional skips. Later
focused checks pass 82 source/React tests with five optional skips, including
fresh engine continuations, both colours, legal defence coverage, bounded-cache
isolation, root-only/full-line agreement, current-ply arrows and missed review.
All 28 generated-service checks pass with one optional engine skip; the new
test covers saved cards, deck export and reload. Its initial synthetic cloud
score had the wrong colour orientation; correcting that fixture, not production
scoring, fixes the test. Two dev-cache checks, types, scoped lint and both
review/frontend builds pass. Static rendering is not native interaction proof.

Private receipts under `Documents/OnCrescent Tactical Benchmarks/` use the
`capturing-mixed-fork-` or `capturing-mixed-fork153-` prefixes and `20260917`
suffix. `owner153-final`, `private153` and `rare153` are authoritative replay
results; `owner153-draft` predates the version bump but has the same decisions.
The initial root diagnostic preserves the failed Qxe7+ capture-only proof.

The production controller passes **2,155 inputs**: 808 existing public cases,
all 1,319 owner contexts, fourteen new reflected controls and fourteen retained
pawn/exchange/fork controls. All 808 public primary lists remain unchanged;
every owner result matches the final source replay. Public computation/transfer
median/p95/max is 43/206/1,106 ms; owner figures are 97/419/2,198 ms. Maximum
startup is 36/41 ms respectively. These Node-host measurements exclude engine
search, development HTTP startup and native UI, and are not a native latency
guarantee. No classifier deadline was increased.
Tested worker `liveTactics.worker-B9OEMdRu.js` is 598,595 bytes, SHA-256
`286ef62c69856c79ab9267c789e07c592edda693045aa5891a2199e5dd88d75f`.

The private `capturing-mixed-fork153-judgement-20260917.md` records the reviewed
roles of all nine reached owner mechanisms and the contrary controls. Source
`d8728295` is committed, pushed and packaged from a clean checkout. Clean types,
82 focused source/React checks, 28 service checks and review/frontend/native
builds pass. The native executable embeds the tested worker and the clean
tactical/review assets, confirmed against exact dependency paths.
`docs/TACTICAL_DESKTOP_DELIVERY.md` records identity and recovery. No app was
running or restarted; this is package linkage, not native interaction proof.

No owner data or phone service is changed. This is one recovered
mechanism, not completion of broader recall, quiet preparations, long tactical
and positional-compensation explanations, or the known queen-ending promotion.
Representative independently judged accuracy and native/load-sensitive startup
remain unverified.
