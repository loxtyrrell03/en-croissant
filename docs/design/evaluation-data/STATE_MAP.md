# Evaluation data and recovery: surface/state map

Scope: native desktop evaluation-store management and optional reviewed builds.
The existing engine Stored evals switch stays in engine preferences. En's local-only
scoring rule stays authoritative; no remote-evaluation lookup toggle is proposed.
The managed phone companion keeps its existing PC service/readiness path and
does not gain an on-device corpus builder or arbitrary PC-folder operations.
Existing data and the retained shared immutable corpus are never copied by setup.

The three editable workflow sheets use the same functional contract. A places it
in a compact Directories row with dialogs; B adds a dedicated Data tab with
Current store, Download and Recovery subviews; C opens a source-manager table
with inline expandable operations. These are alternative navigation/lifetime
layouts, using En's existing native theme and controls.

All displayed paths, position counts, archive sizes and disk figures are invented
design examples. Selecting a direction authorizes its UI implementation; these
files do not start a download or alter a profile.

| Surface/state | Visible information and immediate action | Ownership/failure contract | Sheet frame |
| --- | --- | --- | --- |
| Settings entry / ready | Current validated folder, labelled position count; Choose folder and download details | Saved current store remains selected | 1, compact in 1 |
| First setup / confirmed missing | Not connected; Choose folder or Review download | No automatic archive request or fallback source selection | 6 |
| Initial check / loading | Checking current store; busy state beside row | Missing is not inferred before a successful check | 6 |
| Current folder unavailable | Cannot read folder, visible cause; Retry check | Keep current path/preferences; preserve missing-vs-unavailable distinction | 6 |
| Existing folder chooser | Native directory picker, then validation beside selected candidate | Picker cancellation does nothing; invalid candidate cannot change the active source | 1, 6 |
| Validation / delayed result | Checking selected folder | Request ownership rejects replies after newer selection/navigation | 6 |
| Candidate rejected | Visible validation failure; Choose another folder | Old source remains; no cache generation change | 6 |
| Candidate accepted | Validated source details; explicit Use evaluations | Persist and verify path before switching; reject stale activation | 6 |
| Activation write/readback failed | Previous folder retained; Retry | No success state or silent cache/source change | 6 |
| Download review loading | Checking official archive and destination; Cancel | HEAD/metadata only; no archive body before explicit Start | 2 |
| Download review ready | Compressed bytes, fresh output folder, build quota, available space and reserve | Single-use time-limited review; source identity/path/free space rechecked on Start | 2 |
| Review expired / source changed / low space / path exists | Exact reason visible; Review again or choose new folder | No build starts; an existing destination is never replaced | 2, 6 |
| Help | Adjacent question mark, same focus/touch/hover help contract as existing controls | Short explanation of quota/scope, dismissible and bounded; essential errors stay visible | help frame |
| Starting | Starting download; cancellation remains available | Persistent job identity and OS lease acquired before network/body/output work | 3 |
| Network progress | Compressed archive bytes read out of reviewed total | Label bytes read; transport quantity is separate from completed positions/build work | 3 |
| Parsing / preparing / sorting | Exact current phase and applicable position/shard counters | Indeterminate work has no fabricated percentage; bounded memory/disk/reads | 3 |
| Close / navigate / reopen | Close view; later reopen the same job | UI close does not cancel; native job owns lifetime and failure state | 3 |
| Cancel requested | Stopping…; no second cancel or start | Do not say cancelled until worker/network/build cleanup has settled | 3 |
| Cancelled / ordinary failure | Exact settled result; review fresh attempt when applicable | Current store retained; only owned partial output may be cleaned | 3, 6 |
| Transient status failure | Last known job retained with Retry status | Failure to read status is not absence or permission to start overlapping work | 6 |
| Job complete | Ready to use; Use evaluations | Manifest published last; download completion does not switch current source | 6 |
| App terminated, partial job restored | Download interrupted, exact owned output; Remove incomplete download | No automatic archive resume, download, activation or cleanup | 4 |
| App terminated after publication | Completed store restored; Use evaluations | Detect real completed data despite missing final journal update; unknown final counters stay unknown | 6 |
| Cleanup confirmation | Exact output path and removal scope; Keep files / Remove incomplete | Confirmation refers only to the recorded incomplete job | 5 |
| Cleanup validation / progress | Checking/removing this incomplete output | OS lease and canonical identity; complete inventory validation before first mutation | 5 |
| Cleanup refused | Exact reason visible, files retained | Published manifest, changed marker/path, links/reparse points, unknown entries or competing lease refuse | 5 |
| Partial cleanup IO failure | Remaining incomplete files retained; Retry cleanup | Retain recovery record and marker as long as possible; never erase unrelated entries | 5 |
| Cleanup complete | Original output is available for a newly reviewed attempt | Clear only the matching settled job; do not select a source | 4, 6 |
| Other process owns job | Check that window; status and retry beside it | OS lease, not PID/age guesses; no concurrent start or cleanup | 6 |
| Corrupt / newer journal or unreadable state | Cannot read recovery state; files kept; Retry | No fresh-state overwrite or guessed cleanup | 6, help frame |
| Narrow / high text size | Stacked controls and bounded help/dialog; path wraps | Native directory/help/action semantics remain; no clipped critical actions | compact frame |

The backend journal/OS lease, guarded recovery and native status/cleanup commands
are source-verified with real process-termination fixtures; see
../../EVALUATION_BUILD_RECOVERY.md. The reviewed acquisition backend is also
source-verified in ../../EVALUATION_DOWNLOAD_REVIEW.md. Next are validated
persistent source activation and the chosen Settings layout, followed by actual
rendered and interaction checks when browser control is available. Existing
bounded builder/output ownership is retained. Runtime delivery and physical-device
evidence remain separate from prototype, source and fixture results.
