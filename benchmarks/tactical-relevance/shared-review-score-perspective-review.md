# Shared review score perspective

Scope: En Croissant source and synthetic service tests. No owner-data rescan, installed desktop replacement or phone deployment.

## Root cause and correction

The phone card constructor receives White-relative evaluations and correctly converts them into the player's winning chances for display. The shared exporter inverted those percentages back into **player-relative** centipawns, then saved them in fields that desktop classification reads as **White-relative**. White cards were unaffected; Black's signs were wrong.

The fixed exporter converts both saved evaluations into White's perspective and writes explicit `cpPerspective: "white"` provenance. `cpLoss` remains the player's loss, with its existing sign and convention. This changes transport, not the classifier's evidence or engine scores.

The paired legal attraction fixture exposes both directions: a positive Black conditional idea was lost after export, while a losing idea was incorrectly restored. The same four observable constructor → export → fresh classification → migration contracts improve from **2/4 to 4/4**. Controlled scores exercise relevance gates; they do not certify the chess quality of the selected moves. Conditional ideas remain unknown as mistake causes. A separately proved fork-preparation control remains tactical for both colours.

## Existing saved cards

The service previously spread an old saved position over the new export, preserving the old score fields indefinitely. A narrow reconciliation now uses the authoritative phone card, never a general assumption about Black or a missing marker.

Repair requires exact review key, FEN, colour and played/best move identity. It accepts only the old export's exact score signature: Black's two saved scores must be the opposites of the current authoritative export, with unchanged `cpLoss` and absent/original depth 16. An already-correct tuple only receives provenance. Any changed tuple clears its four dependent motif/timeline arrays and invalidates the stored motif and nature versions so consumers recompute against the repaired evidence. Immediate raw getters, theme counts and practice routing cannot reuse the stale badges while migration is pending; the raw lines and unrelated metadata are retained.

Marked records, changed evaluations, newer depths, missing identity and collisions are left alone. SRS progress, notes, shapes, review trees and logs retain their existing merge rules. Old clients cannot reintroduce the bad score fields through a progress save.

The legacy boundary is explicit: an unmarked standalone export without its authoritative card cannot safely be distinguished from a valid desktop-created or reanalysed record. It is **not** bulk-flipped. Even the narrow tuple match identifies the known export signature, not historical proof of authorship. A future reader could abstain from score-dependent observations for independently identified ambiguous shared imports while still using legal board proofs, but suppressing all unmarked evaluations would damage valid desktop records. This change does not add that broad policy.

## Verification

- Four frozen observable transport contracts: two Black failures before, none after; White unchanged.
- Fourteen new source contracts plus two existing history/pawn regressions pass, covering schema/JSON survival, refresh consequences, genuine tactical controls and conservative legacy handling.
- Eight generated-service tests pass: both colours and score signs, legacy repair, save/reload, retained user progress, identity collisions and protected desktop reanalysis.
- Ten predeclared consumer contrasts, plus a separate legal optional-mate refutation check, are retained in `src/utils/tests/consumerThemeRelevance.test.ts` and pass: answerable and unsafe mating threats, conditional attraction versus proved preparation, a later-only fork, an optional mate refuted by a legal capture, a genuine root mate, a zero-valued exact drawing resource, and complete versus missing quiet evidence. Nature counts and practice filters agree. These checks did not justify weakening the current tactical/positional/unknown boundaries.
- Whole-project types and scoped lint pass. Exact test, source, result and generated-module hashes are recorded in `shared-review-score-perspective-receipt.json`. Final milestone-wide core/build checks are separate.

No private corpus or owner store was read or written. Test service instances used tiny temporary synthetic stores and removed them afterward. The production service and native application were not started, stopped or changed.
