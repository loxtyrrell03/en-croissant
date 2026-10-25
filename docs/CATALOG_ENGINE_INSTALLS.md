# Retained catalog installation state

Novelty `66def21d` keeps managed installs and their failures outside the Add
dialog's lifetime, separates file progress from completion and offers retry.
En Croissant now applies that behavior to its LCZero and third-party catalog
cards as well as its separately verified Stockfish 19 card.

`catalogInstall` scopes retained operations to the actual Jotai store and a
stable source/path/version catalog key. Dialog close, route navigation and
catalog row reordering cannot lose or duplicate a running operation. Each file
operation has a unique progress ID; old index-based events cannot complete a
different card. Existing native install commands continue after closing the
dialog. They do not acquire a new cancellation claim.

Cards distinguish file preparation, engine validation, profile saving, errors
and completion. Download percentages describe the current file operation;
100 percent from the native file event is not an Installed receipt. Installed
requires a valid program and a durably saved matching profile. Failures remain
visible beside Retry install or Retry save when the card is reopened.

Completed files are reused after a validation failure. A failed profile save
retries the existing retained writer without downloading, validating or adding
another profile. The existing global Retry save action is also recognized
through a read-only completion check. It cannot trigger another installation
or retry another user's pending write automatically.

Registration reads the latest saved model after native work, appends only when
the exact installed path is absent, and preserves existing IDs, names, images,
visibility, options and array order. An owner removal during failed-save retry
stays removed. Changed engine folders block obsolete registration. Initial
catalog matching uses source/program/version identities, including renamed
managed discoveries, rather than a display name alone. Windows drive/UNC
identity is case-insensitive; POSIX path case remains meaningful.

The runtime retains the existing native file/extraction commands, bounded UCI
configuration check, LCZero weights and loaded-profile behavior. No native
installer, PC service, source catalog, owner profile file or data corpus is
manually changed by this source milestone. The phone's managed WASM and PC
engine controls do not install arbitrary desktop catalog programs, so this
desktop-only install flow does not apply there.

Three actual prior-component failures were reproduced: premature Installed
during validation, a lost late download error after close, and Installed after
a failed profile save. Thirteen new actual-control/identity checks cover these,
reopening, concurrent owner edits/removal, global retry, folder changes,
validation retry, third-party command failures and path/source matching. The
related run passes 98 checks across eleven files, full types and seven-file lint
without warnings/errors. No real large download or full corpus test is needed.
Clean delivery/build and rendered checks are recorded separately in the sync
delivery JSON. Source fixtures do not establish narrow rendered or native-window
verification; browser control remains disabled in Work settings.


Clean source `e386a802` independently passes 633 related checks across 85 files,
full types and the native release build (22 existing warnings, 2m55s Cargo).
The complete engine-page chunk contains the retained card/controller code,
matches its exact Brotli asset and is embedded in the executable. All 102
engine/source files (104,581,828 bytes) and ten owned committed files match.
The executable is 47,868,416 bytes, SHA-256
`a675f637362c1706c70ace1de92f7b4ba569430d0b356c8e3594bbdc6e2cfd78`.
Only two known generated outputs were restored; the delivery checkout is clean.
Fresh browser inventory still reports disabled local browser use, so no narrow
rendered/native-window proof is claimed. The live phone remains `41f60e91`;
this desktop installer surface does not change its production behavior.
