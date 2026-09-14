# Direct-threat relevance — adapter 99 / live 104

## What changed

A generic **Threatening a Piece** proposal previously kept the numerical gain from the supplied variation even after a separate local proof admitted it. That could exaggerate its value and duplicate a better explanation. The badge now uses a complete, liability-aware proof of its own named targets. Immediate exposed-piece losses count; an initial capture or promotion cannot fund a supposedly additional threat whose bound is no larger. Claimable fifty-move draws and terminal/uncertain proofs do not qualify.

When the same-ply targets are already contained in an independently verified material discovery or trapped-piece certificate with at least that gain, the generic badge is omitted. A different victim, larger independent direct gain, later ply or mate-only certificate does not satisfy this rule. Existing separate mechanisms remain in the continuation. This does not make all geometric attacks tactical, and does not expand causal claims from missing evidence.

The real counterfactual **e7+** from game `QwS7iWSm` uncovers Qb3 against Kg8 while threatening Rd8. The correct primary lesson is **Discovered Check**, with a local gain of **400** (rook minus promoting pawn after exchanges), not an additional generic threat valued at **600** from a later PV. The board retains the checking ray and pawn's present target. The actual underpromotion/capture on ply 3 remains later; it is not a claim that rook promotion is necessary.

The [retained adapter-98 replay](direct-threat-adapter98-baseline.json) reproduces the duplicate without replacing any working-tree files. The [updated exact-input replay](direct-threat-adapter99-results.json) removes it; all sixty accompanying source/live search inputs are otherwise unchanged. These are development comparisons, not sixty independently correct judgements.

Constructed controls include a genuinely trapped knight, all six legal replies and captures, a queen capture whose later knight capture concedes a rook, missing discovered-check/victim geometry, colour reflection and a claimable draw. In the queen-capture control, 900 already captured cannot justify another threat with only a 720 net local gain after 500 is lost and 320 recovered. Ten fresh [Stockfish control searches](direct-threat-control-stockfish-18.json) support the legal selected moves. Their full-position scores are not the local bounds.

## Broader positions and the rejected checking-capture experiment

The [candidate set](checking-pawn-development.json) enumerates 34 legal direct checking pawn captures across 155 frozen public opening, positional, tactical and ending boards, then selects the first thirty by a fixed salted hash. [Initial chess judgements](checking-pawn-initial-judgement.json) preceded these new outputs. These reuse known Lichess-derived material and are not a holdout or a representative distribution of chess positions.

The [105-search receipt](checking-pawn-stockfish-18.json) contains thirty fixed captures, thirty unrestricted root choices, fourteen move-order/king-defence searches, and 31 distinct selected retention actions. Every exported PV is checked for legality, position identity and requested root move. Together with the ten constructed searches, this milestone adds **115 fresh depth-16 Stockfish 18 searches**. Scores are side-to-move centipawn estimates, not proof bounds or an accuracy percentage.

My review of the thirty captures:

- Five lead to forcing mates: Rxh5+, Qxf6+, Rxg2#, Qxf7+ and the Legal-style Bxf7+. Mate remains the primary live lesson. Actual deflection details belong where they occur, not to every capture of a pawn.
- Twenty-one fixed captures have negative finite engine scores. They include opening queen donations, unsupported bishop/knight sacrifices and exchanges in quieter endings. No checking-pawn badge is added.
- Qxh4+ still has a positive score because Black was overwhelmingly ahead. A legal Kxh4 refutes its interpretation as an elementary pawn win. A positive whole-position evaluation cannot validate an individual sacrifice's local explanation.
- Qxg2+ in an already won opening attacks king and rook geometrically, but Nf2 blocks the check while defending Rh1. That is not a forced rook-winning fork.
- The two important unresolved roots are the king attack **...Rxg2+** and the tempo capture **...Rxf2+**. Empty scans here are coverage misses, not successful negatives.

For ...Rxf2+, White's earlier g3 matters: vacating g2 turns the capture into check and delays the e7+ resource. All three king replies require safe continuations. **...Qe7 after Kg1 fails to Kxf2**; **...Rb2** instead attacks Qb3 so e7+ can be answered by Rxb3. Kh1 and Kh3 admit Qe7. Playing Qe7 before the rook capture permits exf7+. This supports the tactical move order, but does not yet supply a generally sound classifier certificate.

