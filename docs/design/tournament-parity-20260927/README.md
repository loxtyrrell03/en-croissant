# Tournament and OTB parity

The owner selected implementation without another approval step. Direction A is the tournament hub: find/follow an event, identify your entry, see the next round, then import an opponent directly into Prep. The three editable SVG directions use the app's existing dark surfaces and blue controls. All example players and events are invented.

Open `index.html` for A (hub), B (round timeline), and C (prep first), with 28 phone states each, desktop views, and state maps. The implementation retains Novelty's established detailed tournament views inside this hub.

`source-audit.json` records hashes of the current Novelty working files, including uncommitted improvements. `scripts/audit-novelty-tournament-parity.mjs --verify-source docs/design/tournament-parity-20260927/source-audit.json` verifies that those files and Novelty's Git state have not changed. Novelty is a read-only source; no profile or data is migrated.

`port-manifest.json` records the initial frontend extraction. Subsequent host adapters are maintained in En Croissant. The initial port scripts deliberately refuse to overwrite an existing implementation.

The isolated `src-tauri/tournament-core` crate contains the tournament readers, discovery, schedule/media parsing, and OTB download manager. Desktop and the private phone host call the same implementation. Tournament metadata belongs to each host; immutable downloaded OTB indexes and download preferences share the existing OTB cache. Editable opponent databases remain separate. The service has no access to Novelty's settings or libraries.

Native milestone verification: 60 synthetic fixture tests passed, with two opt-in network tests skipped. This establishes parser/transport and scoped registry behavior; it is not evidence of a deployed phone build, physical phone use, or full live-source coverage.
