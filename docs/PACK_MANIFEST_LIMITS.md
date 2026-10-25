# Pack manifest response limits

Novelty `2815afb4` rejects oversized archive metadata from its advertised size.
En's shared metadata helper already contained that check, but its active OTB
pack path uses a separate `data_pack::install::fetch_manifest` function. That
function previously read the body before detecting an oversized response.

The active function now rejects a Content-Length above its existing 2 MiB limit
before allocating/reading the body. The streamed limit still applies when the
server omits a length. Pinned manifest hashing, schema/pack identity checks,
approved hosts, cancellation and existing connection/read bounds remain.
En retains its stricter 2 MiB pack limit; Novelty's 4 MiB archive-list limit is
not substituted for it.

The native tournament command runs this function through its blocking task;
the hosted phone uses the same core in its separate helper process. Frontend
controls, pack selection and stored data do not change. Target packaging and
hosted delivery are tracked separately in the delivery JSON.

The actual caller's header-only fixture failed on the old code with a body
decode error. Three new local HTTP cases cover early advertised-size rejection,
valid pinned manifests with/without Content-Length, and the streamed byte limit.
The complete core suite passes 83 checks with three existing ignored checks,
independently on primary and delivery source. The 15 transfer cases are included
in that total. No public archive, owner collection or retained corpus is used.


Clean `33670fec` packages the desktop in 1m45s with 22 existing warnings. The
47,892,992-byte EXE has SHA256
`ee4d6ac791253ae6279f3bdeca6101013b88d1e03621dd07fb9bf8bf4b49b1db`.
Exact boot/App/files assets, the Windows IPC script, all 102 engine/source
resources and six accumulated product/test files match the verified source.
Only two known generated outputs were restored; the delivery checkout is clean.

The same source is live on the canonical phone site, shell SHA256
`737e2674590cb1426c3968782351478f01deffab8e8db9d5b5a17e101648cc28`.
An unpackaged readback verifies the installed helper's backing path, SHA256
`ddebefb36297d5925fee41de8efb0fd3e9cbd5c25e2d202dabbc6e54194e720f`
and actual child process started after publication. The first attempt refused
an active review before activation; the later idle-guarded publisher returned
normally. Both owned tasks were removed after terminal proof.

Canonical HTTPS asset and workspace/library/settings reads pass. Normalized
library contents, saved workspace, tournament settings, owner enabled state,
all Serve routes and the existing PC engine process are preserved. The normal
stored-evaluation response is unchanged and shared workers remain cold.
No real archive download was launched. Browser-rendered, native-window and
physical-device evidence remain separate; no full review completion is claimed.
