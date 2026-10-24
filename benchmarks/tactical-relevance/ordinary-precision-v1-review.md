# Ordinary public-game precision audit

This finite audit found **no confirmed new false tactical primary** in the selected positions. That is not a precision percentage: empty output is neither a proved positional position nor a correct negative, and this sample cannot measure tactical recall.

## Selection and provenance

The first tranche fixed reached plies 15, 33 and 45 in four already retained public Lichess games: QZDg7vtX, Z1Tw5YR3, C9q6jvtW and Gectvn7R. The first two come from the cohort-v2 file; the latter two are the lexicographically first two games in the retained quiet-context file. No classifier, engine, move-quality, result, rating, capture/check or tactical-label filter selected these roots. Exact histories from the original starting position and up to 12 actual played continuation plies are retained. The old owner Chess.com ordinary-game fixture was excluded.

These first 12 roots all happen to have Black to move. After recording their initial output, a separately declared adjacent White-to-move tranche added plies 16, 34 and 46 in those same games without dropping or replacing any first-tranche position. The 24 boards are therefore dependent neighboring contexts in reused puzzle-source games, **not 24 independent games**, a fresh holdout or a representative sample. Recorded prior public benchmarks had no matching game/ply IDs before selection.

Each board also receives up to two distinct legal noncapturing, nonchecking moves chosen by a fixed SHA256 ordering before that tranche's classifier output. These deliberately ordinary-looking alternatives are not engine recommendations or presumed good moves. The forced Kh8 root has no alternative, so the final total is 94 variants: 24 played roots, 24 played continuations and 46 quiet alternatives. Actual played lines are not assumed optimal or forced.

## Adjudicated observations

The pinned adapter 174 baseline produces only two distinct root claims:

- **QZDg7vtX:ply46, Qf8+:** an independently complete mate-in-two proof. The only legal defence is Qxf8, then Rxf8 is checkmate. One move earlier, Black's forced Kh8 is not promoted to a tactical primary; White's mate remains on timeline ply 2 and the final mate on ply 4. At the reached White root, Qf8+ correctly owns the primary.
- **Z1Tw5YR3:ply16, Nxc7:** a local pawn gain. The only legal recapture Qxc7 loses the queen to Bxc7. Independent legal exchange checks give the recapturing side a net loss of 580 centipawns, no profitable immediate countercapture elsewhere, and legal material answers to both counterchecks Nc2+ and Nd3+. This is a finite local claim, not an exact full-game value. Replacing the earlier legal Bf4 development with legal Bg5 produces a fully replayable opposite history: Qxc7 now wins the knight, so Nxc7 loses 220 centipawns. The classifier correctly refuses the pawn-gain label in this control.

The later Back Rank Mate geometry is kept at its actual ending ply, not called the quiet earlier move's cause. Both colour reflections preserve the adjudicated ownership and material contrasts. The remaining quiet alternatives and empty outputs are retained as observations only; no positional gold labels were manufactured.

## Verification boundaries

`ordinary-precision-v1-adapter174.json` is the complete immutable 94-observation baseline from exact commit `b75c13e2f3a63d69cf60bd9e0b4221f884a9e190`, excluding the user's pending checking-ray changes. The read-only loader used 12 committed tactical modules; all 9 source hashes reported by the harness matched the actual loaded bytes and were unchanged at the beginning and end. Tests: 24 legal-context observation tests plus 8 adjudicated source regressions, 32/32. Independent `ordinary-precision-v1-verify.py` replays all 24 exact histories and the two-colour legal witnesses; its input hashes and results are retained in `ordinary-precision-v1-independent.json`.

Whole-project and scoped benchmark types pass; scoped lint reports zero errors/warnings. The permanent Vitest config can pin an exact commit, the full index (`index`) or the staged core with working dependencies (`index-core`) via `ORDINARY_PRECISION_REF`, optionally writing create-only `ORDINARY_PRECISION_V1_REPORT` and `ORDINARY_PRECISION_LOADER_REPORT` files. Pinned modules are checked again after execution; working-source reports likewise require unchanged starting/ending watched hashes.

Final **adapter 175 / pipeline 182 all-index replay passes 32/32**, with all 94 observation results unchanged after excluding only the version field. The exact core blob is `cdec0ea486dde67507c39da91f5fe9df2e14a5c9` (LF SHA256 `2ad68ccb6b8d381d0ec26bfa1fdb391e61bf9e7d7011b16741bfff52bf9bae50`), excluding all pending checking-ray hunks. All 12 loaded index modules were rechecked after execution, and the 9 watched starting/ending hashes agree. Exact counts, hashes and comparison scope are in `ordinary-precision-v1-verification.json`.

The audit contributes only benchmark evidence and focused regression tests. It does not change production detectors, scan owner stores, download data, run an engine/provider, modify the separate website or establish installed desktop/phone behavior.
