# Engine identity and version routing

The shared PC engine helper keeps its existing `Stockfish18Server` runtime root,
`Stockfish18Remote` task, ports and `stockfish-18-remote` service identifier.
These are compatibility identities; their names do not identify the executable
version. Do not run the broad installer just to upgrade an engine: it can
replace configuration, launch ownership and service state.

HTTP health is read-only and does not warm workers. Before a requested UCI
session, engine name/version are unavailable (`null`), rather than assumed to
be Stockfish 18. Each worker captures `id name` from its own startup handshake.
An analysis sends metadata after that worker is ready and before any score,
using the reported engine name. Stockfish version is parsed only from a reported
Stockfish name; architecture is unavailable rather than assumed to be BMI2.
Worker exit clears identity; a new process clears supported options and learns
its own capabilities. LCZero identity follows the same rule.

Source verification uses isolated loopback services with temporary configuration
and one-thread/16 MiB engine settings. The retained native Stockfish 19 passes
bounded reports, exact-score evidence, queued cancellation and recovery after
strict invalid-position termination. The existing Stockfish 18 executable passes
the same report/cancellation checks. Two standby checks prove health reads never
launch workers and preserve both explicit stay-on and idle-off policies. Seven
Stockfish-18/report/review/performance checks, three Stockfish-19/standby checks,
38 desktop/phone client checks and three-file lint pass without warnings/errors.
No live helper, profile, service, task configuration or hosted route changed.

The phone's local live/Plans and report workers now pin `stockfish@19.0.1` and
load its matched `stockfish-19-lite-single.js`/`.wasm` pair through the existing
encoded URL fragment. This retains the small single-threaded runtime and its
existing static hosting requirements. Worker identities come from `id name`,
including report evidence and new review cards/exports. Unknown legacy identities
use the generic Stockfish name; historical versioned evidence is preserved.
Engine selection labels name Stockfish without assuming the PC helper's version.
Existing internal `*Stockfish18` exports remain compatibility API names.

Critical UCI failures and worker errors reject the current local search promptly,
discard that worker, and allow a new worker on retry. Reports terminate their own
worker on failure/cancellation. Seventy-six focused phone transport/report/review
checks, full types, nine-file lint without warnings/errors, and the actual lite
WASM through its upstream Node entry point pass. The WASM reports version 19 and
completes legal White/Black depth-eight searches. This is not browser or physical
phone verification. Clean combined builds/runtime delivery are recorded separately.

Native Stockfish 19 authenticated installation/build staging and the safe default
upgrade are now implemented; the PC helper and phone are delivered on 19. See
`NATIVE_STOCKFISH_19.md` for current package/HTTPS proof and remaining catalog,
rendered and physical-device checks.
Historical Stockfish 18 score fixtures keep their real provenance.

Primary `cc5680bd` and clean delivery `54421267` match all 27 owned preference,
helper and phone source/test/manifest files. Clean verification passes 599 related
frontend checks/76 files, full types, twelve-file routing lint with zero warnings
or errors and the real lite WASM test. WebApp retains 25 existing lint warnings.
The helper independently passes the three 19/standby, seven 18/review/performance
and 38 client checks on clean source. Desktop and canonical-phone builds pass in
22.01/22.12 seconds. Both compiled worker assets match the
pinned dependency bytes; no old worker or invented test fixture is bundled.
Those counts describe the earlier source milestone. Current native/helper/phone
delivery is recorded in `NATIVE_STOCKFISH_19.md`; owner profiles were not manually
migrated.
