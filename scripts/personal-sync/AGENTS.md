# Personal chess library synchronization

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
- Phone exports carry transport-only stable references and revision hashes.
  Checked saves strip those tags before writing personal content. New phone
  imports validate every game and recover by request identity. Offline phone
  edits remain in IndexedDB; an open board keeps its snapshot. Restore/recovery
  and conflict decisions must preserve both sides before any replacement.
- Build the codec with its standalone Cargo manifest and the existing target
  directory. The Novelty native helper is a separate process; no GPL code is
  imported into Novelty. Its checked save APIs currently depend on unfinished
  primary Novelty source work and need scoped reconciliation before claiming a
  clean, reproducible cross-repository build.

Source validation on 2026-10-25: 26 focused Node tests, 17 focused phone/session tests,
TypeScript, and a real browser plus native synthetic fixture cover both
directions, offline retry, concurrent edits, unknown headers, comments,
variations, game IDs, container changes and recovery. The sync status/help
renders at 1200/560/360 px and 200% text. The staged live Dev conversion matched
every stored PGN and native row fingerprint, and every staged database passed
SQLite quick-check. These checks are not installation or physical-phone proof.

The isolated phone delivery is based on the previously served usability release.
Its retained runtime worker bundles were regenerated from that same source to
include the existing portable board drawings; no new evaluation/download feature
is included. Full TypeScript and the phone build pass in this delivery checkout.
