# Phone PGN export safety

The annotation toolbar snapshots the complete immutable current PGN, including
notes/drawings and personal-sync transport tags. Browser Blob/dispatch failures
stay visible and allow explicit retry. Owned temporary anchors and object URLs
are cleaned without mutating game/workspace state. Dispatch is not proof of an
OS download. Source/component verification and deployed/physical proof remain
separate; see ../../docs/PGN_EXPORT_SAFETY.md.

# Phone personal library sync

Personal library sync is opt-in through the PC's private local configuration.
It uses Novelty Dev as the initial source and excludes customer Novelty and
downloaded reference edits. The existing home-server URL and owner service
On/Off choice remain authoritative.

`PhonePersonalSync` coordinates saved games through the existing durable
`webStateSession`. Before adopting a new shared-library identity it retains the
entire old phone workspace under a separate IndexedDB recovery key, then archives
its previous unlinked sources. Recovery failure prevents adoption. Old board
analysis remains open; it is never silently replaced by a background refresh.

Portable PGNs carry `PersonalSyncRef`, `PersonalSyncRevision` and
`PersonalSyncBase`. They identify the actual saved game and distinguish an
unchanged cached game from an offline edit. The PC strips these transport tags
before saving user content. Preserve edits added while an upload is in flight,
retain conflicts for review and persist acknowledgements before sending more.
New personal imports are linked through the checked import endpoint; temporary
online analysis boards and archived pre-sync sources are not uploaded.

The shared file browser refreshes on content revision changes and guards stale
directory responses. Shared PGN reads bypass the static service-worker cache.
Other products and unconfigured phone profiles retain their existing behavior.
Source/native-fixture and browser tests are separate from deployed and physical
phone verification; see `scripts/personal-sync/AGENTS.md` for the backend contract.
