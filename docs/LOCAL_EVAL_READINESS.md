# Local evaluation read readiness

Novelty1290880c separates failed filesystem checks from genuinely absent local
data. Inspecting En's actual readers found the same class of gap despite their
existing error fields: Rust read_manifest and shard lookup used exists(), and
the phone/PC helper used existsSync(). Those checks can hide access errors.
A file occupying a corpus-directory path also looked like an uninstalled store.

Two native regressions and four of the first five Node fixtures fail against the
old code. They call the actual status/lookup APIs using invalid paths, ordinary
synthetic files and corrupt metadata. No owner corpus, profile or permission is
modified to manufacture these failures.

## Reader contract

Native root/shard directories now use fallible metadata checks; a regular file
at a directory path is an explicit error. Manifest/shard presence checks use
try_exists so a failed check propagates through the existing result/status
channel. Confirmed missing stores, manifests and the existing sparse/missing
shard contract still return absence. A valid empty shard remains a position miss.
Corrupt manifests or unreadable compressed shards remain errors.

The shared lichess-local-eval-reader.mjs uses the same distinction with statSync:
only ENOENT means absence, and a directory/file mismatch is visible. Its status
retains the error, and direct lookup rejects when manifest reading failed rather
than returning an ordinary miss. Home-server and PC-engine consumers share this
module. The existing manifest-refresh interval and cache limits remain intact.
No reader performs a download, rebuild, deletion, path switch or data migration.

Existing record formats and the local-only scoring policy remain intact. This
change certifies the filesystem
error distinction; it does not certify every metadata field, all shards in a full
corpus, or the other download/build/recovery candidates. There is no new Settings
folder picker or new interface in this slice.

## Verification and delivery

Six tiny native fixtures pass, including the three existing codecs/PV cases.
Three added cases cover status/lookup access failure, retained non-directory
source files, and valid misses versus manifest/shard failures. The native fixture
uses the existing minimum16-shard format. Six Node reader cases plus two existing
isolated home-server HTTP cases pass, alongside the seven Windows IPC checks.
Both primary and clean run the15 Node checks. Changed JavaScript passes two-file
lint without warnings/errors. The existing CI helper step now runs13 reader/IPC
checks; normal Vitest discovery continues to exclude Node suites.

Temporary fixtures remain tiny, and recursive cleanup verifies the canonical
temporary parent/prefix first. No full-data download or corpus copy is used.
Frontend source/types are unchanged from the prior531-case milestone; that
suite is not counted as rerun here. Native packaging and both installed helper
copies require their own delivery receipts in NOVELTY_SYNC_2026-10-24_DELIVERY.json.
Runtime and rendered/native-window evidence remain distinct from these fixtures.
