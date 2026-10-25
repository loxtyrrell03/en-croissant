# Additional native/app history review queue

The original inventory left137 commits without an area, including38 touching
native/app source. This queue retains those38 explicitly; script-only research
and verification remain separately classified, with no automatic exclusion.
The categories are candidate routing, not proof of a new gap or target parity.
The existing engine55 map remains unchanged. Review each payload through En's
native/phone architecture and retain its own product/data/hosting boundaries.

| Novelty | Candidate | Refreshed area | Evaluation |
| --- | --- | --- | --- |
| `158ccf01` | Make panel wheel motion continuous with small frame steps | settings-and-shell | Target evaluation required |
| `77e5c052` | Fix mouse-wheel smoothing across all scroll surfaces | settings-and-shell | Target evaluation required |
| `e8914f49` | Retain Finder PGN requests until the workspace is ready | settings-and-shell | Target evaluation required |
| `974725a1` | Share Tauri context to fix duplicate Mac test metadata | other-native-and-app-review | Target evaluation required |
| `882830ac` | Replace sun-like settings icon with a gear | settings-and-shell | Target evaluation required |
| `7bbe5984` | Smooth panel mouse-wheel scrolling across the app | settings-and-shell | Target evaluation required |
| `d9acb4d0` | Remove requested migration header comment | local-data-and-recovery | Target evaluation required |
| `76c93459` | Default downloads to Full and add compact cloud evaluations | settings-and-shell | Target evaluation required |
| `df7bd865` | Recognize existing downloaded Lichess stores | settings-and-shell | Target evaluation required |
| `676f8206` | Recognize existing downloaded Lichess stores | settings-and-shell | Target evaluation required |
| `86374523` | Clarify downloaded data states and repair local source activation | local-data-and-recovery, settings-and-shell | Target evaluation required |
| `2815afb4` | Harden metadata bounds and Windows release integration checks | local-data-and-recovery | Target evaluation required |
| `a0c3d55d` | Fix native database download review task | other-native-and-app-review | Target evaluation required |
| `039189de` | Distinguish unavailable download checks from missing files | settings-and-shell | Target evaluation required |
| `a856b32e` | Verify combined monthly databases through real research views | other-native-and-app-review | Target evaluation required |
| `d52f614e` | Route Windows IPC through the native WebView bridge | settings-and-shell | Target evaluation required |
| `101bc2e2` | Start data downloads directly and clarify failures | settings-and-shell | Target evaluation required |
| `c367b2c2` | Remove the inherited checkmark from downloaded-data switches | settings-and-shell | Target evaluation required |
| `b83200b5` | Use the defined lookup status colour token | settings-and-shell | Target evaluation required |
| `3ab6cf2e` | Validate evaluation folders before changing the active path | local-data-and-recovery, settings-and-shell | Target evaluation required |
| `d230b44f` | Ship reviewed compression notices in About and installer | settings-and-shell | Target evaluation required |
| `f68a34de` | Replace blanket data clearing with recoverable appearance reset | settings-and-shell | Confirmed native source gap: Help Clear saved data calls localStorage.clear and sessionStorage.clear before reload. Safe appearance-only reset/undo and failure preservation need implementation; no owner data has been cleared |
| `89af6af2` | Snapshot live databases and preserve recovery exports | local-data-and-recovery | Target evaluation required |
| `a6014512` | Recover opening builds and preserve active database snapshots | local-data-and-recovery | Target evaluation required |
| `065274f2` | Bound opening download stalls and validate archive resume | local-data-and-recovery | Target evaluation required |
| `92e6a372` | Handle reset failures and keep dialog actions reachable | settings-and-shell | Target evaluation required |
| `7128c5ed` | Recover evaluation downloads after app termination | local-data-and-recovery, settings-and-shell | Target evaluation required |
| `08f4dfe3` | Show account sign-out for Outpost owners | settings-and-shell | Target evaluation required |
| `2a083a83` | Add bounded optional evaluation database builder | local-data-and-recovery | Target evaluation required |
| `109c529b` | Fix local data update controls and preserve installed scope | local-data-and-recovery, settings-and-shell | Target evaluation required |
| `209593ff` | Polish responsive Settings and serialize folder actions | settings-and-shell | Target evaluation required |
| `1290880c` | Distinguish local data read failures from missing installations | local-data-and-recovery, settings-and-shell | Target evaluation required |
| `aa25aa07` | Checkpoint fresh legacy database imports | local-data-and-recovery | Target evaluation required |
| `84308b8b` | Harden checkpointed legacy import resume | local-data-and-recovery | Target evaluation required |
| `0b97d3bb` | Resume interrupted legacy database imports | local-data-and-recovery | Target evaluation required |
| `701b7e10` | Speed native OTB library imports | local-data-and-recovery | Target evaluation required |
| `6734869d` | Speed native OTB library imports | local-data-and-recovery | Target evaluation required |
| `ba7377e3` | Restore the preserved Lichess OAuth bridge | settings-and-shell | Target evaluation required |

Prioritize source folder validation, unavailable-versus-missing states, bounded
transfer/resume, recovery snapshots and import checkpoints. Use tiny fixtures;
do not copy the retained full evaluation corpus or recreate deleted datasets.
Mac-only Finder/context/metadata checks, Novelty account identity and release-only
payloads need explicit target-specific decisions, rather than whole-commit ports.
Existing native/phone data helpers and active profile backing remain authoritative.

## First confirmed follow-up

Native src/routes/__root.tsx Help/clear_saved_data asks a broad confirmation,
then clears all local/session storage and reloads. Novelty f68a34de replaces that
same menu class with a precise appearance-key manifest, an undo record written
before mutation, failure retention and ordinary workspace-preserving reload;
92e6a372 adds reachable/error-safe modal actions. En should port those safeguards
through its own atoms, menu and save lifecycle. Reproduce the current action with
synthetic storage; do not invoke it against the owner's browser/app data. Map the
exact En appearance/layout keys and native mirrors before choosing a manifest.
This is a confirmed source gap, not an implemented fix or data-loss incident.

The En native evaluation reader is different from Novelty's active-folder
selector: commands use default_store_dir and database_status already separates
manifest validation/missing/read errors. There is no matching Settings evaluation
folder chooser in the inspected source. The builder/transfer/recovery candidates
still require their own evaluation; absence of this chooser does not certify them.
