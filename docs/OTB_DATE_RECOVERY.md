# OTB date recovery

The OTB collector writes a standard `Date` when a game supplies only `UTCDate`,
before deterministic candidate preparation. Existing valid `Date` wins. Both
streaming and persistent-index year filters use the same fallback, preventing
known older UTC-dated games from slipping through a requested starting year.

Selected broadcast games with neither date use their exact round API's
`startedAt`/`startsAt`, with a matching round identity and recorded
`OutpostDateSource`. The request shares existing discovery caches, cooldown,
rate limiting and cancellation; its total recovery bound is five seconds.
Failures remain in the source report and never remove undated games. Known
partial dates stay intact. No exact date is inferred from archive filenames,
event names, finished timestamps or download timestamps. Recovered dates are
checked against the requested starting year before export.

Verification: `cargo test --bin collect_otb_games --features headless-otb otb_import::`
passes 79 tests, including date priority, invalid dates, exact round matching,
cached recovery without network, unchanged movetext, and known-date no-ops.
The same native module serves desktop imports and the phone collector, whose
standard Date export reaches the phone's own database/index parser.

This mirrors a Novelty database repair as a shared source change. The request
did not ask to publish an En Croissant update, so installed desktop binaries and
the running phone helper remain unchanged. Deliver the committed source through
their existing workflows when a sibling update is requested; retain its current
service identity, sessions, databases and active jobs. No corpus copy or profile
maintenance is needed for this fix.
