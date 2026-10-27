# Personal chess library synchronization

## 2026-10-27 shared archive labels and transient review writes

- Shared archive snapshots now read Novelty Dev's `files.state` and
  `outpost.library.archivedCollectionIds`, mapping stable collection IDs to the
  current catalogue. Phone commands check the target's last-read label inside a
  SQLite transaction, retain metadata recovery and verify readback. File parent
  restoration retains separately archived children; database group actions
  explicitly affect that group's members, matching Novelty's group controls.
- Archive labels do not copy or modify games. Unknown fields, pins, kinds,
  unrelated collection IDs and local phone imports remain intact. Corrupt labels
  fail closed. Downloaded reference databases are not archive-write targets.
- The file scanner excludes the shared review writer's PID-owned
  `*.mistake-review.json.<pid>.next` staging files as well as its own staging
  files; ordinary `.next` files remain personal content. Old staging ledger
  records are not interpreted as content deletions.
- Source verification: 20 focused Node cases, including actual native synthetic
  catalogue/write fixtures, pass. A read-only unpackaged live audit checked all
  105 personal databases / 174,167 source PGNs and native row fingerprints and
  3,408 file/directory records against both peers; all matched. Archive mapping
  covered all 76 archived collections and both archived file roots. Runtime
  delivery is separate; do not infer a live upgrade from this source note.

This is an opt-in local bridge for Novelty Dev, En Croissant desktop and its
private phone companion. Customer Novelty is categorically excluded. The owner
selected personal content synchronization and read-only downloaded references.
Do not infer permission to sync downloaded evaluation corpora or re-enable old
accounts, services or download preferences.

- Novelty Dev supplies the initial baseline. Its Library SQLite and En Croissant
  `.db3` files remain separate writable databases; never junction or hard-link
  them. The native codec pins En Croissant's move encoding. A ledger retains the
  exact original PGN, stable game mapping and fingerprints for three-way checks.
- Files use content hashes, checked publication and displaced-file recovery.
  Unsupported SQLite files in Files are refused rather than copied while live.
  Simultaneous edits are retained as conflicts. Missing roots are errors, never
  mass deletions. Database deletion requires stable absence and unchanged peer
  content. Physical database renames/deletions defer while En Croissant is open.
- Reference paths are explicitly excluded from mutable database discovery.
  Explicit reference catalogue entries retain their existing read-only phone
  query handler; this is not a fallback for personal or production databases.
  Unclassified large databases fail instead of being imported into Dev. Maintain
  the read-only attribute on the selected reference copies during activation.
- `runner.mjs` requires a physically resolved Dev profile, initialized root
  marker, pinned configuration and one process lock. Its private loopback port is
  8788. `home-proxy.mjs` uses an owner-local secret, validates origins and never
  falls back to production data when configured personal sync is unavailable.
  Preserve the established HTTPS/controller routes and their owner On/Off state.
- A user logon task may run `start-runner.ps1` hidden with explicit Node/config
  arguments. Pin the two native executables in the owner-local runtime and record
  their hashes before activation; never depend on a compiler overwriting them.
- Windows ledger publication retries transient sharing denials against the same
  durable staging file. Resume a partial initial file mirror from its existing
  per-item baseline; never restart with a fresh empty ledger.
- File scans retain full hash/safety checks with at most 16 parallel item reads
  and stable catalogue order. Large database comparisons yield between batches
  so private HTTP status requests remain responsive. Status includes phase timings
  for diagnosing real-library latency; never substitute file size for validation.
- Foreground phone writes use their own ordered lane and checked native/file
  revisions; background audits cannot hold the phone API queue. Unchanged native
  comparisons may reuse Library data_version plus complete database/WAL stamps
  for up to ten minutes. Startup and periodic full audits still validate content.
  The same complete file stamps bound container-identity caching, so unchanged
  SQLite files need not be opened just to rediscover their names. Failed checks
  remain visible throughout retries instead of being cleared at the next start.
- Phone exports carry transport-only stable references and revision hashes.
  Checked saves strip those tags before writing personal content. New phone
  imports validate every game and recover by request identity. Offline phone
  edits remain in IndexedDB; an open board keeps its snapshot. Restore/recovery
  and conflict decisions must preserve both sides before any replacement.
- Build the codec with its standalone Cargo manifest and the existing target
  directory. The Novelty native helper is a separate process; no GPL code is
  imported into Novelty. The helper has its own checked transactional writer,
  using the existing native PGN parser and schema semantics without modifying
  product source or relying on pending Dev board-save APIs.

Source validation on 2026-10-25: 28 focused Node tests, 17 focused phone/session tests,
TypeScript, and a real browser plus native synthetic fixture cover both
directions, offline retry, concurrent edits, unknown headers, comments,
variations, game IDs, container changes and recovery. The sync status/help
renders at 1200/560/360 px and 200% text. The staged live Dev conversion matched
every stored PGN and native row fingerprint, and every staged database passed
SQLite quick-check.

The isolated phone delivery is based on the previously served usability release.
Its retained runtime worker bundles were regenerated from that same source to
include the existing portable board drawings; no new evaluation/download feature
is included. Full TypeScript and the phone build pass in this delivery checkout.
Live activation on 2026-10-25 used the physically resolved Dev Files root and
104 personal collections (174,166 games). Prior En content remains recoverable
under `Documents/PersonalChessSync/recovery`; the existing downloaded Mega copy
was preserved separately with the read-only attribute. A hidden user logon task,
`Personal Chess Sync`, runs this bridge from the dedicated personal-library-sync
delivery checkout with pinned native binaries and a private AppData config.
Preserve that checkout/runtime and its ledger; never rerun initialization against
the already-active roots. Production Novelty's original size/counts were checked
read-only, and no customer release or Novelty product feature source was changed.

The existing canonical phone service was published through its guarded workflow
with the owner On state and all Serve routes preserved. Live temporary fixtures
verified desktop files both ways, personal database edits both ways, the phone API,
and a note entered through the actual rendered phone UI reaching both desktops.
The independent native writer was checked after restart; fixture deletion was
verified separately. Physical-phone and native-window interaction remain unverified.
The private activation/recovery and verification receipts are under
`Documents/PersonalChessSync`; never commit their game content or config secret.

Final live checks after restart reported no conflicts/errors. Unchanged checks
completed in about two to three seconds on this PC; full audits can take longer.
The temporary fixture content and temporary broker tasks were removed. Retain the
permanent sync task, dedicated checkout, pinned helpers and recovery ledger.

Proxy acceptance fixtures use ephemeral listeners and inject only their request
transport; production remains fixed at8788 with the same origin/key validation.
Never bind the live bridge port for a test. Node fixture runs from an isolated
delivery may use absolute test paths with the primary checkout as cwd so the
existing sibling native debug helper resolves; every requested database/root
must remain a disposable fixture. Codec builds reuse the existing target and
never replace the pinned live helpers as a side effect of source validation.
