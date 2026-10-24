# Review progress save ownership

Novelty's failed/overlapping review-write fix (`fb5b8233`) applies to En
Croissant's file-backed opening and mistake decks through its own storage
architecture. The prior debounce deferred writes but did not serialize an
already-running write against another save or the unmount flush. A failed final
write only showed a notification and was forgotten when the panel remounted.

`utils/reviewDeckWrites.ts` now owns one ordered writer per deck path. It
snapshots input before asynchronous work, coalesces waiting changes to the
newest complete snapshot, and waits for an active write before starting another.
Windows drive/UNC path spelling variants share ownership. Different decks can
save independently. Existing file formats, summary caches, server authority and
review grading/certificates are preserved.

Failure retains the newest snapshot in app memory, including dates and logs.
Both native readers prefer that pending snapshot to the older disk file, so
remounting does not revert progress. The review panel shows the retained error
and Retry save; retry writes the same evidence without another grade. New saves,
page hiding and an explicit retry can retry the retained value. Rejections,
including empty backend errors, never cause a retry loop. Pending writes warn
before page close. Deletion waits for that deck's pending writer first.

Legacy browser-cache cleanup cannot prevent a file-backed deck from opening
when browser storage is denied. Retention is in-process recovery; the file
format and filesystem crash/atomic-write guarantees have not changed.

The phone already has a root-owned `webStateSession` that serializes workspace
writes, retains failed changes across view/root remounts and exposes retry. Its
shared review service retains server-side grade/revision ownership. Those
separate storage mechanisms are preserved.

The focused native writer, actual opening/mistake file adapters and mounted
error/retry panel have nine regression checks. The related ten-file suite has
92 checks, covering existing review assessment, phone grade interaction and
phone workspace failure/overlap/remount behavior. Together with the three cadence
checks below, all 95 checks across eleven files pass on clean `ac47b965`.
Clean types, nine-file lint (zero warnings/errors) and the production frontend
bundle (23.51 seconds) pass. The nine owned source/test files match primary
after line-ending normalization. Runtime delivery and rendered error-layout
verification are tracked separately in the parity ledger. No owner deck or
phone workspace was edited by these synthetic checks.

## Related parity checks

Novelty's `fe5ccd04` fixes its post-move callback comparing the resulting
board with the original card. En's native Board captures the practice entry and
original FEN/SAN/UCI before `storeMakeMove`, then checks request/card/FEN/move/phase
before delayed assessment. Phone `attempt` replays from `card.fen` into a
separate preview. Existing assessment and actual phone interaction tests pass;
these controllers already satisfy that specific behavior.

Novelty's `88e97630` repairs a persisted scheduler last-run map. En uses timers:
tournament jobs schedule their next interval after completion/failure, and
replacing/stopping a registration clears the old scheduled callback. Three
fake-clock checks cover storage denial, long-running/failing jobs and replacement
without changing the scheduler. Online/study hooks have fixed timers plus
in-memory running refs; phone review polling has a pending guard. There is no
shared persisted cadence map to replace. This is target-specific source/test
evidence, not native-window or physical-phone verification.
