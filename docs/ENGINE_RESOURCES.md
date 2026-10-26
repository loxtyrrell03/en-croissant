# Engine resource presets: target implementation

Novelty b186d2d7 supplies device-balanced CPU/hash presets, gesture-safe sliders
and explicit settings-application ownership. En's per-engine/tab/default settings
and separate PC/phone/LCZero architecture must retain their existing contracts.
Three editable native/phone directions are in `design/engine-resources`; the
owner's layout choice is pending. The approved evaluation Settings A, phone
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

This is a source capability slice, not the completed preset feature. Device-aware
allocation, first-use ownership, slider/exact-field lifecycle, failed-save retry/
restoration, selected layout, native packaging and PC/phone runtime reconciliation
remain to implement and verify. Existing explicit/default-looking saved choices
must not be silently retuned. Phone PC requests must use PC capabilities, while
LCZero GPU and managed single-thread phone settings retain their own limits.
No owner profile, corpus or PC-hosting route was changed by these checks. No
manual native launch, installed-service update or physical-device proof is claimed.
