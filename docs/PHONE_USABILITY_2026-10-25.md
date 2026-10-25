# Compact phone UI and discoverable stop following

The owner selected design A from the editable options in
`design/phone-usability-20261025`. The screenshot's missing action was a
discoverability defect: Stop following existed only in Tracking, off the visible
end of its horizontal tab strip. It now appears above the event title on every
tracker view, with the existing confirmation explaining that imported games stay.
Deletion remains a separate explicit option. Unfollowing waits for any active
update and removes the tracker only after a successful settings save.

The compact shell reaches Board, Events/Tournaments, Import, Review, Files and
Stats. It retains six destinations, wraps when necessary and applies the top safe
area once. PC status keeps its real switch and errors/retry; the repeated healthy
explanation moves into existing focus/tap/hover help. Board tools use labelled
wrapping rows with 44px targets and ordinary page scrolling. Tournament tools
share a short row, and every tracker tab is visible at narrow widths.

PGN import, Review setup and Stats filters use native disclosures without
unmounting their controls. PGN draft state and saved Review/Stats/workspace
preferences remain intact. Active Review work and errors keep setup open. Stats
shows the current filter scope even while folded and gives fields visible labels.
Hosted file names wrap; imported and archived data identities are unchanged.
Intrinsic grid widths, button limits and text wrapping account for enlarged text.

## Verification

- The new stop-following interaction regression fails against the old source.
  The tracker/removal selection passes 14 checks; the combined workspace,
  preferences, Review, service control, source archives, import handoff and custom
  Stats period selection passes 23 checks across 11 files. Full TypeScript passes.
- Canonical home build passes. Touched-file lint has 25 warnings and zero errors;
  no unrelated warning cleanup is included.
- Browser checks run the actual production app with local synthetic APIs and
  separate origin storage. They cover all six pages at 320, 390, 430 and 760px,
  five Board tools, Stats disclosure, PGN draft/collapse/reopen and a successful
  one-game import. Cancel leaves the tracker; Confirm returns to discovery with
  no collectionDelete request. Existing lifecycle tests also verify preservation
  of actual collection references during an in-flight refresh.
- Enlarged root text (32px) at 320px exercises navigation and settings wrapping.
  Rendered checks are PC browser evidence, not physical iPhone verification.

## Delivery

Publication uses the existing committed-source, fast-forward, immutable-release
and active-work guards. It preserves the canonical lox-pc root/controller route,
other routes, owner On/Off state, workspace, tournament settings and libraries.
Live source and preservation evidence are recorded after publication; source
checks alone do not establish delivery.
