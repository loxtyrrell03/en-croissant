# Adapter 171: history-sensitive proof and saved-theme provenance

This is an En Croissant source milestone, not work on the separate Chess Mistake Trainer website. It does not replace an installed desktop build, deploy the phone service or rescan owner data.

## A board alone does not determine a forced win

A reused public mating position admits two constructed legal histories that reach the **same full FEN**, including both clocks. After the proposed Rg7+, only one history gives the defender a repetition claim. Adapter 170 reported a high-confidence mate in both cases. The new admission boundary rejects that winning claim when exact legal history positively establishes the defender's current or announced threefold claim. The non-repeating control keeps the mate. Fivefold repetition already reached in the supplied history prevents any subsequent tactical lesson.

The replay is separate from the complete-material capture-debt validator. Reduced-material analysis origins can prove repeated occurrences without pretending to reconstruct old exchanges. Position identity includes side to move, castling rights and legally available en passant; clocks bind the reached analysis root but do not distinguish repeated positions. The attacker's optional claim does not refute a winning move they can choose instead. An immediate checkmate is not suppressed by a later possible claim. These distinctions follow [FIDE Articles 9.2 and 9.6](https://handbook.fide.com/chapter/E012023).

This is deliberately a **root boundary**, not history propagation through every internal tactical search node. Missing or mismatched history provides no positive repetition fact; it is not certified absence of earlier repetition. A repetition in a supplied continuation cannot invalidate a separately proved alternative route. Drawing resources and explicitly non-forcing observations are not automatically discarded as though they claimed a win.

## Obsolete themes must not survive a pending refresh

Historical adapter 164 evidence can still be present on saved cards even when the current classifier rejects it. Two fixed cases cover an obsolete discovered-attack accusation and a fork that both the best and played moves create. Previously the raw readers could continue showing the old accusation in titles, motif counts, practice selection and continuation details while migration was delayed or paused.

All those readers now consume one current, structurally valid motif record. Old, missing, future or malformed provenance abstains until the existing asynchronous migration completes. Both root arrays are required; continuation arrays remain optional for valid root-only records. Reading counts or practice eligibility does not launch tactical searches. Refresh preserves notes, scheduling, logs and raw chess evidence. An empty tactical classification remains unknown, not automatically positional. The identical 17 [reader contracts](motif-reader-provenance-review.md) improve from 4 passing to all 17 passing.

## Endgame proof research stays outside runtime

The [history-bound composition experiment](endgame-composition-history-review.md) applies stronger, branch-by-branch history validation to the existing DVs4F endgame certificate. It distinguishes an optional attacker claim from a defensive claim and withholds inherited history-blind winning leaves. This adds adversarial benchmark coverage, not production zugzwang coverage. The eight-piece runtime position remains unsupported, and trusted provider acquisition remains separate from certificate identity checking.

## Verification and limits

The [versioned verification receipt](history-provenance-verification.json) records 3,456 true passes, one separately recorded expected coverage failure, 364 conditional skips and zero unexpected failures in the broad public selection. All 32 frozen primary-theme results are byte-identical to adapter 170. The exact-core run, excluding the unrelated checking-ray patch, passes 626 checks with four optional skips. All 62 new source contracts pass; generated-service tests pass 67 with one optional engine skip, including four new history-sensitive export/reload cases. Scoped lint and frontend/review-worker builds pass. A subsequent test-style-only cleanup reran all 36 repetition contracts successfully.

Whole-project types passed before concurrent unrelated edits. The final rerun reports TS2352 in the newly added, untracked `src/shared/truePerformance.worker.test.ts:13`. That file is preserved and excluded from this commit. A diagnostic rerun using the normal root configuration and repository type roots, excluding only that unrelated test, passes; no production or tactical-test file is excluded. The successful build predates that concurrent test change, so it is not a claim that every later working-tree edit builds.

The [repetition receipt](repetition-boundaries-adapter171.json) retains the paired false-mate counterexample and precise root-only suppression policy. The separate history-aware endgame experiment passes 25 contracts, with the original 52 composition checks still passing. These are regression contracts on reused public or constructed fixtures, not an independent holdout or an accuracy rate across arbitrary positions.

The existing queen-ending promotion gap, deeper history-sensitive search paths and unresolved quiet-preparation causality remain open. Unrelated work in this shared checkout, including the pending checking-ray patch, is preserved. No generated bundle, owner database or downloaded corpus belongs to this commit.