The experimental retention search appeared to prove that capture, but an independently audited **...Rxg2+ Kf1 Qg5** branch was losing: **Qxg5 fxg5** changes the position in ways the local pawn ledger missed. Stockfish scores that selected continuation **−384 cp for Black**, despite the winning root's **+330 cp**. Other selected Qg8 witnesses also give away the advantage. Even covering every initial king reply is insufficient if later neutral exchanges are ignored.

The [rejected draft patch](rejected-checking-pawn-draft.patch) and exact selected witnesses are retained for diagnosis. **It is not imported, enabled or shipped in the classifier.** It must not be restored merely because its root result matches one desired example. The draft used a bounded local search, not an exhaustive positional proof; allowing quiet retention moves needs substantially stronger treatment of exchanges and counterplay.

## Regression coverage and limits

All 246 exact private course/generated-game primary lists and live results remain unchanged. One source continuation removes a same-target generic threat beside **Trapped Queen** at ply 3; its queen-trap primary and 570 local bound remain. This is noise reduction, not recovery of its unproved initiating move. Paid FENs, games and PVs remain private.

The twenty existing rare-theme results, 23 earlier cross-phase results, 23 broader game contexts with their actual after-move boards, and 32 frozen primary-priority judgements remain unchanged. Coverage includes interference, self-interference, deflection, quiet preparations, traps, opening exchanges and exact drawing/winning KPK cases. Stability does not certify those outputs or settle larger-ending zugzwang and quiet-position coverage.

Verification includes the new root/truncation/reflection/proposal-value/target/capture/draw controls, a supplied-evidence missed-discovery review test, and the actual rendered result component. The review test supplies an artificial loss to exercise the adapter's missed-evidence path; it is not a fresh engine judgement of that alternative or a complete opponent-refutation audit.

Final verification:

- **1,830 selected source/review/render tests** pass across 122 files (121 passing, one conditionally skipped; 84 conditional test skips). The new sixty-classification audit initially exceeded the default five-second test-batch limit under parallel suite load; it now has a thirty-second batch limit. Production deadlines are unchanged.
- Shared-review (40 modules) and app (8,870 modules) builds, whole-project TypeScript, sixteen-file lint, three built-service tests and two dev-cache/recovery scenarios pass. Final artifact: `liveTactics.worker-9XnoCM4c.js`. Existing large-chunk/plugin timing warnings remain.
- **1,033 actual-controller production-worker inputs** pass across fifteen tests: 527 public, 505 retained private and one separate fresh-promotion regression. The [final public receipt](built-worker-adapter99.json) has median/p95/max **81/399/1,054 ms**, excluding engine search and native UI; maximum startup/classification-transfer is 186/909 ms. All 462 earlier public headline lists are unchanged. The [initial run](built-worker-adapter99-initial.json), before the final draw/promotion guards, measured 75/219/907 ms. These host-dependent observations are not a speedup or native-latency guarantee.
- **27 isolated cold HTTP cases** pass with unchanged twenty-second startup and three-second classification deadlines. The new discovery case uses 1,741 ms startup and 65 ms classification/transfer; the largest case startup is 2,038 ms and classification/transfer reaches 1,348 ms. Server setup/prebuild is separately 13,627 ms. An earlier run in this milestone had 9,738 ms worker startup. Cold-start variability is not certified fixed.

Authoritative private receipts are `adapter99-release2-exact-replay.json`, `rare-theme-adapter99-release2.json`, `cross-phase-adapter99-release2.json`, `adapter99-broader-release2-results.json`, `adapter99-built-worker-final.json` and `adapter99-dev-worker-release.json`. Earlier draft/release receipts remain available and are not substituted for the final run. Public candidates, initial judgements, legal engine receipts, retained baseline, rejected draft and selected-worker results are linked above; private-course contents are not exported.

No owner app/package/service was restarted, installed or deployed. Native WebView latency and physical UI behaviour remain unverified. The overall accuracy goal remains open.
