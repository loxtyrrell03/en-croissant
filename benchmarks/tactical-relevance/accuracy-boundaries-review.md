# Adapter 170: score parity and stricter evidence boundaries

This milestone is in the **En Croissant fork**, not the separate Chess Mistake Trainer website. It changes source and repeatable tests; it does not deploy the phone service, replace an installed desktop package or rescan owner data.

## Shipped correction

Black phone cards previously exported player-relative evaluations into White-relative desktop fields. Refreshing the card could remove a valid conditional idea or introduce an irrelevant one. New exports preserve the correct perspective, and an exact-identity/original-score-signature repair handles recognised legacy records without guessing at unrelated desktop analysis. The same four observable transport contracts improve from 2/4 to 4/4. See [the score-parity review](shared-review-score-perspective-review.md) for persistence, provenance and ambiguous-legacy limits.

## New evidence, without inflated accuracy claims

- [Fixed game contexts](rare-game-context-review.md): 18 opening, middlegame and endgame positions from four public puzzle-source games, plus six recorded unavailable plies. All histories and 36 bounded engine queries are retained. Twenty-one permanent checks cover ordinary development, exchange recovery, an existing trapped-bishop danger, a parryable mate threat and a single-target pawn attack in both colours. Unresolved positions are not labelled as correct negatives just because the classifier is empty.
- Consumer contrasts distinguish conditional observations, proved tactics, later-only ideas and insufficient evidence. A neutral attraction or answerable mating threat must not become a confident tactical mistake cause.
- The proposed GrHPv quiet-rook detector was **not admitted** merely because all replies had a bounded material continuation. Some selected continuations borrowed queen activity without the initiating rook; requiring participation exposed an unresolved branch. A later interference/skewer mechanism must not be moved to the earlier quiet move to fill this gap.
- A separate benchmark-only pawn-ending composition prototype tests finite winning trees and closed nonlosing strategies using retained exact small-ending leaves. It does not raise the runtime tablebase limit or make the eight-piece DVs4F root supported. Preparation cost, provider trust and repetition-history binding remain explicit integration constraints.

The [versioned verification receipt](accuracy-boundaries-verification.json) records 3,383 true passes in the broad public selection, one separately recorded expected coverage failure, 364 conditional skips and no unexpected failures. The 32 frozen primary-theme results are byte-identical to adapter 169. A separate 23-file run against the exact committed tactical core, excluding pending unrelated logic, passes 564 checks with four optional skips; it includes all 46 new source contracts. Generated review-service checks pass 63 with one opt-in engine skip. The frontend/review-worker build, whole-project types and scoped lint pass.

The [quiet-entry adjudication](checking-entry-preparation-adjudication.json) retains 32 conservative/geometry contracts. The [endgame composition review](endgame-composition-review.md) retains 52 adversarial prototype checks; the prior nine independent zugzwang checks also pass. These are separate reused proof contracts, not new independently sampled puzzle successes.

Passing regression counts are not a measured accuracy rate across arbitrary chess positions. The known queen-ending promotion gap and rare causal recall gaps remain visible. The working-tree build includes preserved unrelated checkout edits; no generated build output is committed or deployed.
