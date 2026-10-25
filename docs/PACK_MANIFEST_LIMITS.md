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
