# Development storage incident — 21 September 2026

The system drive reached approximately 29 GiB free. This repository's delivery
workflow contributed approximately 90 GiB of avoidable duplication: 57 retained
`en-tactical-desktop-*` checkouts each reproduced four unrelated tracked root
videos and `node_modules.incomplete-from-laptop-archive`.

The videos consumed 67.6 GiB across 228 independent instances; the old dependency
archive added 22.2 GiB. The video history traces to the emergency snapshot
`49f16b1b`, not a requirement of the application. Repeated clean delivery builds
made that earlier tracking mistake much larger. Keeping a clean delivery source
does not require keeping every generated artifact or unrelated tracked download.

The primary checkout now stops tracking this material and ignores it. Its
original media files remain available. All 57 older delivery checkouts now use
sparse exclusions; their pre-existing source changes were checked before/after
and preserved. Do not undo their sparse exclusions when inspecting old source.
No source tests, unique work, owner databases or Git history were removed.

The wider cleanup removed inactive build caches and repeated Outpost download,
pack and restoration tests. The first pass recovered approximately 553 GiB,
leaving approximately 582 GiB free; the further cleanup ended near 642 GiB free.
Outpost's
`docs/STORAGE_INCIDENT_2026-09-21.md` records the dataset and benchmark causes.

Future agents must:

- Follow the storage discipline in `AGENTS.md` and the correction at the top of
  `docs/TACTICAL_DESKTOP_DELIVERY.md`. Reuse an owned delivery checkout/cache;
  retain the current and necessary rollback artifact rather than a new permanent
  full checkout for each revision. Never remove another task's dirty source.
- For older revisions that still track the videos/archive, use `--no-checkout`
  and set non-cone sparse patterns before populating the worktree: `/*`,
  `!/node_modules.incomplete-from-laptop-archive/`, `!/*.webm`, `!/*.mp4.part`.
- Never commit dependency trees, compiler outputs, downloaded databases,
  generated benchmark receipt trees or unrelated media. The installed storage
  hook also protects old worktrees. Do not bypass it; keep large research
  archives outside Git and preserve small reports/manifests/hashes in source.
- Use small fixtures, shared immutable reference data and bounded temporary
  outputs. Measure the peak size before a job likely to create more than 5 GiB;
  preserve 100 GiB of free working space and account for task output over 10 GiB.
- Save compact verification receipts, then remove only verified redundant or
  reproducible artifacts. An ignore rule does not clean files already on disk.
- Preserve active app binaries, updater/runner directories, mutable local
  databases, all unfinished source, settings and services. Do not rewrite Git
  history or apply broad reset/clean commands as a disk cleanup technique.

Run `node --test scripts/check-storage-policy.test.mjs` when modifying the guard.
The guard runs only at commit time; no continuous scanner was installed.
