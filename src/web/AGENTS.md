# Phone PGN export safety

The annotation toolbar snapshots the complete immutable current PGN, including
notes/drawings and personal-sync transport tags. Browser Blob/dispatch failures
stay visible and allow explicit retry. Owned temporary anchors and object URLs
are cleaned without mutating game/workspace state. Dispatch is not proof of an
OS download. Source/component verification and deployed/physical proof remain
separate; see ../../docs/PGN_EXPORT_SAFETY.md.
