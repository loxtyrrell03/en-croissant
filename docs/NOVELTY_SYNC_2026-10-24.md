# Novelty to En Croissant synchronization

Audit window: 24 July–24 October 2026. Review includes current working sources
and all local branch histories, because several finished Novelty improvements
were committed on feature/release branches rather than primary. Initial history
inventory: 573 Novelty and 373 En Croissant commits touching source, native
source or scripts. These counts include research, repeated integrations and
release work; they are not counts of missing features.

## Delivery contract

En Croissant desktop and the PC-hosted phone companion are separate delivery
targets. Preserve native Mantine/Chessground interfaces and the phone's existing
navigation, service ownership and canonical HTTPS origin. Port behavior through
each target's architecture. Do not promote rejected/unvalidated research models,
Novelty licensing, payments, proprietary distribution or marketing into En
Croissant. Existing independent En Croissant features must survive integration.

Initial source snapshots and patches are retained locally under
`tmp/novelty-sync-20261024`. They include unfinished shared Stats and tournament
work and unrelated tactical changes; snapshotting does not authorize erasing or
committing unrelated work.

## Verified milestones

| Improvement | Desktop | Phone | Verification / delivery |
| --- | --- | --- | --- |
| Strict online PGN dates, Novelty `33978469` | Incremental database cursor rejects impossible calendar dates; unknown time retains the valid UTC day | Online PGN imports use the same validator for ordering and filtering | 28 focused tests, whole-project TypeScript, scoped lint. Source committed; binary/runtime delivery pending |

The date fix preserves completion-header precedence, valid leap days and ISO
offsets. It does not rewrite existing databases. Provider-native epoch timestamps
remain authoritative where already available.

## Integration inventory in progress

| Area | Initial finding | Next verification |
| --- | --- | --- |
| Performance estimator, workers and custom periods | 23 current shared production/model files are already byte-identical; primary source is uncommitted and hosted delivery is older | Reconcile prerequisites, test desktop/phone adapters, then deliver |
| Tournament evidence, manual results and source integrity | Existing primary source includes substantial later guards absent from the September deployed native service | Reconcile source dependencies and test native/frontend contract before delivery |
| October phone opponent Prep handoff | Live app identifies `44f46c86`; newer than primary's phone integration | Retain its ancestry and handoff behavior in the publishing snapshot |
| Board drawings and file preferences | Novelty has new saved-mark isolation, multi-arrow and per-file preferences | Compare with native/phone Chessground and storage behavior |
| Analysis and Engine Plans | Novelty has October analysis budgets/accuracy changes and new continuation coverage | Compare algorithms and controls through each target's native interfaces |
| Prep/database controls and filtering | Novelty has source refresh, archives, date ranges and responsive fixes | Audit equivalent native/phone paths before choosing required ports |
| Scheduler, review, dialogs and Files | Novelty's October audit fixed several race/failure paths | Reproduce equivalent defects in En Croissant; do not replace different implementations wholesale |

This is an active audit ledger, not a claim of complete feature or deployment
parity. Installed desktop, served phone and physical-device evidence must be
recorded separately as work progresses.
