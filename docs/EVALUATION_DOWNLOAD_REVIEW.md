# Reviewed optional evaluation downloads

At Novelty snapshot `7128c5ed`, optional archive acquisition reviewed the source
and destination before starting work. En now exposes the same native backend
contract through its existing bounded builder and durable recovery journal.
The approved Settings A controls and validated current-folder activation are now
source-verified in EVALUATION_DATA_SELECTION.md. Runtime evidence is recorded
separately in the delivery JSON.

`review_local_eval_download` accepts a proposed new absolute output folder and a
build-space limit of 1–512 GiB. It checks the existing destination ancestor and
available space without creating output folders, refuses existing data and any
overlap with the recovery folder, and checks the current job's ownership/state.
It then requests only official archive HEAD metadata. The review includes the
compressed archive size, canonical output, available space, build quota and
separate 256 MiB filesystem reserve. The build quota covers generated work;
the compressed archive is streamed rather than saved as a second disk copy.
The development storage policy's 100 GiB reserve is not a product UI requirement.

Review requires HTTP 200, a positive advertised size and version information
(ETag or Last-Modified). No archive body is requested by review or status. There
is one current review per native process, with a random token valid for 15 minutes.
A newer review wins over late earlier responses. Start consumes the exact token;
stale, expired, reused or different-profile tokens cannot start a download.

`start_local_eval_download` rechecks the canonical destination, recovery state,
available space and quota before work. It returns a job ID only after durable
job registration and the OS lease are established. This acknowledges a started
job, not a completed download. Network/parser/storage failures thereafter remain
on that job for status and retry. View closure or the start command returning
does not cancel the separately owned worker.

The GET must match the reviewed final URL, HTTP 200, byte length and both version
headers. Strong ETags and modification dates become conditional request headers.
The client rejects a third redirect and any non-HTTPS redirect.
Connect and individual read bounds are 10 and 30 seconds; HEAD has a separate
20-second request bound. A progressing transfer has no total deadline.

The producer sends 64 KiB messages through a two-message channel to the existing
streaming builder. Positive EOF is sent only after the HTTP body reaches exactly
the reviewed size; a dropped producer or a valid compressed frame inside a
truncated response cannot publish a store. Parsing, disk limits, sorting, output
ownership, final-manifest publication and recovery all reuse the current builder.
There is no duplicate corpus format or alternate unbounded parser.

Native cancellation remains scoped to the actual job ID. Header requests, body
reads and channel backpressure observe cancellation at 50 ms polling intervals.
The operation still waits for the builder and its cleanup before settling;
filesystem work remains cooperative. The existing atomic publication boundary
can refuse a late cancellation. Progress reports compressed archive bytes read,
with the reviewed total known even while headers are pending. It must be labelled
as bytes read, not as completed positions or exact percentage of all build work.

The previous explicit CLI/raw build API remains compatible. Settings must use
the reviewed commands and never fall back to an unreviewed build after an error.
Successful acquisition does not select a store. Existing data, stored-evaluation
preferences, phone readers and hosted service configuration remain untouched.
The phone has no on-device corpus builder or arbitrary PC-folder operations.

Tiny loopback HTTP fixtures verify HEAD-only review; version/size/redirect
failures; changed destinations; consumed, expired and stale reviews; competing
leases before GET; truncated/malformed sources; stalls; progressing transfers;
ID-scoped cancellation; and work surviving the start caller. No real archive
HEAD/body, full corpus operation or owner-profile write is performed by these
fixtures. Source/command/CLI checks remain separate from native packaging,
rendered UI and physical-device proof.

Primary and the separate delivery checkout each pass 89 native library tests,
including 13 new reviewed-download tests and the earlier real recovery kill
fixtures. Nine generated transport checks and full TypeScript checks pass in
both checkouts; scoped frontend lint has no warnings/errors. The normal native
command registry compiles with 22 existing warnings. The actual rebuilt CLI
passes all 15 existing synthetic acceptance cases after the shared builder
refactor. That CLI gate checks compatibility, not a new CLI review interface.
No native package or rendered application interaction is claimed here.
