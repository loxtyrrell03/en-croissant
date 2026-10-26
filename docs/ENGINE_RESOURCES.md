# Engine resource presets: target implementation

Novelty b186d2d7 supplies device-balanced CPU/hash presets, gesture-safe sliders
and explicit settings-application ownership. En's per-engine/tab/default settings
and separate PC/phone/LCZero architecture must retain their existing contracts.
Three editable native/phone directions are in `design/engine-resources`; the
owner selected A, inline controls. The approved evaluation Settings A, phone
Analysis A and compact navigation remain separate choices.

The first source slice adds only read-only capability metadata. Native
`engine_device_info` returns `EngineDeviceInfo` through the normal command registry
and generated frontend binding. The shared library obtains available logical
parallelism and an OS memory snapshot without starting an engine or scanning
processes. Memory is expressed in whole MiB. Unknown installed memory remains
null; known zero available memory stays zero. Values outside the numeric wire
range remain unavailable. The older `memory_size` command stays compatible.

The PC gateway's existing health reply gains the same `device` shape, read from
the PC's OS. Independent failed CPU/total/available probes retain the facts that
are still known; there is no fabricated zero or benchmark. OS-reported available
memory is a momentary resource estimate, not a reservation or future guarantee.
This read neither configures nor warms Stockfish/LCZero. Existing fixed presets,
custom config, queue, timeout and On/Off semantics are unchanged. The installer
stages the new tiny module before its server entry point; it has not been run.

Verification: all native library checks pass, including four new unit/actual-host/
pure Specta wire cases; the normal native command registry compiles with22
existing warnings. Eleven Node cases pass, with one pre-existing opt-in real
engine case skipped. Actual isolated HTTP health checks expose numeric device
facts while both engine families stay cold, and the original config is unchanged.
Full TypeScript and four-file lint0 pass. Installer syntax and dependency order
are checked without running installation, tasks or a live service.

This capability slice is independently mirrored and verified in primary: four
native device/wire checks,44 exact CI Node helper checks and full types pass.
Its owner guidance104/2 and binding25/1 remainders are preserved.

The pure CPU policy is now exported from `scripts/engine-resource-presets.mjs`
with a typed frontend facade. It divides the source resource budget across the
included engines, retains conservative unknown-device values, matches exact
non-power-of-two custom settings and supplies bounded memory slider stops.
Ten cases pass. Thirty invented device/count combinations compare its preset
numbers and maxima directly with the unchanged actual Novelty b186d2d7 module;
they match. The target additionally exposes `canRecommend=false` when aggregate
minimum resources cannot fit, rather than claiming that the minimum floor is a
safe budget. The selected controls must show this state without changing current
choices. Full types, three-file lint0 and four-file formatting pass.

The next source slice implements the selected inline controls in native Engines
profile defaults when the engine advertises valid Threads/Hash integer options.
It preserves exact custom resources, all other UCI options, search limits and
engine enabled flags. Recommendations describe one CPU engine for these defaults;
the current-tab included-engine budget remains a separate pending surface.
Existing unsupported CPU and LCZero options keep their original editor. The
native profile setter now targets engine identity/path rather than a captured
list index, and option edits clone the settings instead of mutating saved values.

Pointer/key gestures draft locally; release, completed key edit, Enter or exact
field blur commits once. Escape, pointer cancellation, lost capture and window
blur discard unfinished edits. Threads accept every valid whole number; memory
slider stops retain a saved non-power-of-two value and stay stable during a drag.
Exact fields validate whole numbers and show MiB explicitly. Five-second device
reads and retry only refresh recommendations, including a visible insufficient
budget state for known zero available memory. They never infer first use from
saved values matching a default. Reused help supports focus, touch and dismissal.

A new verified-only preference edit stages an immutable snapshot without
publishing it to running engines or returning it to loading readers. After exact
disk readback, the intended profile receives resource-only changes. Retry keeps
its original model/byte ownership guard, including the shared retry notice.
Queued local/shared retries coalesce after the first exact receipt, avoiding a
late false error once the caller publishes the saved model. The old implementation
fails the actual new concurrency case;61 focused cases pass with the correction.
Restore previous discards an unwritten failed edit without a write, or restores
only its own exact uncertain successful bytes. External/newer settings are never
overwritten. A switch to another profile does not redirect the captured edit;
a newer edit invalidates it. Errors keep current and pending resources distinct.

The native profile controls, bounded hook, storage and existing engine/request
checks pass:126 cases across13 files, with full TypeScript and one unchanged EnginesPage effect-dependency
lint warning. This is source and DOM-fixture evidence. Current-tab controls,
first-use Balanced initialization, lines/search draft parity, native packaging
and PC/phone resource reconciliation remain. No owner profile, corpus or hosting
route was changed. No manual native launch, installed-service update or rendered/
physical-device verification is claimed.

Do not confuse the new CPU policy's balanced name with the phone's existing
fixed balanced preset ID. A separate resource policy/config field must preserve
legacy fixed choices. The future gateway must explicitly advertise support for
resource requests before the phone submits them; a device snapshot alone is not
proof that resource settings will be applied. Profile/tab/sync save and engine
restart ownership require actual integration checks through En's own architecture.
