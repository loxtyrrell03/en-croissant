# Capturing mate threats and compensated material

## Adapter 88 / live pipeline 93

This milestone addresses two independently reviewed course positions, not a new accuracy score. Exact-input replay covers 201 tactical/positional exercises, 24 reached positions from generated engine games (openings, middlegames and endings), twenty real-game rare-theme cases and the existing 32 frozen mistake-priority judgements. Generated games are not human-game samples; the ordinary-game and Lichess fixtures remain separate. Paid inputs and annotations stay outside Git.

## Chess judgement and contrary evidence

- An apparent free bishop is not a verified material win: a same-square queen recapture creates a fresh mating threat. Avoiding mate concedes material. The original capture now loses its Hanging Piece headline and starting-board arrows; the opponent's Mating Attack remains at its actual ply in the supplied continuation. This does **not** classify the initial move as bad. Fresh Stockfish still prefers the move in a winning full position.
- An initially proposed Defensive Capture explanation was rejected. The original bishop did not threaten immediate mate: the king could capture it after its check. No replacement defensive or only-move badge is invented. The earlier adapter-87 audit's provisional defensive-capture wording is superseded by this correction.
- A second course capture now receives its previously missing Mating Attack headline: the knight removes the mating square's pawn guard while attacking the queen. Stopping mate loses the queen. It is not a fork of two pieces, and the source's accepting mating branch is not compulsory. This is a meaningful root attack, not an incidental captured-pawn badge or a future mate borrowed from the PV.

The first proof covers 41 legal replies using 768 of 8,192 visits, with 49 selected decisions. Its conservative local gain is 320 cp from the recapturer's perspective, leaving at most 10 cp of the original 330 cp bishop capture. One defence concedes a rook; another places a knight on the mating square's guard line and allows that guard to be captured. The second proof covers twenty replies, 22 decisions and 846 visits, with a 680 cp local material bound.

These bounds are not engine evaluations. In the first real case, the best practical defence remains about +394 cp for White despite conceding material; the alternative knight defence is about -495 cp. In the second, the fresh root estimate is +607 cp for White, while the local combination guarantees pawn plus queen minus knight. The defender's least material concession need not be their best full-position move.

## General proof changes

Non-checking captures can now create independently verified mating attacks. The existing mixed material-or-mate verifier counts the initial capture, every defending promotion's material increase and all friendly-piece liabilities at material leaves. It retains the shared 8,192-visit bound and at most three further checks. A pass position only nominates a new mate-in-one threat; every real defence must be answered independently. No supplied PV selects a defender, reply or material value.

Capturing a newly arrived guard is admitted only if it restores the exact nominated mate. An unrelated loose piece cannot fund the certificate. A promotion at a material leaf needs a concrete answer preserving the bound, not a blanket assumption that the promoted piece can be captured. Unknown, exhausted or unsupported continuations abstain. The pre-existing quiet/checking modes and deadlines are unchanged.

A separate same-square recapture search shares one budget across candidates. Only a positive mating-compensation certificate can remove the initial free-piece claim; failure to prove a capture is not evidence that it is compensated. Missed-opportunity review uses the same root rules. Unproved before/better causal comparisons remain neutral.

## Verification and limitations

Ninety-three fresh depth-16 Stockfish searches comprise all 71 selected real proof decisions, both roots and important defences, plus constructed positive/negative controls. Direct mate leaves agree with the engine. A checking-promotion counterexample is mate against the supposed attacker; a surviving guard and unrelated loose rook also defeat the nominated attack. All four promotion choices and their actual recaptures were checked. A material branch which the engine later mates in seven is not misreported as a short forced mate.

Fourteen public source regressions cover root-only/full-line agreement, compensation, missed themes, actual-ply geometry, surviving/removable guards, promotion counterplay/recaptures, unrelated material, colour reflection and invalid/exhausted budgets. Two opt-in private regressions reproduce the reviewed roots. A rendered scan-panel regression verifies the absent false headline, collapsed opponent explanation, actor and empty starting-board preview.

Final exact replay changes only these two course results; the other 199 full course results, all 24 generated-game results, twenty rare results and 32 priorities remain unchanged. This is regression stability, not evidence that the unchanged results are correct. Existing interference and exact KPK zugzwang coverage is preserved, not expanded here. Positional pin-versus-forcing distinctions, longer quiet combinations, broader causal explanations and drawing/larger-ending zugzwangs remain open.

The final source/review selection passes 1,489 tests across 104 passing files, with 91 conditional skips in 106 selected files. Shared-review (40 modules), app (8,870 modules), six-file lint, whole-project type checking, three built-service tests and two dev-cache scenarios pass. A first constructed promotion control was illegal because its pawn already checked the other king; it was corrected to a legal checking-promotion counterexample. Two simpler positive promotion reductions exposed extra defences and were not used as supposed positive examples.

The six-case isolated HTTP run passes under unchanged deadlines: first/next startup 1,373/69 ms; KPK startup 1,969 ms and computation/transfer 484 ms. These are isolated development-server results, not stable latency or native WebView proof. No owner app, native package or service was restarted or deployed.

All 631 actual-controller production-worker inputs pass thirteen tests against `liveTactics.worker-DVmp79X6.js`. The [168-input public receipt](built-worker-adapter88.json) records median/p95/max 78/216/600 ms, startup max 32 ms and computation/transfer max 572 ms, excluding engine/UI and the additional private/rare inputs. All 162 prior public primary-ID lists are unchanged. The initial run processed the enlarged public set but failed its stale 162-case assertion; after updating the explicit expected count to 168, the complete suite passed. Eighteen final private proof/replay checks also pass.

Private receipts in `Documents/OnCrescent Tactical Benchmarks`: `capture-mate-adapter88-engine.json` (59 searches), `capture-double-threat-adapter88-engine.json` (26), `capture-mate-adapter88-controls-engine.json` (8), both `*-adapter88-shipped-proof.json` files, `adapter88-exact-replay-final.json`, `rare-theme-adapter88-final.json` and `adapter88-final-cold-http-worker.json`. Final proof objects exactly match the engine-audited decision sets. Contrary earlier exploratory reports are retained.
